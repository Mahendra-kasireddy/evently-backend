import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service';

describe('profile photo must be an Evently upload', () => {
  const service = (publicBaseUrl: string) =>
    new UserService(
      null as never,
      null as never,
      { get: () => publicBaseUrl } as unknown as ConfigService,
    );

  it('accepts the local driver path and an empty value', () => {
    expect(() => service('').assertOwnUpload('/api/upload/file/profileImage/abc.jpg')).not.toThrow();
    expect(() => service('').assertOwnUpload(undefined)).not.toThrow();
  });

  it('accepts a URL on the configured upload host', () => {
    expect(() =>
      service('https://cdn.evently.in/').assertOwnUpload('https://cdn.evently.in/profileImage/a.jpg'),
    ).not.toThrow();
  });

  it('refuses any other host, including a look-alike', () => {
    expect(() => service('https://cdn.evently.in').assertOwnUpload('https://evil.test/a.jpg')).toThrow();
    expect(() =>
      service('https://cdn.evently.in').assertOwnUpload('https://cdn.evently.in.evil.test/a.jpg'),
    ).toThrow();
    expect(() => service('').assertOwnUpload('https://evil.test/a.jpg')).toThrow();
  });
});
