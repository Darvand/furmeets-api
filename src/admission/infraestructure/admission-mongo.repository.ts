import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type RootFilterQuery } from 'mongoose';
import { RequestChat } from 'src/chat/infraestructure/schemas/request-chat.schema';
import { RequestChatState } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type { Admission } from '../domain/admission';
import type { AdmissionRepository } from '../domain/admission.repository';

type AdmissionDoc = Pick<
  RequestChat,
  '_id' | 'state' | 'inviteLink' | 'admittedAt'
>;

const PROJECTION = { _id: 1, state: 1, inviteLink: 1, admittedAt: 1 };

/** Lee y escribe solo los campos de admisión de la solicitud, con `lean()`. */
@Injectable()
export class AdmissionMongoRepository implements AdmissionRepository {
  constructor(
    @InjectModel(RequestChat.name)
    private readonly requestChatModel: Model<RequestChat>,
  ) {}

  findById(requestChatId: UUID): Promise<Admission | null> {
    return this.findOne({ _id: requestChatId.value });
  }

  findByRequester(requesterId: UUID): Promise<Admission | null> {
    return this.findOne({ requester: requesterId.value });
  }

  async saveInviteLink(
    requestChatId: UUID,
    inviteLink: string,
  ): Promise<boolean> {
    const result = await this.requestChatModel.updateOne(
      {
        _id: requestChatId.value,
        state: RequestChatState.Approved().props.value,
        inviteLink: { $exists: false },
      },
      { $set: { inviteLink } },
    );
    return result.modifiedCount === 1;
  }

  async markAdmitted(requestChatId: UUID, at: Date): Promise<boolean> {
    const result = await this.requestChatModel.updateOne(
      { _id: requestChatId.value, admittedAt: { $exists: false } },
      { $set: { admittedAt: at } },
    );
    return result.modifiedCount === 1;
  }

  private async findOne(
    filter: RootFilterQuery<RequestChat>,
  ): Promise<Admission | null> {
    const doc = await this.requestChatModel
      .findOne(filter, PROJECTION)
      .lean<AdmissionDoc>()
      .exec();
    if (!doc) {
      return null;
    }
    return {
      requestChatId: UUID.from(toUUIDString(doc._id)),
      state: RequestChatState.create(doc.state).props.value,
      inviteLink: doc.inviteLink ?? undefined,
      admittedAt: doc.admittedAt ?? undefined,
    };
  }
}
