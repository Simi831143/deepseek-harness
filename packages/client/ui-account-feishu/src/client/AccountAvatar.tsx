/** Account picture with an initial or icon fallback for a missing or unavailable image. */
import { useState } from 'react'
import { IconUserOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './FeishuAccount.module.css'

/**
 * Render a decorative avatar next to the account identity.
 * @param props.url - profile picture URL; absent while signed out or loading.
 * @param props.name - display name whose first character replaces a missing picture.
 * @param props.size - edge length in pixels.
 * @returns picture, initial, or the default account icon.
 */
export function AccountAvatar({ url, name, size }: { url?: string | null | undefined; name?: string | null | undefined; size: number }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const initial = name?.trim().charAt(0)
  return <span className={css.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }} aria-hidden="true">
    {url && url !== failedUrl
      ? <img className={css.avatarImage} src={url} alt="" referrerPolicy="no-referrer" onError={() => { setFailedUrl(url) }} />
      : initial ? initial : <IconUserOutlineMedium size={Math.round(size * 0.6)} />}
  </span>
}
