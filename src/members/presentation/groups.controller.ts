import { Controller, Get, Param } from "@nestjs/common";
import { GroupsService } from "../application/groups.service";

@Controller('groups')
export class GroupsController {
    constructor(private readonly groupsService: GroupsService) { }

    @Get('/:groupId')
    async getGroup(@Param('groupId') groupId: string) {
        return this.groupsService.getGroup(groupId);
    }
}