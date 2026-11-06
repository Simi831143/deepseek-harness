/** A catalog item's published icon, with its kind's glyph when it has none or it fails to load. */
import { useState, type ReactNode } from 'react'
import type { MarketItemView } from '@deepseek-ai/dsh-market/types'
import { IconLinkOutlineRegular, IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render an item icon.
 * @param props.item - item whose `iconUrl` is shown; its kind picks the fallback glyph.
 * @param props.className - box class; the caller owns size and shape.
 * @param props.glyphSize - fallback glyph size in pixels.
 * @returns a decorative image or glyph.
 */
export function ItemIcon({ item, className, glyphSize }: {
  item: Pick<MarketItemView, 'kind' | 'iconUrl'>
  className: string | undefined
  glyphSize: number
}): ReactNode {
  const [broken, setBroken] = useState(false)
  if (item.iconUrl !== undefined && !broken) {
    return <img className={className} src={item.iconUrl} alt="" onError={() => { setBroken(true) }} />
  }
  const Glyph = item.kind === 'connector' ? IconLinkOutlineRegular : IconSkillOutlineRegular
  return <span className={className} aria-hidden="true"><Glyph size={glyphSize} /></span>
}
