/**
 * Skill presentation other browser plugins share: display titles keyed by
 * skill name (a market catalog names `lark-unified` 飞书套件), composer drafts
 * that open with a skill chip, and a catalog refresh after installs.
 */
import type { DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Display titles by skill name. */
export type SkillLabels = ReadonlyMap<string, string>

/** One run of a composed draft: plain text, or a chip for one skill. */
export type SkillDraftPart = { readonly text: string } | { readonly skill: string }

/** The `uiSkill` service. */
export interface UiSkill {
  /**
   * Contribute display titles. A name listed by several contributions takes the latest one's title.
   * @param source - observable titles; the store follows its changes.
   * @returns disposer withdrawing the contribution; register it as an effect.
   */
  contributeLabels(source: HostObservable<SkillLabels>): () => void
  /**
   * Read the display title of one skill.
   * @param name - skill name.
   * @returns the contributed title, or undefined when no contribution names the skill.
   */
  labelOf(name: string): string | undefined
  /**
   * Build a composer draft that opens with a chip for one skill, followed by `text`.
   * Sending it carries the literal `/name text`, which loads the skill host-side.
   * @param name - skill name.
   * @param text - request text after the chip; may be empty.
   * @returns a draft for `uiWorkspace.startSession(..., { prompt })`.
   */
  draft(name: string, text: string): DraftSnapshot
  /**
   * Build a composer draft from text and skill chips in order; one space separates neighbours.
   * Every skill a chip names loads host-side when the draft is sent.
   * @param parts - text runs and skill names; empty text runs are dropped.
   * @returns a draft for `uiWorkspace.startSession(..., { prompt })`.
   */
  compose(parts: readonly SkillDraftPart[]): DraftSnapshot
  /** Drop every cached skill catalog and refetch the open ones, e.g. after a skill was installed or switched. */
  refresh(): void
}

/** Merged observable titles plus the contribution entry point. */
export interface SkillLabelStore extends HostObservable<SkillLabels> {
  contribute(source: HostObservable<SkillLabels>): () => void
}

const EMPTY_LABELS: SkillLabels = new Map()

/**
 * Create the merged title store.
 * @returns a store whose snapshot keeps its identity until a contribution changes.
 */
export function createSkillLabels(): SkillLabelStore {
  const sources: HostObservable<SkillLabels>[] = []
  const listeners = new Set<() => void>()
  let cache: { inputs: readonly SkillLabels[]; merged: SkillLabels } | undefined
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const getSnapshot = (): SkillLabels => {
    if (sources.length === 0) return EMPTY_LABELS
    const inputs = sources.map(source => source.getSnapshot())
    if (cache !== undefined && cache.inputs.length === inputs.length && cache.inputs.every((input, index) => input === inputs[index])) {
      return cache.merged
    }
    const merged = new Map<string, string>()
    for (const input of inputs) for (const [name, label] of input) merged.set(name, label)
    cache = { inputs, merged }
    return merged
  }
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    contribute(source) {
      sources.push(source)
      const unsubscribe = source.subscribe(notify)
      notify()
      return () => {
        unsubscribe()
        const index = sources.indexOf(source)
        if (index >= 0) sources.splice(index, 1)
        notify()
      }
    },
  }
}

/** A titles source that never changes, for sent-message entries rendered without the store. */
export const NO_SKILL_LABELS: HostObservable<SkillLabels> = {
  getSnapshot: () => EMPTY_LABELS,
  subscribe: () => () => {},
}
