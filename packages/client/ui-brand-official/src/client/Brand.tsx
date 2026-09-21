import { LongcheerMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the product mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the LongCheer mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <LongcheerMark size={size} />
}

/**
 * Render the product name without its independently slotted mark. The sidebar
 * brand-name seat owns the type (size, weight, tracking), so this occupant
 * contributes words only, read from the `brand` dictionary through the seat's
 * injected `t`.
 * @param props - The brand namespace's translate seat.
 * @returns the product name.
 */
export function OfficialBrandName({ t }: PropsLocale<'brand'>) {
  return <span>{t('product.name')}</span>
}
