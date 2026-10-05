import { IsIn, IsString } from 'class-validator';
import { VOTE_TYPES, type VoteType } from 'src/review/domain/vote';

export class VoteRequestChatParamsDto {
  @IsString()
  id: string;

  @IsIn(VOTE_TYPES)
  type: VoteType;
}
