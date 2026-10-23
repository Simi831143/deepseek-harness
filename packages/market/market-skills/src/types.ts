/** JSON values of the `marketSkills` Remote namespace. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The skill switch could not be saved. */
    'market-skills/settings-unavailable': { readonly reason: string }
    /** No skill of this name is visible to a new conversation. */
    'market-skills/not-found': { readonly name: string }
  }
}

/** Where an installed skill comes from: a market download, or the user's personal skill folder. */
export type InstalledSkillOrigin = 'market' | 'user'

/** One skill the user installed that new conversations see, enabled or not. */
export interface InstalledSkillView {
  readonly name: string
  readonly description: string
  readonly origin: InstalledSkillOrigin
  /** Absolute instruction file path when the provider exposes one. */
  readonly path?: string
  readonly enabled: boolean
  /** Whether the market page can uninstall it: only market downloads; personal skills only switch off. */
  readonly removable: boolean
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
