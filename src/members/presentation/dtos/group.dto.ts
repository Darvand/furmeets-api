class GroupMemberDto {
    id: string;
    username: string;
    telegramId: number;
}

export class GroupDto {
    id: string;
    name: string;
    telegramId: number;
    members: GroupMemberDto[];
    createdAt?: Date;
}