import { LongcheerMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

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
 * contributes words only.
 * @returns the product name.
 */
export function OfficialBrandName() {
  return <span>LongCheer Agent</span>
}
