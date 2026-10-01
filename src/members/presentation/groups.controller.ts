import { Controller, Get, Post, Req } from "@nestjs/common";
import { GroupsService } from "../application/groups.service";
import { GroupMapper } from "../mappers/group.mapper";
import { GetGroupDto } from "./dtos/get-group.dto";
import type { CustomRequest } from "src/shared/types/custom-request.interface";

@Controller('groups')
export class GroupsController {
    constructor(private readonly groupsService: GroupsService) { }

    @Get()
    async getGroup(): Promise<GetGroupDto> {
        const group = await this.groupsService.getGroup();
        return GroupMapper.toDto(group);
    }

    @Post('sync')
    async sync(@Req() req: CustomRequest): Promise<void> {
        await this.groupsService.sync(req.user);
    }
}