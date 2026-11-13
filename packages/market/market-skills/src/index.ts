/**
 * Skill kind of the market. Installed market skills reach every Agent through
 * one global skill provider, and the `marketSkills` Remote namespace lists the
 * skills the user installed, from the market or a personal skill folder,
 * switches them on and off through the skill registry's `disabled` setting,
 * and deletes personal skills from their folder.
 * @module @deepseek-ai/dsh-market-skills
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { InstalledItem, MarketCatalogItem, MarketKind } from '@deepseek-ai/dsh-market'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-settings'
import type { SkillCandidate, SkillCatalogSnapshot, SkillProviderControl, SkillProviderObservation, SkillSummary } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { extractSkillImport, invalidImport } from './import-archive.ts'
import type {
  InstalledSkillOrigin, InstalledSkillsValue, InstalledSkillView, SkillDocumentValue, SkillNameRequest, SkillSwitchRequest,
  SkillImportRequest, SkillImportValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Skill kind of the market and the installed-skill management Remote. */
    marketSkills: MarketSkills
  }
}

/** Provider name of installed market skills; the management page reports them with origin `market`. */
export const MARKET_SKILL_PROVIDER = 'market'

/**
 * The user's personal skill folders by filesystem source, `<DSH home>/skills` and
 * `~/.agents/skills`, where skill-creator writes. They resolve the same `DSH_HOME` and
 * `DSH_AGENTS_HOME` the filesystem provider's default roots read. Every other source belongs
 * to the application, its composition, or the open project, so the management page leaves it out.
 */
