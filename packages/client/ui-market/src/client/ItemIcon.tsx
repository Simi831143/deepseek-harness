/** A catalog item's published icon, with the skill glyph when it has none or it fails to load. */
import { useState, type ReactNode } from 'react'
import type { MarketItemView } from '@deepseek-ai/dsh-market/types'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render an item icon.
 * @param props.item - item whose `iconUrl` is shown.
 * @param props.className - box class; the caller owns size and shape.
 * @param props.glyphSize - fallback glyph size in pixels.
 * @returns a decorative image or glyph.
 */
export function ItemIcon({ item, className, glyphSize }: {
  item: MarketItemView
  className: string | undefined
  glyphSize: number
}): ReactNode {
  const [broken, setBroken] = useState(false)
  if (item.iconUrl !== undefined && !broken) {
    return <img className={className} src={item.iconUrl} alt="" onError={() => { setBroken(true) }} />
  }
  return <span className={className} aria-hidden="true"><IconSkillOutlineRegular size={glyphSize} /></span>
}
