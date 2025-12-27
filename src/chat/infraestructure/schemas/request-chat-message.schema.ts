import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { ViewedBy, ViewedBySchema } from './viewed-by.schema';

export type RequestChatMessageDocument = HydratedDocument<RequestChatMessage>;

@Schema({ _id: false })
export class RequestChatMessage {
    @Prop({
        type: mongoose.Schema.Types.UUID,
        default: () => mongoose.Types.UUID.generate(),
    })
    _id: string;

    @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
    user: User;

    @Prop()
    content: string;

    @Prop({ type: [ViewedBySchema], default: [] })
    viewedBy: ViewedBy[];

    @Prop({ default: Date.now })
    createdAt?: Date;

    @Prop({ default: Date.now })
    updatedAt?: Date;
}

export const RequestChatMessageSchema = SchemaFactory.createForClass(RequestChatMessage);