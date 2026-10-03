import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRequestChatDto {
  @IsUUID()
  requesterUUID: string;

  @IsOptional()
  @IsString()
  whereYouFoundUs?: string;

  @IsOptional()
  @IsString()
  interests?: string;
}
