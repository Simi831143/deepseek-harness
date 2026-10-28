/**
 * Skill reference plugin, browser half: registers the '/' skill source —
 * candidates from the `skills/list` Remote addressed by the per-call session
 * projection's sessionId (sessions are always agent-backed; the host
 * resolves cwd from the session header). A pick lands the literal `/name `
 * text and the prompt ships the same literal (plain-text-reference decision;
 * see .agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md);
 * determinism
 * lives host-side — the pre-step boundary (`dsh-tool-skill`) recognizes a
 * leading `/name` naming a user-invocable skill and injects the rendered
 * body for every entry point, including `disable-model-invocation` skills the
 * model-side catalog never lists (issue #1470). The RPC rides the plugin's
 * root-context Remote captured at registration — the source never reads
 * services off a per-call argument. Draft chip visuals derive from
 * the lexicon scan; this source implements no reference codec.
 *
 * Catalog fetches are cached per session (the small twin of the ui-commands
 * directory): the per-keystroke candidates re-poll filters a settled
 * snapshot locally, so one session costs one RPC. The scope-birth warm hook
 * prewarms the session's key; a preset switch drops that one key (the
 * catalog is the preset's, and a blank session may switch after the warm);
 * connection/reset clears everything — the host
 * catalog may differ across generations. A shared in-flight fetch
 * deliberately outlives any single menu interaction: closing the menu must
 * not kill the prewarm other consumers will hit, so it carries its own
 * abort (fired only on invalidation/teardown) while a candidates caller
 * with an aborted signal just returns early.
 * Catalog RPCs retain an existing Client Session through completion and
 * wait for its initial history open to succeed before contacting the Host.
 *
 * This browser half also owns the `skill` keyed toolview: a replay-stable
 * accent row derived only from each logged call/result slice.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the forwarded `plugin-manager/changed` declaration.
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DraftReference } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { rankByName, IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SkillRow } from './SkillRow.tsx'
import { SkillReference, type SkillReferenceInjected } from './SkillReference.tsx'
import { skillReferenceRule } from './user-text-rules.ts'
export type {} from './user-text-rules.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SkillKey } from './locales.ts'
import { createSkillLabels, type UiSkill } from './presentation.ts'
export type { SkillDraftPart, SkillLabels, UiSkill } from './presentation.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A skill-catalog fetch waiting for initial history and its RPC result. */
    skillCatalog: unknown
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Skill display titles, skill-chip drafts and catalog refresh shared with other plugins. */
    uiSkill: UiSkill
  }
}

/** Source name of skill chips; drafts built for another plugin carry it. */
const SOURCE = 'skill'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated skill tool row's copy. */
    skill: SkillKey
  }
}

/** One session's catalog fetch: the shared promise plus its own abort handle. */
interface CatalogFetch {
  readonly promise: Promise<readonly SkillEntry[]>
  readonly abort: AbortController
  /** Settled catalog for synchronous lexicon reads (unset while in flight or on failure). */
  settled?: readonly SkillEntry[]
}

/** Required services: reference source faces plus the tool-row and locale registries. */
export const inject = ['inputTriggers', 'sessions', 'slots', 'locale', 'remote', 'remote.skills', 'sidebarRight', 'uiConversation']

