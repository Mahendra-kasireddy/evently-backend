import { paymentsTestMode } from './customer-public-event.service';

describe('payments test mode', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is off unless asked for', () => {
    delete process.env.PAYMENTS_TEST_MODE;
    process.env.NODE_ENV = 'development';
    expect(paymentsTestMode()).toBe(false);
  });

  it('is on in development when asked for', () => {
    process.env.PAYMENTS_TEST_MODE = 'true';
    process.env.NODE_ENV = 'development';
    expect(paymentsTestMode()).toBe(true);
  });

  it('can never be switched on in production', () => {
    process.env.PAYMENTS_TEST_MODE = 'true';
    process.env.NODE_ENV = 'production';
    expect(paymentsTestMode()).toBe(false);
  });
});
