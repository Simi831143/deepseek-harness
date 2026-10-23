/**
 * Skill kind of the market. Installed market skills reach every Agent through
 * one global skill provider, and the `marketSkills` Remote namespace lists the
 * skills the user installed, from the market or a personal skill folder, and
 * switches them on and off through the skill registry's `disabled` setting.
 * @module @deepseek-ai/dsh-market-skills
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { InstalledItem, MarketCatalogItem, MarketKind } from '@deepseek-ai/dsh-market'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-settings'
import type { SkillCandidate, SkillProviderControl, SkillProviderObservation, SkillSummary } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  InstalledSkillOrigin, InstalledSkillsValue, InstalledSkillView, SkillDocumentValue, SkillNameRequest, SkillSwitchRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Skill kind of the market and the installed-skill management Remote. */
    marketSkills: MarketSkills
  }
}

/** Provider name of installed market skills; the management page marks them removable. */
export const MARKET_SKILL_PROVIDER = 'market'

/**
 * Filesystem sources of the user's personal skill folders, `<DSH home>/skills` and
 * `~/.agents/skills`, where skill-creator writes. Every other source belongs to the
 * application, its composition, or the open project, so the management page leaves it out.
 */
const PERSONAL_SOURCES: ReadonlySet<string> = new Set(['user-dsh', 'user-agents'])

/** Configuration of the skill kind. */
export interface Config {
  /** Profile entry id of the `@deepseek-ai/dsh-skill` row whose `disabled` setting the switches write. */
  registryEntry?: string
}

/** Host owner of the skill kind and the `marketSkills` Remote namespace. */
export class MarketSkills extends TypertRemoteService {
  static inject = ['market', 'skills', 'workingDirectory', 'typert']

  private readonly registryEntry: string
  /** Ids of installed market skills; the provider lists only these. */
  private readonly installedIds = new Set<string>()
  private invalidate: (() => void) | undefined

  /**
   * @param ctx - Host context with the market, skill registry and working directory services.
   * @param config - the skill registry entry the switches write to.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'marketSkills', { namespace: 'marketSkills' })
    this.registryEntry = config.registryEntry ?? 'skill'
    let inner: FileSystemSkillProvider | undefined
    ctx.skills.registerProvider((control: SkillProviderControl) => {
      this.invalidate = control.invalidate
      inner = new FileSystemSkillProvider(ctx, control, {
        providerName: MARKET_SKILL_PROVIDER,
        includeDefaultRoots: false,
        customSkillDirs: [ctx.market.kindDirectory('skill')],
        watch: false,
      })
      const provider = inner
      return {
        name: MARKET_SKILL_PROVIDER,
        list: async options => this.onlyInstalled(await provider.list(options)),
        get: (candidate, options) => provider.get(candidate, options),
      }
    })
    ctx.effect(() => async () => { await inner?.dispose() }, 'market-skills: provider')
    const kind: MarketKind = {
      kind: 'skill',
      validate: (directory, item) => validateSkillDirectory(ctx, directory, item),
      sync: (items) => { this.sync(items); return Promise.resolve() },
    }
    ctx.effect(() => ctx.market.registerKind(kind), 'market-skills: kind')
  }

  /**
   * List the skills the user installed that a new conversation in the default workspace sees, with their switches.
   * @param signal - caller cancellation.
   * @returns market downloads and personal skills, including disabled ones, sorted by name.
   */
  @Remote
  async installed(signal: AbortSignal): Promise<InstalledSkillsValue> {
    const lease = await this.defaultScope()
    try {
      const snapshot = await this.ctx.skills.snapshot({
        cwd: this.ctx.workingDirectory.defaultDirectory,
        signal,
        includeDisabled: true,
        ...lease === undefined ? {} : { scope: lease.key },
      })
      const disabled = new Set(this.ctx.skills.disabledNames())
      return {
        skills: snapshot.skills.flatMap((skill) => {
          const origin = originOf(skill)
          return origin === undefined ? [] : [view(skill, origin, !disabled.has(skill.name))]
        }),
        complete: snapshot.complete,
      }
    } finally {
      await lease?.[Symbol.asyncDispose]()
    }
  }

