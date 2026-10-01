import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipService } from 'src/membership/application/membership.service';
import { Role } from 'src/membership/domain/role';
import { ApplicantsOnly, MembersOnly, RolesGuard } from './roles.guard';

@Controller()
class TestController {
  @Get('members')
  @MembersOnly()
  members() {}

  @Get('applicants')
  @ApplicantsOnly()
  applicants() {}

  @Get('open')
  open() {}
}

const user = { telegramId: 1, isMember: false };

function context(handler: keyof TestController): ExecutionContext {
  return {
    getHandler: () => TestController.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guard(role: Role) {
  return new RolesGuard(new Reflector(), {
    resolveRole: jest.fn().mockResolvedValue(role),
  } as unknown as MembershipService);
}

describe('RolesGuard', () => {
  it('@MembersOnly deja pasar a un miembro y rechaza a un solicitante', async () => {
    await expect(guard('member').canActivate(context('members'))).resolves.toBe(
      true,
    );
    await expect(
      guard('applicant').canActivate(context('members')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@ApplicantsOnly deja pasar a un solicitante y rechaza a un miembro', async () => {
    await expect(
      guard('applicant').canActivate(context('applicants')),
    ).resolves.toBe(true);
    await expect(
      guard('member').canActivate(context('applicants')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una ruta sin rol requerido no consulta el rol', async () => {
    const resolveRole = jest.fn();
    const rolesGuard = new RolesGuard(new Reflector(), {
      resolveRole,
    } as unknown as MembershipService);

    await expect(rolesGuard.canActivate(context('open'))).resolves.toBe(true);
    expect(resolveRole).not.toHaveBeenCalled();
  });
});
