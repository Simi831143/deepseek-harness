/** One checkout beside this repository and the skill directories copied from it. */
export interface BundledSkillSource {
  /** Checkout directory name inside the source root. */
  readonly checkout: string
  /** Checkout-relative directory holding the skill directories. */
  readonly root: string
  /** Skill directory names copied from `root`; each `SKILL.md` must declare the same frontmatter `name`. */
  readonly skills: readonly string[]
  /** Branch the checkout must be on; omitted means any checked-out state is copied. */
  readonly branch?: string
  /** Checkout-relative license file kept outside the skill directories, copied beside them. */
  readonly license?: string
}

/** Runtime subdirectory holding one directory per bundled skill. */
export const BUNDLED_SKILL_DIRECTORY: string

/** Runtime subdirectory holding the license file of each source that keeps one outside its skill directories. */
export const BUNDLED_SKILL_LICENSE_DIRECTORY: string

/** Runtime file recording the skills preparation copied and the checkout state each came from. */
export const BUNDLED_SKILL_MANIFEST: string

/** Skill sources this build carries, each a checkout beside this repository. */
export const BUNDLED_SKILL_SOURCES: readonly BundledSkillSource[]

/**
 * Copy every listed skill into the runtime resources and record where each came from.
 * @param runtimeDir - Desktop runtime resource directory outside ASAR.
 * @param env - Preparation environment; `DSH_DESKTOP_BUNDLED_SKILLS_DIR` overrides the checkout root and
 *   `DSH_DESKTOP_ALLOW_MISSING_SKILLS=1` lets an absent checkout be omitted with a warning.
 * @param sources - Skill sources to copy.
 */
export function prepareBundledSkills(runtimeDir: string, env?: NodeJS.ProcessEnv, sources?: readonly BundledSkillSource[]): void

/**
 * Check that packaged resources carry every skill preparation recorded.
 * @param runtimeDir - Packaged `runtime` resources directory.
 */
export function verifyBundledSkills(runtimeDir: string): void
