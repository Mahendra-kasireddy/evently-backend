/**
 * Unit tests only.
 *
 * `ts-jest` in isolated mode so a spec runs against the sources without a
 * build step, and `roots` kept to `src` so `test/di-check.ts` — a runtime smoke
 * script, not a spec — is not picked up as one.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
};
