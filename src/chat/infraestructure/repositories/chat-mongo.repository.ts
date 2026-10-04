import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import {
  RequestChatEntity,
  type VoteType,
} from 'src/chat/domain/entities/request-chat.entity';
import {
  ChatRepository,
  DuplicateRequestChatError,
  RequestChatCursor,
  RequestChatHeader,
  RequestChatListItem,
  RequestChatPage,
  RequestChatSummary,
  VoteApplied,
} from 'src/chat/domain/services/chat.repository';
import { RequestChatState } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import { RequestChat } from '../schemas/request-chat.schema';
import { REQUEST_CHAT_MESSAGES_COLLECTION } from '../schemas/request-chat-message.schema';
import { RequestChatMapper } from 'src/chat/mappers/request-chat.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  User,
  USERS_COLLECTION,
} from 'src/members/infraestructure/schemas/user.schema';
import { UserMapper } from 'src/members/mappers/user.mapper';

type UUIDValue = Parameters<typeof toUUIDString>[0];

/** Código de Mongo para una clave única repetida. */
const DUPLICATE_KEY = 11000;

/** Lo que devuelve la agregación de `listSummaries` por cada solicitud. */
interface RequestChatSummaryDoc {
  _id: UUIDValue;
  requester: User;
  state: string;
  createdAt: Date;
  lastMessage?: { author: User; content: string; createdAt: Date };
  approved: number;
  rejected: number;
  viewerVote?: 'approve' | 'reject';
}

function countVotes(type: 'approve' | 'reject') {
  return {
    $size: {
      $filter: {
        input: { $ifNull: ['$votes', []] },
        cond: { $eq: ['$$this.type', type] },
      },
    },
  };
}

function toListItem(doc: RequestChatSummaryDoc): RequestChatListItem {
  return {
    id: UUID.from(toUUIDString(doc._id)),
    requester: UserMapper.fromDb(doc.requester),
    state: RequestChatState.create(doc.state).props.value,
    createdAt: doc.createdAt,
    lastMessage: doc.lastMessage && {
      author: UserMapper.fromDb(doc.lastMessage.author),
      content: doc.lastMessage.content,
      at: doc.lastMessage.createdAt,
    },
    votes: { approved: doc.approved, rejected: doc.rejected },
    viewerVote: doc.viewerVote,
  };
}

@Injectable()
export class ChatMongoRepository implements ChatRepository {
  constructor(
    @InjectModel(RequestChat.name)
    private readonly requestChatModel: Model<RequestChat>,
  ) {}

