import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import {
  RequestChatEntity,
  type VoteChange,
} from 'src/chat/domain/entities/request-chat.entity';
import {
  ChatRepository,
  RequestChatCursor,
  RequestChatListItem,
  RequestChatPage,
  RequestChatSummary,
  UNREAD_COUNT_CAP,
} from 'src/chat/domain/services/chat.repository';
import { RequestChatState } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import { RequestChat } from '../schemas/request-chat.schema';
import { REQUEST_CHAT_MESSAGES_COLLECTION } from '../schemas/request-chat-message.schema';
import { REQUEST_CHAT_READS_COLLECTION } from '../schemas/request-chat-read.schema';
import { RequestChatMapper } from 'src/chat/mappers/request-chat.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  User,
  USERS_COLLECTION,
} from 'src/members/infraestructure/schemas/user.schema';
import { UserMapper } from 'src/members/mappers/user.mapper';

type UUIDValue = Parameters<typeof toUUIDString>[0];

/** Quien nunca abrió la solicitud no leyó nada. */
const NEVER = new Date(0);

/** Lo que devuelve la agregación de `listSummaries` por cada solicitud. */
interface RequestChatSummaryDoc {
  _id: UUIDValue;
  requester: User;
  state: string;
  createdAt: Date;
  lastMessage?: { author: User; content: string; createdAt: Date };
  unreadMessagesCount: number;
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
    unreadMessagesCount: doc.unreadMessagesCount,
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
    await this.requestChatModel.insertOne(dbRequestChat);
  }

  async applyVote(
    id: UUID,
    change: VoteChange,
    at: Date,
  ): Promise<RequestChatEntity | null> {
    const inProgress = {
      _id: id.value,
      state: RequestChatState.InProgress().props.value,
    };
    if (change.kind === 'removed') {
      return this.updateAndRead(inProgress, {
        $pull: { votes: { from: change.userId } },
      });
    }
    const from = change.vote.props.user.id.value;
    const type = change.vote.props.type;
    // Cambia el voto que ya tenía…
    const replace = () =>
      this.updateAndRead(
        { ...inProgress, 'votes.from': from },
        { $set: { 'votes.$.type': type, 'votes.$.updatedAt': at } },
      );
    // …o agrega uno nuevo; `$ne` evita un segundo voto del mismo miembro.
    const add = () =>
      this.updateAndRead(
        { ...inProgress, 'votes.from': { $ne: from } },
        {
          $push: { votes: { from, type, createdAt: at, updatedAt: at } },
        },
      );
    // Si ninguna aplica, otra petición del mismo miembro agregó su voto en medio: se
    // reemplaza ese. Si tampoco, la solicitud ya no está en curso.
    return (await replace()) ?? (await add()) ?? (await replace());
  }

  async close(id: UUID, state: RequestChatState): Promise<boolean> {
    const result = await this.requestChatModel.updateOne(
      { _id: id.value, state: RequestChatState.InProgress().props.value },
      { $set: { state: state.props.value, updatedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  /** Aplica `update` si el filtro coincide y devuelve la solicitud ya actualizada. */
  private async updateAndRead(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<RequestChatEntity | null> {
    const doc = await this.requestChatModel
      .findOneAndUpdate(filter, update, { new: true })
      .populate('requester')
      .populate('votes.from')
      .exec();
    return doc ? RequestChatMapper.fromDb(doc) : null;
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
        // Solo el último mensaje, por el índice `requestChatId + createdAt`.
        {
          $lookup: {
            from: REQUEST_CHAT_MESSAGES_COLLECTION,
            localField: '_id',
            foreignField: 'requestChatId',
            as: 'lastMessage',
            pipeline: [
              { $sort: { createdAt: -1 } },
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
        // No leídos: mensajes posteriores a la última lectura de quien mira que no
        // escribió él. Se cuentan en la BD por el índice `requestChatId + createdAt` y
        // hasta un tope, así el costo no depende de cuántos mensajes hay.
        // Sin correlación con la solicitud: Mongo trae las lecturas de quien mira una vez
        // para toda la página, no una vez por solicitud.
        {
          $lookup: {
            from: REQUEST_CHAT_READS_COLLECTION,
            as: 'reads',
            pipeline: [
              { $match: { userId: viewerId } },
              { $project: { _id: 0, requestChatId: 1, lastReadAt: 1 } },
            ],
          },
        },
        {
          $lookup: {
            from: REQUEST_CHAT_MESSAGES_COLLECTION,
            localField: '_id',
            foreignField: 'requestChatId',
            let: {
              after: {
                $ifNull: [
                  {
                    $first: {
                      $map: {
                        input: {
                          $filter: {
                            input: '$reads',
                            cond: { $eq: ['$$this.requestChatId', '$_id'] },
                          },
                        },
                        in: '$$this.lastReadAt',
                      },
                    },
                  },
                  NEVER,
                ],
              },
            },
            as: 'unread',
            pipeline: [
              { $match: { $expr: { $gt: ['$createdAt', '$$after'] } } },
              { $match: { authorId: { $ne: viewerId } } },
              { $limit: UNREAD_COUNT_CAP },
              { $count: 'count' },
            ],
          },
        },
        {
          $project: {
            requester: 1,
            state: 1,
            createdAt: 1,
            lastMessage: { $first: '$lastMessage' },
            unreadMessagesCount: {
              $ifNull: [{ $first: '$unread.count' }, 0],
            },
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

  async findRequesterId(id: UUID): Promise<UUID | null> {
    const doc = await this.requestChatModel
      .findOne({ _id: id.value }, { requester: 1 })
      .lean<{ requester: Parameters<typeof toUUIDString>[0] }>()
      .exec();
    return doc ? UUID.from(toUUIDString(doc.requester)) : null;
  }
}
