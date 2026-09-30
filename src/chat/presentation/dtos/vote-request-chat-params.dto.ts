import { IsIn, IsString } from "class-validator";

export const VOTE_TYPES = ["approve", "reject"] as const;
export type VoteType = typeof VOTE_TYPES[number];

export class VoteRequestChatParamsDto {
    @IsString()
    id: string;

    @IsIn(VOTE_TYPES)
    type: VoteType;
}