/**
 * Client plugin body: register the '/' source, dictionaries, and keyed tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-skill: dictionaries')
  ctx.uiConversation.userText.register(skillReferenceRule)
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'skill', locale: NS },
    SkillRow,
  ))

  const skills = ctx.remote.skills
  const sessions = ctx.sessions
  // Session-keyed catalog cache; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<SessionId, CatalogFetch>()
  // Per-session lexicon invalidation listeners (subscribeLexicon consumers).
  const lexiconListeners = new Map<SessionId, Set<() => void>>()

  const notifyLexicon = (sessionId: SessionId): void => {
    for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
      try {
        listener()
      } catch (error) {
        // Contain listener failures: settlement notifies from an ignored
        // promise chain (a throw would surface as an unhandled rejection)
        // and one faulty consumer must not starve the others.
        console.error('[ui-skill] lexicon listener failed:', error)
      }
    }
  }

  const fetchCatalog = (sessionId: SessionId): CatalogFetch => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing
    const abort = new AbortController()
    const promise = (async () => {
      if (sessions.binding(sessionId) === undefined) {
        throw new Error(`skill catalog requires a retained session "${sessionId}"`)
      }
      return sessions.using(sessionId, { source: 'skillCatalog', signal: abort.signal }, async (reference) => {
        abort.signal.throwIfAborted()
        const state = reference.binding.session.getSnapshot()
        if (state.openState !== 'open') {
          throw state.openError ?? new Error(`session "${sessionId}" is not open`)
        }
        const result = await skills.list({ sessionId }, abort.signal)
        abort.signal.throwIfAborted()
        if (!result.ok) throw new Error(`skills/list failed: ${result.error.code}: ${result.error.message}`)
        return result.value.skills
      })
    })()
    const entry: CatalogFetch = { promise, abort }
    fetches.set(sessionId, entry)
    promise.then(
      // Settled snapshot backs the synchronous lexicon reads.
      (skills) => {
        entry.settled = skills
        notifyLexicon(sessionId)
      },
      // A failed fetch must not poison the key: the next consumer retries.
      () => {
        if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
      },
    )
    return entry
  }

  const invalidate = (key: SessionId): void => {
    const entry = fetches.get(key)
    if (entry === undefined) return
    fetches.delete(key)
    entry.abort.abort()
    notifyLexicon(key)
  }

  const clearAll = (): void => {
    for (const key of [...fetches.keys()]) invalidate(key)
  }

  /** Drop every cached catalog and refetch the ones that were open, so an install or switch shows up at once. */
  const refresh = (): void => {
    const open = [...fetches.keys()]
    clearAll()
    for (const key of open) {
      if (sessions.subagentAddress(key) === undefined) fetchCatalog(key).promise.catch(() => {})
    }
  }

  // Display titles contributed by other plugins (the market names its skills); a
  // skill without one shows its name.
  const labels = createSkillLabels()
  const labelOf = (name: string): string | undefined => labels.getSnapshot().get(name)
  const chipOf = (name: string) => ({
    source: SOURCE, ref: `/${name}`, label: labelOf(name) ?? name, appearance: 'skill' as const, clipboardText: `/${name}`,
  })

  // The bound translate resolves against the registered dictionaries with the
  // locale service's own fallback ladder; candidate-time reads stay plain text.
  const t = ctx.locale.bind(NS)

  const source = {
    trigger: '/',
    name: SOURCE,
    order: 2,
    async candidates(session, { query, signal }) {
      if (sessions.subagentAddress(session.sessionId) !== undefined) return []
      const skills = await fetchCatalog(session.sessionId).promise
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (signal.aborted) return []
      // The same ranking as the command group of this menu: case-insensitive
      // ordered subsequence, prefix hits first; a display title is the second key.
      const titled = skills.map((skill) => {
        const label = labelOf(skill.name)
        return label === undefined ? skill : { ...skill, label }
      })
      return rankByName(titled, query)
        .map(skill => ({
          name: skill.name,
          ...'label' in skill ? { label: skill.label } : {},
          icon: IconSkillOutlineRegular,
          // The user-only marker rides the description (the menu's only
          // secondary text); `hint` is the claim-state ghost text, not a badge.
          description: skill.modelInvocable ? skill.description : `${t('menu.userOnly')} · ${skill.description}`,
        }))
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      if (sessions.subagentAddress(session.sessionId) !== undefined) return
      fetchCatalog(session.sessionId).promise.catch(() => {})
    },
    lexicon(session) {
      return fetches.get(session.sessionId)?.settled?.map(skill => skill.name)
    },
    subscribeLexicon(session, listener) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    openReference(session, { ref }) {
      if (sessions.subagentAddress(session.sessionId) !== undefined) return false
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      const open = (catalog: readonly SkillEntry[]): boolean => {
        const path = catalog.find(skill => `/${skill.name}` === ref)?.path
        if (path === undefined) return false
        ctx.sidebarRight.openResource(fileAddressFor(session.sessionId, cwd, path))
        return true
      }
      const settled = fetches.get(session.sessionId)?.settled
      if (settled !== undefined) return open(settled)
      const entry = fetchCatalog(session.sessionId)
      void entry.promise.then((catalog) => {
        if (!entry.abort.signal.aborted) open(catalog)
      }).catch((error: unknown) => {
        if (!entry.abort.signal.aborted) console.error('[ui-skill] reference preview failed:', error)
      })
      return true
    },
    onPick({ candidate }) {
      // The pick lands an atomic chip showing the skill's icon and title, but
      // the prompt still ships the literal `/name` (see the codec): determinism
      // lives host-side — the host's pre-step boundary (dsh-tool-skill)
      // recognizes the leading /name and injects the rendered body for every
      // entry point, a hand-typed token included. A name shared with a host
      // command still resolves to the command: adjudication reads the same
      // literal and claims the line client-side before it ever becomes a prompt.
      return { insert: chipOf(candidate.name) }
    },
    // A chip is its literal on the clipboard and on the prompt wire alike.
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  } satisfies InputTriggerSource

  const service: UiSkill = {
    contributeLabels: labelSource => labels.contribute(labelSource),
    labelOf,
    draft(name, text) {
      const chip = chipOf(name)
      return {
        text: `${chip.clipboardText} ${text}`,
        references: [{ ...chip, offset: 0, length: chip.clipboardText.length }],
      }
    },
    compose(parts) {
      let text = ''
      const references: DraftReference[] = []
      for (const part of parts) {
        if ('text' in part && part.text.trim() === '') continue
        // A chip literal must stand alone between spaces to be read as a skill gesture.
        if (text !== '') text += ' '
        if ('text' in part) {
          text += part.text.trim()
          continue
        }
        const chip = chipOf(part.skill)
        references.push({ ...chip, offset: text.length, length: chip.clipboardText.length })
        text += chip.clipboardText
      }
      return { text, references }
    },
    refresh,
  }
  ctx.provide('uiSkill', service)

  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node',
    key: 'skill',
    priority: 100,
    inject: (sessionId): SkillReferenceInjected => ({
      openSkill: (name) => {
        if (sessions.scope(sessionId) === undefined) return
        source.openReference({ sessionId }, { ref: `/${name}` })
      },
      labels,
    }),
  }, SkillReference))

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  // A preset decides which skill providers an agent reads, so a switched
  // session's cached catalog belongs to the composition it no longer runs.
  ctx.remote.$on('agent-preset/selected', invalidate)
  // The Host announces every manager operation after its reload without
  // naming what changed, and a switched plugin may register providers in the
  // global layer every session reads, so each one drops every cached catalog.
  ctx.remote.$on('plugin-manager/changed', clearAll)
  ctx.on('connection/reset', clearAll)
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      clearAll()
    }
  }, 'ui-skill: source')
}
