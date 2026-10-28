/** LC Camera Agent brand occupants for the browser sidebar slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar brand slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale namespace table this package merges into.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type BrandKey } from './locales.ts'

export type { BrandKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The product name rendered beside the sidebar brand mark. */
    brand: BrandKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'brand'

/** Services required by the brand occupants. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar brand slots in every build profile as one declaration-aware
 * registration set. The conversation hero retains its declaring package's fallback.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-brand-official: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, OfficialBrandName)
    }))
}
