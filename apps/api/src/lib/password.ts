import bcrypt from 'bcryptjs';

// Password hashing. bcrypt is used here for portability (pure-JS, no native build).
// Production can switch to argon2id — the interface stays the same.
const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Basic password policy — enforced at the edge (see auth schema) and here.
export function passwordMeetsPolicy(pw: string): boolean {
  return pw.length >= 10 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}
