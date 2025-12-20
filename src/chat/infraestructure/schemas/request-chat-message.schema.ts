import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

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

    @Prop({ default: Date.now })
    createdAt?: Date;
}

export const RequestChatMessageSchema = SchemaFactory.createForClass(RequestChatMessage);