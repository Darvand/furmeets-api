import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { MemberSchema } from './member.schema';
import { GroupMember } from 'src/members/domain/entities/group-member.entity';

export type MainGroupDocument = HydratedDocument<MainGroup>;

@Schema()
export class MainGroup {
    @Prop({
        type: mongoose.Schema.Types.UUID,
        default: () => mongoose.Types.UUID.generate(),
    })
    id: string;

    @Prop()
    name: string;

    @Prop()
    telegramId: number;

    @Prop({ type: [{ type: MemberSchema }] })
    members: GroupMember[];

    @Prop({ default: Date.now })
    createdAt?: Date;
}

export const MainGroupSchema = SchemaFactory.createForClass(MainGroup);