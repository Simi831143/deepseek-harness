/**
 * `brand` namespace dictionary for the official product name.
 *
 * The name is a proper noun, so both shipped locales carry the same value and
 * stay swappable by a language pack; owning it here is what keeps the occupant
 * components free of copy (`verify-client-ui-i18n`).
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'product.name': 'LongCheer Agent',
} satisfies Record<string, string>

/** The brand namespace key union. */
export type BrandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'product.name': 'LongCheer Agent',
} satisfies Record<BrandKey, string>
