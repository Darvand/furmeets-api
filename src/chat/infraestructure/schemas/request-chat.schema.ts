import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { RequestChatMessage, RequestChatMessageSchema } from "./request-chat-message.schema";
import { User, UserSchema } from "src/members/infraestructure/schemas/user.schema";

export type RequestChatDocument = HydratedDocument<RequestChat>;

@Schema({ _id: false })
export class RequestChat {
    @Prop({
        type: mongoose.Schema.Types.UUID,
        default: () => mongoose.Types.UUID.generate(),
    })
    _id: string;

    @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
    requester: User;

    @Prop({ default: Date.now })
    createdAt?: Date;

    @Prop({ type: [RequestChatMessageSchema] })
    messages: RequestChatMessage[];
}

export const RequestChatSchema = SchemaFactory.createForClass(RequestChat);