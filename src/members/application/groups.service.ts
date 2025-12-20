import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { GroupMember } from "../domain/entities/group-member.entity";
import { MEMBERS_PROVIDERS } from "../members.providers";
import type { MainGroupRepository } from "../domain/services/main-group.repository";
import { MainGroupAggregate } from "../domain/entities/main-group-aggregate.entity";
import { GroupDto } from "../presentation/dtos/group.dto";
import { GroupMapper } from "../mappers/group.mapper";

@Injectable()
export class GroupsService {
    constructor(
        @Inject(MEMBERS_PROVIDERS.GroupRepository) private readonly groupRepository: MainGroupRepository,
    ) { }

    async getGroup(groupId: string): Promise<GroupDto> {
        const group = await this.groupRepository.getGroup();
        if (!group) {
            throw new NotFoundException(`Group with ID ${groupId} not found`);
        }
        return GroupMapper.toDto(group);
    }
}