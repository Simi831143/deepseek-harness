/** Field rules of the email sign-in form, kept free of React so they are testable on their own. */

/** Seconds the resend control stays disabled after a code request. */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * Whether a field carries something the issuer could mail a code to.
 *
 * Deliberately permissive: the issuer owns address validation, so a stricter
 * local rule would refuse addresses it accepts and report a failure the user
 * cannot correct from here.
 * @param value - raw field text.
 * @returns whether the address is worth sending.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * Whether a typed code is worth submitting.
 *
 * The issuer owns the code's exact shape, so the form refuses nothing but the
 * empty field.
 * @param value - raw field text.
 * @returns whether the code can be submitted.
 */
export function codeReady(value: string): boolean {
  return value.trim().length > 0
}
