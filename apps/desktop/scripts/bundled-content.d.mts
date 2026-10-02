/** Skill directories one source checkout contributes. */
export interface BundledSkills {
  /** Checkout-relative directory holding the skill directories. */
  readonly root: string
  /** Skill directory names copied from `root`; each `SKILL.md` must declare the same frontmatter `name`. */
  readonly names: readonly string[]
}

/** One checkout beside this repository and the skills or plugin copied from it. */
export interface BundledSource {
  /** Checkout directory name inside the source root. */
  readonly checkout: string
  /** Branch the checkout must be on; omitted means any checked-out state is copied. */
  readonly branch?: string
  /** Checkout-relative license file kept outside the copied items, packaged beside them. */
  readonly license?: string
  /** Skills copied from the checkout; mutually exclusive with `plugin`. */
  readonly skills?: BundledSkills
  /**
   * Package name of the dsh bundle at the checkout root; mutually exclusive with `skills`.
   * Its `package.json` and the paths its `files` lists are copied, so the plugin must be built first.
   */
  readonly plugin?: string
}

/** Runtime subdirectory holding everything bundled-content preparation writes. */
export const BUNDLED_CONTENT_DIRECTORY: string

/** File inside the content directory recording what preparation copied and where each item came from. */
export const BUNDLED_CONTENT_MANIFEST: string

/** Sources this build carries, each a checkout beside this repository. */
export const BUNDLED_SOURCES: readonly BundledSource[]

/**
 * Copy every listed skill and plugin into the runtime resources and record where each came from.
 * @param runtimeDir - Desktop runtime resource directory outside ASAR.
 * @param env - Preparation environment; `DSH_DESKTOP_BUNDLED_SOURCES_DIR` overrides the checkout root and
 *   `DSH_DESKTOP_ALLOW_MISSING_SOURCES=1` lets an absent checkout be omitted with a warning.
 * @param sources - Sources to copy.
 */
export function prepareBundledContent(runtimeDir: string, env?: NodeJS.ProcessEnv, sources?: readonly BundledSource[]): void

/**
 * Check that packaged resources carry every item preparation recorded, byte for byte for plugins.
 * @param runtimeDir - Packaged `runtime` resources directory.
 */
export function verifyBundledContent(runtimeDir: string): void
