import { Role } from '../../../common/enums/role.enum';
import { resolveDefaultRole } from './user.schema';

describe('resolveDefaultRole', () => {
  it('opens a brand-new customer on the customer side', () => {
    expect(resolveDefaultRole([Role.CUSTOMER])).toBe(Role.CUSTOMER);
    expect(resolveDefaultRole([])).toBe(Role.CUSTOMER);
  });

  it('opens an account with a business on that business when nothing was chosen', () => {
    expect(resolveDefaultRole([Role.CUSTOMER, Role.ORGANIZER])).toBe(Role.ORGANIZER);
    expect(resolveDefaultRole([Role.CUSTOMER, Role.VENDOR])).toBe(Role.VENDOR);
    expect(resolveDefaultRole([Role.CUSTOMER, Role.VENDOR, Role.ORGANIZER])).toBe(Role.ORGANIZER);
  });

  it('keeps an explicit choice while the account still holds that role', () => {
    expect(resolveDefaultRole([Role.CUSTOMER, Role.ORGANIZER], Role.CUSTOMER)).toBe(Role.CUSTOMER);
    expect(resolveDefaultRole([Role.CUSTOMER, Role.ORGANIZER, Role.VENDOR], Role.VENDOR)).toBe(Role.VENDOR);
  });

  it('ignores a stored choice the account no longer holds', () => {
    expect(resolveDefaultRole([Role.CUSTOMER], Role.ORGANIZER)).toBe(Role.CUSTOMER);
  });
});
