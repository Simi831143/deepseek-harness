/**
 * `brand` namespace dictionary for the official product name.
 *
 * The name is a proper noun, so every shipped locale carries the same value and
 * stays swappable by a language pack; owning it here is what keeps the occupant
 * components free of copy (`verify-client-ui-i18n`).
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'product.name': 'LC Camera Agent',
} satisfies Record<string, string>

/** The brand namespace key union. */
export type BrandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** French dictionary, checked complete against the zh key set. */
export const fr = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** German dictionary, checked complete against the zh key set. */
export const de = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** Russian dictionary, checked complete against the zh key set. */
export const ru = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>

/** Portuguese dictionary, checked complete against the zh key set. */
export const pt = {
  'product.name': 'LC Camera Agent',
} satisfies Record<BrandKey, string>
