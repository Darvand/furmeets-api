import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { User } from "src/members/infraestructure/schemas/user.schema";

@Schema({ _id: false })
export class ViewedBy {

    @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
    by: User;

    @Prop({ default: Date.now })
    createdAt?: Date;

}

export const ViewedBySchema = SchemaFactory.createForClass(ViewedBy);