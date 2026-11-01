/**
 * Application Configuration & Secret Passcode Management
 * Reads secret code strictly from environment variables (VITE_SECRET_ROOM_CODE).
 * No hardcoded defaults or credentials exist in source code.
 */

export const SECRET_ROOM_CODE: string = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SECRET_ROOM_CODE) ||
  ''
).trim();

/**
 * Validates user input against the environment-configured secret passcode.
 * Returns true only if a secret code is configured in environment variables and matches the user's input.
 */
export function validateSecretCode(input: string | null | undefined): boolean {
  if (!input || !SECRET_ROOM_CODE) return false;
  return input.trim().toLowerCase() === SECRET_ROOM_CODE.toLowerCase();
}
