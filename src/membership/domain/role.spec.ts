import { roleFromChatMember } from './role';

describe('roleFromChatMember', () => {
  it.each([
    ['creator', undefined, 'member'],
    ['administrator', undefined, 'member'],
    ['member', undefined, 'member'],
    ['restricted', true, 'member'],
    ['restricted', false, 'applicant'],
    ['left', undefined, 'applicant'],
    ['kicked', undefined, 'applicant'],
  ])('%s (is_member: %s) → %s', (status, isMember, expected) => {
    expect(roleFromChatMember({ status, is_member: isMember })).toBe(expected);
  });
});
