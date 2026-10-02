/** Bundled skills read from the Desktop application payload. */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'

/**
 * Runtime subdirectory holding the Desktop's bundled content.
 *
 * Must agree with `BUNDLED_CONTENT_DIRECTORY` in `apps/desktop/scripts/bundled-content.mjs`,
 * which decides what preparation copies there; a build script and the Host bundle
 * cannot share a module.
 */
export const BUNDLED_CONTENT_DIRECTORY = 'bundled'

/** Content subdirectory holding one directory per bundled skill. */
export const BUNDLED_SKILL_DIRECTORY = 'skills'

/** Loader identity for the application-owned bundled skill composition. */
export const name = 'desktop-bundled-skills'
/** Application-selected bundled payload location. */
export interface Config {
  /** Bundled payload directory. A missing sibling `bundled/skills` resource omits every bundled skill. */
  readonly source: string
}

/**
 * Publish the skills this build carries to every agent on this installation.
 *
 * The skills are read directly from the application's read-only resources, so they
 * depend on no user-home state and an application upgrade replaces them in place.
 * The mounted provider is isolated from project and user roots — the profile's own
 * `skill-filesystem` row keeps owning those, and a same-named skill there takes
 * precedence over a bundled one — and watching is off because a packaged payload
 * cannot change while the application runs. Packaging fails a build whose resources
 * lack a recorded skill, so a missing directory here only occurs in a development
 * launch that prepared none.
 * @param ctx - Profile scope; the filesystem provider declares its own service requirements.
 * @param config - Bundled payload source directory.
 * @returns Resolves after the provider is mounted, or immediately when the payload carries no skills.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const bundledSkillDir = join(dirname(config.source), BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY)
  if (statSync(bundledSkillDir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    ctx.logger.warn(`desktop bundled skills: payload carries no skills; expected ${bundledSkillDir}`)
    return
  }
  await ctx.plugin(skillFilesystem, {
    providerName: 'desktop-bundled',
    includeDefaultRoots: false,
    bundledSkillDir,
    watch: false,
  })
}
