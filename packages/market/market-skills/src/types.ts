/** JSON values of the `marketSkills` Remote namespace. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The skill switch could not be saved. */
    'market-skills/settings-unavailable': { readonly reason: string }
    /** No skill of this name is visible to a new conversation. */
    'market-skills/not-found': { readonly name: string }
    /** A personal skill's files lie outside the personal skill folders or could not be deleted. */
    'market-skills/remove-failed': { readonly name: string; readonly reason: string }
    /** The uploaded file is invalid. */
    'market-skills/import-invalid': { readonly reason: SkillImportProblem }
    /** An existing skill or personal path already owns this name; nothing was replaced. */
    'market-skills/import-conflict': { readonly name: string; readonly source: string }
    /** Import stopped before publication and left existing skills unchanged. */
    'market-skills/import-failed': { readonly reason: string }
  }
}

/** Stable validation failures for localized upload feedback. */
export type SkillImportProblem = 'unsupported-file' | 'invalid-base64' | 'invalid-archive'
  | 'unsafe-path' | 'invalid-skill'

/** One ZIP or Markdown file, encoded as canonical RFC 4648 base64. */
export interface SkillImportRequest {
  readonly fileName: string
  readonly data: string
}

/** Published personal skill; returned without a fallible post-publication list read. */
export interface SkillImportValue {
  readonly name: string
}

/**
 * Where an installed skill comes from: a market download, which the market uninstalls,
 * or the user's personal skill folder, which `uninstallPersonal` deletes from.
 */
export type InstalledSkillOrigin = 'market' | 'user'

/** One skill the user installed that new conversations see, enabled or not. */
export interface InstalledSkillView {
  readonly name: string
  readonly description: string
  readonly origin: InstalledSkillOrigin
  /** Absolute instruction file path when the provider exposes one. */
  readonly path?: string
  readonly enabled: boolean
}

/**
 * The skills the user installed, from the market or a personal skill folder, that a new conversation
 * in the default workspace would see. Skills the application, its composition, or the project ships are left out.
 */
export interface InstalledSkillsValue {
  readonly skills: readonly InstalledSkillView[]
  /** False when a provider failed and the list may be missing entries. */
  readonly complete: boolean
}

/** Enable or disable several skills in one settings write. */
export interface SkillSwitchRequest {
  readonly names: readonly string[]
  readonly enabled: boolean
}

/** One skill addressed by name. */
export interface SkillNameRequest {
  readonly name: string
}

/** The instructions of one skill, for the detail dialog's overview. */
export interface SkillDocumentValue {
  readonly name: string
  /** Markdown body of the skill file, frontmatter removed. */
  readonly content: string
  /** `metadata.version` from the skill's frontmatter, when it declares one. */
  readonly version?: string
}
