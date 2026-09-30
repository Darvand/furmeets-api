import { Type } from "class-transformer";
import { IsDate, IsIn, IsInt, IsOptional, IsString } from "class-validator";
import { Species } from "src/members/domain/entities/user.entity";

export class CreateUserDto {
    @IsOptional()
    @IsString()
    username?: string;

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    avatarUrl?: string;

    @IsInt()
    telegramId: number;

    @IsOptional()
    @IsIn(Object.values(Species))
    species?: string;

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    birthdate?: Date;
}
