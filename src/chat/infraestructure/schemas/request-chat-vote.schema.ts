import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { User } from "src/members/infraestructure/schemas/user.schema";

@Schema()
export class RequestChatVote {

    @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
    from: User;

    @Prop()
    type: string;

    @Prop({ default: Date.now })
    createdAt?: Date;

    @Prop({ default: Date.now })
    updatedAt?: Date;

}

export const RequestChatVoteSchema = SchemaFactory.createForClass(RequestChatVote);