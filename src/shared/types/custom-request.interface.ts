import { Request } from "express";
import { UserEntity } from "src/members/domain/entities/user.entity";

export interface CustomRequest extends Request {
    user: UserEntity;
}