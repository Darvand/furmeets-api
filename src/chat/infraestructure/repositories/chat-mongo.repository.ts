import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { RequestChatEntity } from "src/chat/domain/entities/request-chat.entity";
import { ChatRepository } from "src/chat/domain/services/chat.repository";
import { RequestChat, RequestChatSchema } from "../schemas/request-chat.schema";
import { RequestChatMapper } from "src/chat/mappers/request-chat.mapper";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { User } from "../../../members/infraestructure/schemas/user.schema";

@Injectable()
export class ChatMongoRepository implements ChatRepository {

    private readonly logger = new Logger(ChatMongoRepository.name);

    constructor(
        @InjectModel(RequestChat.name) private readonly requestChatModel: Model<RequestChat>,
        @InjectModel(User.name) private readonly userModel: Model<User>,
    ) { }

    async saveRequestChat(requestChat: RequestChatEntity): Promise<void> {
        const dbRequestChat = RequestChatMapper.toDb(requestChat);
        this.logger.debug(`Saving request chat with ID: ${dbRequestChat._id}`);
        await this.requestChatModel.updateOne({ _id: dbRequestChat._id }, dbRequestChat, { upsert: true });
    }

    async createRequestChat(requestChat: RequestChatEntity): Promise<void> {
        const dbRequestChat = RequestChatMapper.toDb(requestChat);
        await this.requestChatModel.insertOne(dbRequestChat);
    }

    async getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null> {
        const dbRequestChat = await this.requestChatModel
            .findOne({ _id: id.value })
            .populate('requester')
            .populate('messages.user')
            .populate('votes.from')
            .populate('messages.viewedBy.by')
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
            .populate('messages.user')
            .populate('votes.from')
            .populate('messages.viewedBy.by')
            .exec();
        return dbRequestChats.map(RequestChatMapper.fromDb);
    }
}