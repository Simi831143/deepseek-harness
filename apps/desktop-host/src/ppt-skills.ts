/** Bundled presentation skill read from the Desktop application payload. */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { PAYLOAD_DIRECTORY, SKILL_ENTRY } from './ppt-payload.ts'

/** Loader identity for the application-owned bundled skill composition. */
export const name = 'desktop-ppt-skills'
/** Application-selected bundled payload location. */
export interface Config {
  /** Bundled payload directory. A missing sibling `ppt-skills` resource omits the skill. */
  readonly source: string
}

/**
 * Publish the bundled presentation skill to every agent on this installation.
 *
 * The skill is read directly from the application's read-only resources, so it
 * depends on no user-home state and an application upgrade replaces it in
 * place. The mounted provider is isolated from project and user roots — the
 * profile's own `skill-filesystem` row keeps owning those — and watching is off
 * because a packaged payload cannot change while the application runs.
 * @param ctx - Profile scope; the filesystem provider declares its own service requirements.
 * @param config - Bundled payload source directory.
 * @returns Resolves after the provider is mounted, or immediately when this build carries no payload.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const bundledSkillDir = join(dirname(config.source), PAYLOAD_DIRECTORY)
  const entry = join(bundledSkillDir, SKILL_ENTRY, 'SKILL.md')
  if (statSync(entry, { throwIfNoEntry: false })?.isFile() !== true) {
    // The payload is an optional addition to the shipped runtime, so its
    // absence must not stop the Host from booting.
    ctx.logger.warn(`desktop ppt skills: bundled payload is absent; expected ${entry}`)
    return
  }
  await ctx.plugin(skillFilesystem, {
    providerName: 'desktop-ppt',
    includeDefaultRoots: false,
    bundledSkillDir,
    watch: false,
  })
}
