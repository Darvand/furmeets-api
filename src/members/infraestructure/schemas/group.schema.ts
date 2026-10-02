import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { User } from "./user.schema";

export type GroupDocument = HydratedDocument<Group>;

@Schema({ _id: false })
export class Group {
    @Prop({
        type: mongoose.Schema.Types.UUID,
        default: () => mongoose.Types.UUID.generate(),
    })
    _id: string;

    @Prop({ index: true })
    telegramId: number;

    @Prop()
    name: string;

    @Prop()
    description: string;

    /** Id en `media` (se sirve por `GET /media/:id`). */
    @Prop({ type: mongoose.Schema.Types.UUID })
    photoMediaId?: string;

    @Prop({ type: [mongoose.Schema.Types.UUID], ref: User.name })
    members: User[];

    @Prop({ default: Date.now })
    createdAt?: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);