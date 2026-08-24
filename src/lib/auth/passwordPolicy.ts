/**
 * Password policy shared by the server (reset / change endpoints) and the
 * client (password strength meter + checklist).
 *
 * Rules enforced for password reset / change:
 *   - Minimum 8 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one number
 *
 * A special character is not required, but counts toward the strength score.
 */

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Common / leaked-style passwords that are trivially guessed even when they
 * satisfy the character rules. Kept deliberately small and matched exactly
 * (case-insensitive), with common digit/leet variants listed explicitly.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "passw0rd1",
  "passw0rd123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "abcdefgh",
  "abcdefg1",
  "abc12345",
  "abcd1234",
  "iloveyou",
  "letmein",
  "welcome",
  "welcome1",
  "admin123",
  "monkey",
  "monkey123",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
]);

export function isCommonPassword(password: string): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export type PasswordRequirement = {
  id: "length" | "upper" | "lower" | "number";
  label: string;
  met: boolean;
};

export function checkPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: "upper", label: "At least one uppercase letter", met: /[A-Z]/.test(password) },
    { id: "lower", label: "At least one lowercase letter", met: /[a-z]/.test(password) },
    { id: "number", label: "At least one number", met: /[0-9]/.test(password) },
  ];
}

/** Returns a user-friendly error message, or null when the password is valid. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include a lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include a number.";
  }
  if (isCommonPassword(password)) {
    return "That password is too common. Choose something harder to guess.";
  }
  return null;
}

/** 0 (very weak) → 4 (strong). Used by the client-side strength meter only. */
export function scorePassword(password: string): PasswordScore {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4) as PasswordScore;
}

export function passwordStrengthLabel(score: PasswordScore): string {
  switch (score) {
    case 0:
      return "Very weak";
    case 1:
      return "Weak";
    case 2:
      return "Fair";
    case 3:
      return "Good";
    default:
      return "Strong";
  }
}
