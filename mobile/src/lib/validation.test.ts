import { isValidEmail, isValidPassword } from './validation';

describe('validation', () => {
  it('requires at least 8 password characters', () => {
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('12345678')).toBe(true);
  });

  it('checks e-mail shape', () => {
    expect(isValidEmail('damla@example.com')).toBe(true);
    expect(isValidEmail('damla@')).toBe(false);
  });
});
