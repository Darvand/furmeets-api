import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type MemberDocument = HydratedDocument<Member>;

@Schema()
export class Member {
    @Prop({
        type: mongoose.Schema.Types.UUID,
        default: () => mongoose.Types.UUID.generate(),
    })
    id: string;

    @Prop()
    username: string;

    @Prop()
    telegramId: number;

    @Prop({ default: Date.now })
    createdAt?: Date;
}

export const MemberSchema = SchemaFactory.createForClass(Member);