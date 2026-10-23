/** Market page selection: which section is open, or the installed-skill manager. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MarketKindName } from '@deepseek-ai/dsh-market/types'

/** The open view. */
export type MarketView =
  | { readonly kind: 'catalog'; readonly tab: MarketKindName }
  | { readonly kind: 'installed' }

type NavigationState = { view: MarketView }
type NavigationActions = { setView: (draft: NavigationState, view: MarketView) => void }

/**
 * Create the page selection before the first render.
 * @returns the registration-owned navigation store handle.
 */
export function createMarketNavigation(): EngineStoreHandle<NavigationState, NavigationActions> {
  return defineStore({
    init: (): NavigationState => ({ view: { kind: 'catalog', tab: 'skill' } }),
    actions: {
      setView: (draft, view: MarketView) => { draft.view = view },
    },
  })
}