  async createRequestChat(requestChat: RequestChatEntity): Promise<void> {
    const dbRequestChat = RequestChatMapper.toDb(requestChat);
    try {
      await this.requestChatModel.insertOne(dbRequestChat);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        throw new DuplicateRequestChatError();
      }
      throw error;
    }
  }

  async toggleVote(
    id: UUID,
    voter: UUID,
    type: VoteType,
    at: Date,
  ): Promise<VoteApplied | null> {
    // Los pipelines no pasan por los casts de Mongoose: el UUID va como `Binary`.
    const from = new mongo.UUID(voter.value);
    const votes = { $ifNull: ['$votes', []] };
    const isVoter = { $eq: ['$$this.from', from] };
    // Un pipeline de actualización decide y escribe en la misma operación atómica, así
    // dos votos a la vez (del mismo o de distintos miembros) no se pisan.
    const doc = await this.requestChatModel
      .findOneAndUpdate(
        { _id: id.value, state: RequestChatState.InProgress().props.value },
        [
          {
            $set: {
              votes: {
                $let: {
                  vars: { mine: { $filter: { input: votes, cond: isVoter } } },
                  in: {
                    $switch: {
                      branches: [
                        // El mismo voto otra vez: se retira.
                        {
                          case: { $in: [type, '$$mine.type'] },
                          then: {
                            $filter: {
                              input: votes,
                              cond: { $not: [isVoter] },
                            },
                          },
                        },
                        // Primer voto del miembro: se agrega.
                        {
                          case: { $eq: [{ $size: '$$mine' }, 0] },
                          then: {
                            $concatArrays: [
                              votes,
                              [
                                {
                                  _id: new mongo.ObjectId(),
                                  from,
                                  type,
                                  createdAt: at,
                                  updatedAt: at,
                                },
                              ],
                            ],
                          },
                        },
                      ],
                      // Un voto distinto: reemplaza al anterior en su lugar.
                      default: {
                        $map: {
                          input: votes,
                          in: {
                            $cond: [
                              isVoter,
                              {
                                $mergeObjects: [
                                  '$$this',
                                  { type, updatedAt: at },
                                ],
                              },
                              '$$this',
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        { new: true, projection: { votes: 1 } },
      )
      .lean<{ votes: { from: UUIDValue; type: string }[] }>()
      .exec();
    if (!doc) {
      return null;
    }
    const count = (t: VoteType) => doc.votes.filter((v) => v.type === t).length;
    const own = doc.votes.find((v) => toUUIDString(v.from) === voter.value);
    return {
      votes: { approved: count('approve'), rejected: count('reject') },
      voterVote: own?.type as VoteType | undefined,
    };
  }

  async close(id: UUID, state: RequestChatState): Promise<boolean> {
    const result = await this.requestChatModel.updateOne(
      { _id: id.value, state: RequestChatState.InProgress().props.value },
      { $set: { state: state.props.value, updatedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  async getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null> {
    const dbRequestChat = await this.requestChatModel
      .findOne({ _id: id.value })
      .populate('requester')
      .populate('votes.from')
      .exec();
    if (!dbRequestChat) {
      return null;
    }
    const requestChatEntity = RequestChatMapper.fromDb(dbRequestChat);
    return requestChatEntity;
  }

  async listSummaries(
    viewer: UUID,
    { limit, after }: { limit: number; after?: RequestChatCursor },
  ): Promise<RequestChatPage> {
    // Las agregaciones no pasan por los casts de Mongoose: los UUID van como `Binary`.
    const viewerId = new mongo.UUID(viewer.value);
    const docs = await this.requestChatModel
      .aggregate<RequestChatSummaryDoc>([
        ...(after
          ? [
              {
                $match: {
                  $or: [
                    { createdAt: { $lt: after.createdAt } },
                    {
                      createdAt: after.createdAt,
                      _id: { $lt: new mongo.UUID(after.id.value) },
                    },
                  ],
                },
              },
            ]
          : []),
        { $sort: { createdAt: -1, _id: -1 } },
        // Uno de más para saber si hay otra página.
        { $limit: limit + 1 },
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'requester',
            foreignField: '_id',
            as: 'requester',
          },
        },
        { $unwind: '$requester' },
        // Solo el último mensaje, por el índice `requestChatId + createdAt + _id`.
        {
          $lookup: {
            from: REQUEST_CHAT_MESSAGES_COLLECTION,
            localField: '_id',
            foreignField: 'requestChatId',
            as: 'lastMessage',
            pipeline: [
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              {
                $lookup: {
                  from: USERS_COLLECTION,
                  localField: 'authorId',
                  foreignField: '_id',
                  as: 'author',
                },
              },
              { $unwind: '$author' },
              { $project: { _id: 0, author: 1, content: 1, createdAt: 1 } },
            ],
          },
        },
        {
          $project: {
            requester: 1,
            state: 1,
            createdAt: 1,
            lastMessage: { $first: '$lastMessage' },
            // De los votos solo salen conteos y el voto propio (RNF-PRI-01).
            approved: countVotes('approve'),
            rejected: countVotes('reject'),
            viewerVote: {
              $first: {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ['$votes', []] },
                      cond: { $eq: ['$$this.from', viewerId] },
                    },
                  },
                  in: '$$this.type',
                },
              },
            },
          },
        },
      ])
      .exec();
    const items = docs.slice(0, limit).map(toListItem);
    const last = items.at(-1);
    return {
      items,
      next:
        docs.length > limit && last
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async chatAlreadyExistsForRequester(requesterUUID: UUID): Promise<boolean> {
    const existing = await this.requestChatModel
      .exists({ requester: requesterUUID.value })
      .exec();
    return existing !== null;
  }

  async findSummaryByRequester(
    requesterUUID: UUID,
  ): Promise<RequestChatSummary | null> {
    const doc = await this.requestChatModel
      .findOne({ requester: requesterUUID.value }, { _id: 1, state: 1 })
      .lean<Pick<RequestChat, '_id' | 'state'>>()
      .exec();
    if (!doc) {
      return null;
    }
    return {
      id: UUID.from(toUUIDString(doc._id)),
      state: RequestChatState.create(doc.state).props.value,
    };
  }

  async findHeader(id: UUID): Promise<RequestChatHeader | null> {
    const doc = await this.requestChatModel
      .findOne({ _id: id.value }, { requester: 1, state: 1 })
      .lean<{ _id: UUIDValue; requester: UUIDValue; state: string }>()
      .exec();
    if (!doc) {
      return null;
    }
    return {
      id: UUID.from(toUUIDString(doc._id)),
      requesterId: UUID.from(toUUIDString(doc.requester)),
      state: RequestChatState.create(doc.state).props.value,
    };
  }
}
