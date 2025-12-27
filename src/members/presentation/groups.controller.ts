import { Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { GroupsService } from "../application/groups.service";
import { GroupMapper } from "../mappers/group.mapper";
import { GetGroupDto } from "./dtos/get-group.dto";

@Controller('groups')
export class GroupsController {
    constructor(private readonly groupsService: GroupsService) { }

    @Get()
    async getGroup(): Promise<GetGroupDto> {
        const group = await this.groupsService.getGroup();
        return GroupMapper.toDto(group);
    }

    @Post('sync')
    async sync(@Headers('x-telegram-id') telegramId: string): Promise<void> {
        await this.groupsService.sync(Number(telegramId));
    }
}