import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RequestChatEntity,
  type VoteChange,
} from 'src/chat/domain/entities/request-chat.entity';
import {
  ChatRepository,
  RequestChatSummary,
} from 'src/chat/domain/services/chat.repository';
import { RequestChatState } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import { RequestChat } from '../schemas/request-chat.schema';
import { RequestChatMapper } from 'src/chat/mappers/request-chat.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

@Injectable()
export class ChatMongoRepository implements ChatRepository {
  private readonly logger = new Logger(ChatMongoRepository.name);

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

  async getAllRequestChats(): Promise<RequestChatEntity[]> {
    this.logger.debug(`Fetching all request chats from database`);
    const dbRequestChats = await this.requestChatModel
      .find()
      .populate('requester')
      .populate('votes.from')
      .exec();
    return dbRequestChats.map((doc) => RequestChatMapper.fromDb(doc));
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