  /**
   * Switch skills on or off for every new model request, whatever their source.
   * @param request - skill names and the target state.
   * @param signal - caller cancellation for the list read that follows the write.
   * @returns the list after the change.
   * @throws RemoteError `market-skills/settings-unavailable` when the setting cannot be written.
   */
  @Remote
  async setEnabled(request: SkillSwitchRequest, signal: AbortSignal): Promise<InstalledSkillsValue> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new RemoteError('market-skills/settings-unavailable', 'the settings service is not mounted', { reason: 'no-settings' })
    }
    const disabled = new Set(this.ctx.skills.disabledNames())
    for (const name of request.names) {
      if (request.enabled) disabled.delete(name)
      else disabled.add(name)
    }
    try {
      await settings.update(this.registryEntry, { disabled: [...disabled].sort() })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('market-skills/settings-unavailable', reason, { reason })
    }
    return await this.installed(signal)
  }

  /**
   * Read the instructions of one skill, enabled or not, for the detail dialog.
   * @param request - the skill name.
   * @param signal - caller cancellation.
   * @returns the Markdown body without frontmatter, and the declared version.
   * @throws RemoteError `market-skills/not-found` when no skill of that name is visible.
   */
  @Remote
  async document(request: SkillNameRequest, signal: AbortSignal): Promise<SkillDocumentValue> {
    const lease = await this.defaultScope()
    try {
      const skill = await this.ctx.skills.get(request.name, {
        cwd: this.ctx.workingDirectory.defaultDirectory,
        signal,
        includeDisabled: true,
        ...lease === undefined ? {} : { scope: lease.key },
      })
      if (skill === undefined) throw new RemoteError('market-skills/not-found', `no skill named ${request.name}`, { name: request.name })
      const version = skill.metadata?.version
      return { name: skill.name, content: skill.content, ...typeof version === 'string' ? { version } : {} }
    } finally {
      await lease?.[Symbol.asyncDispose]()
    }
  }

  /** Hold the default preset's scope so the list includes personal skills, as a new conversation would. */
  private async defaultScope(): Promise<({ key: ScopeKey } & AsyncDisposable) | undefined> {
    try {
      return await this.ctx.get('agentPresets')?.acquireScope()
    } catch (_unusablePreset) {
      // An unusable default preset leaves the global view, which still lists bundled and market skills.
      return undefined
    }
  }

  /** A directory left behind by an interrupted install has no record, so it stays invisible. */
  private onlyInstalled(output: readonly SkillCandidate[] | SkillProviderObservation): SkillProviderObservation {
    const observation = candidatesOf(output)
    return { candidates: observation.candidates.filter(candidate => this.installedIds.has(candidate.name)), complete: observation.complete }
  }

  private sync(items: readonly InstalledItem[]): void {
    this.installedIds.clear()
    for (const item of items) this.installedIds.add(item.record.id)
    this.invalidate?.()
  }
}

/** Normalize a provider's two return forms into one observation. */
function candidatesOf(output: readonly SkillCandidate[] | SkillProviderObservation): SkillProviderObservation {
  return 'candidates' in output ? output : { candidates: output, complete: true }
}

function view(skill: SkillSummary, origin: InstalledSkillOrigin, enabled: boolean): InstalledSkillView {
  return {
    name: skill.name,
    description: skill.description,
    origin,
    ...skill.path === undefined ? {} : { path: skill.path },
    enabled,
    removable: origin === 'market',
  }
}

/** @returns the origin of a skill the user installed, or undefined for one the application or project ships. */
function originOf(skill: SkillSummary): InstalledSkillOrigin | undefined {
  if (skill.provider === MARKET_SKILL_PROVIDER) return 'market'
  return PERSONAL_SOURCES.has(skill.source) ? 'user' : undefined
}

/**
 * Check an unpacked skill package with the same parser that will serve it.
 * @param ctx - context for the temporary provider's logging and file access.
 * @param directory - staging directory; its root `SKILL.md` is the skill.
 * @param item - catalog entry; its id must equal the skill's frontmatter name.
 * @throws when `SKILL.md` is missing, unparsable, or names a different skill.
 */
async function validateSkillDirectory(ctx: Context, directory: string, item: MarketCatalogItem): Promise<void> {
  const file = join(directory, 'SKILL.md')
  if ((await stat(file).catch(() => undefined))?.isFile() !== true) throw new Error('package has no SKILL.md at its root')
  const lifetime = new AbortController()
  const probe = new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate: () => {} }, {
    providerName: 'market-validate', includeDefaultRoots: false, customSkillDirs: [directory], watch: false,
  })
  try {
    const { candidates } = candidatesOf(await probe.list({}))
    const skill = candidates.find(candidate => candidate.path?.endsWith('SKILL.md') === true)
    if (skill === undefined) throw new Error('SKILL.md needs YAML frontmatter with a valid name and a description')
    if (skill.name !== item.id) throw new Error(`SKILL.md name is ${skill.name}; the catalog id is ${item.id}`)
  } finally {
    lifetime.abort()
    await probe.dispose()
  }
}

export default MarketSkills