const PERSONAL_ROOTS: ReadonlyMap<string, () => string> = new Map([
  ['user-dsh', () => join(resolveDshHome(), 'skills')],
  ['user-agents', () => join(resolveAgentsHome(), 'skills')],
])

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
  private readonly lifetime = new AbortController()
  private readonly fileOperations = new Set<Promise<SkillImportValue | InstalledSkillsValue>>()

  /**
   * @param ctx - Host context with the market, skill registry and working directory services.
   * @param config - the skill registry entry the switches write to.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'marketSkills', { namespace: 'marketSkills' })
    this.registryEntry = config.registryEntry ?? 'skill'
    ctx.effect(function* (this: MarketSkills) {
      let inner: FileSystemSkillProvider | undefined
      yield ctx.effect(() => async () => { await inner?.dispose() }, 'market-skills: provider')
      yield ctx.skills.registerProvider((control: SkillProviderControl) => {
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
      const kind: MarketKind = {
        kind: 'skill',
        validate: (directory, item) => validateSkillDirectory(ctx, directory, item),
        sync: (items) => { this.sync(items); return Promise.resolve() },
      }
      yield ctx.effect(() => ctx.market.registerKind(kind), 'market-skills: kind')
      // Accepted writes need this registration's invalidation until publication and cleanup finish.
      yield ctx.effect(() => async () => {
        this.lifetime.abort(new Error('market-skills disposed'))
        await Promise.allSettled(this.fileOperations)
      }, 'market-skills: file operations')
    }.bind(this), 'market-skills: lifecycle')
  }

  /**
   * Install one ZIP or Markdown upload as `<DSH home>/skills/<name>/SKILL.md`.
   * Resources are preserved without executing them. Existing skills, paths and disabled settings
   * remain unchanged. Cancellation before directory publication removes staging; after publication,
   * success returns the committed name without a fallible list read. Disposal waits for all imports.
   * @param request - one canonical base64 file whose skill frontmatter supplies its identity.
   * @param signal - caller cancellation before publication.
   * @returns the installed name, after registry invalidation.
   * @throws RemoteError `market-skills/import-invalid` for invalid content,
   *   `market-skills/import-conflict` for an existing name, or `market-skills/import-failed`
   *   when pre-publication file work fails; existing skills are never replaced.
   */
  @Remote
  async importSkill(request: SkillImportRequest, signal: AbortSignal): Promise<SkillImportValue> {
    const operation = this.importFile(request, AbortSignal.any([signal, this.lifetime.signal]))
    this.fileOperations.add(operation)
    try { return await operation } finally { this.fileOperations.delete(operation) }
  }

  private async importFile(request: SkillImportRequest, signal: AbortSignal): Promise<SkillImportValue> {
    let staging: string | undefined
    let committed: SkillImportValue | undefined
    try {
      signal.throwIfAborted()
      const home = resolveDshHome()
      const stagingRoot = join(home, 'skill-imports')
      await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
      staging = await mkdtemp(join(stagingRoot, 'upload-'))
      await extractSkillImport(request, staging, signal)
      const skill = await inspectSkillDirectory(this.ctx, staging)
      signal.throwIfAborted()
      if (skill === undefined) invalidImport('invalid-skill')
      if (Buffer.byteLength(skill.name) > 255 || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(skill.name)) invalidImport('invalid-skill')
      const root = join(home, 'skills')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const source = staging
      await this.withNameLock(skill.name, async () => {
        signal.throwIfAborted()
        await this.checkImportConflict(skill.name, signal)
        signal.throwIfAborted()
        await rename(source, join(root, skill.name))
        committed = { name: skill.name }
      }, signal)
      this.invalidate?.()
      return { name: skill.name }
    } catch (error) {
      if (committed !== undefined) {
        this.ctx.logger.warn(`market-skills: upload committed but its lock could not be released: ${String(error)}`)
        this.invalidate?.()
        return committed
      }
      signal.throwIfAborted()
      if (error instanceof RemoteError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('market-skills/import-failed', reason, { reason })
    } finally {
      if (staging !== undefined) {
        try { await rm(staging, { recursive: true, force: true }) } catch (error) {
          this.ctx.logger.warn(`market-skills: failed to remove upload staging ${staging}: ${String(error)}`)
        }
      }
    }
  }

  private async checkImportConflict(name: string, signal: AbortSignal): Promise<void> {
    // Include disabled and non-personal sources; the installed page is only a subset of this list.
    this.invalidate?.()
    const snapshot = await this.defaultSnapshot(signal)
    if (!snapshot.complete) throw new Error('cannot establish skill-name availability; a skill provider is unavailable')
    const skill = snapshot.skills.find(entry => entry.name === name)
    if (skill !== undefined) throw new RemoteError('market-skills/import-conflict', `skill ${name} already exists`, { name, source: skill.source })
    for (const [source, root] of PERSONAL_ROOTS) {
      const directory = root()
      const entries = await readdir(directory).catch((error: unknown) => {
        if (isAbsent(error)) return []
        throw error
      })
      if (entries.some(entry => entry.normalize('NFC').toLowerCase() === name || entry.normalize('NFC').toLowerCase() === `${name}.md`)) {
        throw new RemoteError('market-skills/import-conflict', `personal skill path ${name} already exists`, { name, source })
      }
      // lstat also detects a broken link, which must not be replaced by a directory rename.
      if (await lstat(join(directory, name)).catch((error: unknown) => {
        if (isAbsent(error)) return undefined
        throw error
      }) !== undefined) throw new RemoteError('market-skills/import-conflict', `personal skill path ${name} already exists`, { name, source })
    }
  }

  private async withNameLock<T>(name: string, operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const locks = join(resolveDshHome(), 'skill-import-locks')
    await mkdir(locks, { recursive: true, mode: 0o700 })
    return await withFileLock(join(locks, createHash('sha256').update(name).digest('hex')), operation, { signal })
  }

  /**
   * List the skills the user installed that a new conversation in the default workspace sees, with their switches.
   * @param signal - caller cancellation.
   * @returns market downloads and personal skills, including disabled ones, sorted by name.
   */
  @Remote
  async installed(signal: AbortSignal): Promise<InstalledSkillsValue> {
    const snapshot = await this.defaultSnapshot(signal)
    const disabled = new Set(this.ctx.skills.disabledNames())
    return {
      skills: snapshot.skills.flatMap((skill) => {
        const origin = originOf(skill)
        return origin === undefined ? [] : [view(skill, origin, !disabled.has(skill.name))]
      }),
      complete: snapshot.complete,
    }
  }

  /**
   * Delete one personal skill: its directory under a personal skill folder, or its Markdown file
   * when it sits in the folder itself. A symbolic link is removed, never its target. Market
   * downloads are removed by the market's `uninstallPackage`.
   * @param request - the skill name.
   * @param signal - cancellation while waiting for the name lock and for the following list read.
   * @returns the list after the deletion.
   * @throws RemoteError `market-skills/not-found` when no skill of that name is visible, or
   *   `market-skills/remove-failed` when it is not a personal skill or its files cannot be deleted.
   */
  @Remote
  async uninstallPersonal(request: SkillNameRequest, signal: AbortSignal): Promise<InstalledSkillsValue> {
    const operation = this.removePersonal(request, AbortSignal.any([signal, this.lifetime.signal]))
    this.fileOperations.add(operation)
    try { return await operation } finally { this.fileOperations.delete(operation) }
  }

  private async removePersonal(request: SkillNameRequest, signal: AbortSignal): Promise<InstalledSkillsValue> {
    try {
      await this.withNameLock(request.name, async () => {
        this.invalidate?.()
        const skill = (await this.defaultSnapshot(signal)).skills.find(entry => entry.name === request.name)
        if (skill === undefined) throw new RemoteError('market-skills/not-found', `no skill named ${request.name}`, { name: request.name })
        const target = personalTarget(skill)
        if (target === undefined) {
          throw new RemoteError('market-skills/remove-failed', `${request.name} is not in a personal skill folder`, { name: request.name, reason: 'not-personal' })
        }
        // rm removes a symbolic link or junction itself and never descends into its target.
        await rm(target, { recursive: true, force: true })
      }, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof RemoteError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('market-skills/remove-failed', reason, { name: request.name, reason })
    }
    // The filesystem provider's watcher reports the deletion only after its stability delay.
    this.invalidate?.()
    return await this.installed(signal)
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

  /** Every skill a new conversation in the default workspace sees, disabled ones included. */
  private async defaultSnapshot(signal: AbortSignal): Promise<SkillCatalogSnapshot> {
    const lease = await this.defaultScope()
    try {
      return await this.ctx.skills.snapshot({
        cwd: this.ctx.workingDirectory.defaultDirectory,
        signal,
        includeDisabled: true,
        ...lease === undefined ? {} : { scope: lease.key },
      })
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
  }
}

/** @returns the origin of a skill the user installed, or undefined for one the application or project ships. */
function originOf(skill: SkillSummary): InstalledSkillOrigin | undefined {
  if (skill.provider === MARKET_SKILL_PROVIDER) return 'market'
  return PERSONAL_ROOTS.has(skill.source) ? 'user' : undefined
}

/**
 * @returns the path that holds one personal skill: a directory that is a direct child of its
 *   personal folder, or a Markdown file directly in that folder; undefined anywhere else.
 */
function personalTarget(skill: SkillSummary): string | undefined {
  const root = skill.provider === MARKET_SKILL_PROVIDER ? undefined : PERSONAL_ROOTS.get(skill.source)?.()
  if (root === undefined || skill.resourceBase?.kind !== 'directory' || skill.path === undefined) return undefined
  // The base is the listed entry as spelled under the folder, so a linked directory resolves to the link.
  const base = resolve(skill.resourceBase.path)
  if (base !== root && dirname(base) === root) return base
  const file = resolve(skill.path)
  return base === root && dirname(file) === root ? file : undefined
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
  const skill = await inspectSkillDirectory(ctx, directory)
  if (skill === undefined) throw new Error('SKILL.md needs YAML frontmatter with a valid name and a description')
  if (skill.name !== item.id) throw new Error(`SKILL.md name is ${skill.name}; the catalog id is ${item.id}`)
}

/** Use the serving parser so imported metadata and invocation policy follow registry rules. */
async function inspectSkillDirectory(ctx: Context, directory: string): Promise<SkillCandidate | undefined> {
  if ((await stat(join(directory, 'SKILL.md')).catch((error: unknown) => {
    if (isAbsent(error)) return undefined
    throw error
  }))?.isFile() !== true) return undefined
  const lifetime = new AbortController()
  const rootFile = await realpath(join(directory, 'SKILL.md'))
  const probe = new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate: () => {} }, {
    providerName: 'market-validate', includeDefaultRoots: false, customSkillDirs: [directory], watch: false,
  })
  try {
    const { candidates } = candidatesOf(await probe.list({}))
    return candidates.find(candidate => candidate.path === rootFile)
  } finally {
    lifetime.abort()
    await probe.dispose()
  }
}

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

export default MarketSkills
