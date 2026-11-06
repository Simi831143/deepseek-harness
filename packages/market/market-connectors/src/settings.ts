/**
 * The optional `settings.json` at the root of a market connector package: values the user fills
 * in for the connector, such as an API key. Each setting names the environment variable the
 * program reads. The values live in the credential store under one record per connector, never
 * in the package, so an update or reinstall keeps them. The file sits beside `mcp.json` instead of
 * inside it because older Desktop builds refuse an `mcp.json` with fields they do not know, while
 * they ignore a file they do not read.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** File name of the settings declaration inside a connector package. */
export const CONNECTOR_SETTINGS = 'settings.json'

/** Most settings one connector may declare. */
export const MAX_CONNECTOR_SETTINGS = 8

/** Longest value the user may save for one setting. */
export const MAX_SETTING_VALUE_LENGTH = 4096

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const textSchema = z.object({ zh: z.string().min(1), en: z.string().min(1).optional() })
const settingSchema = z.strictObject({
  env: z.string().regex(ENV_NAME),
  label: textSchema,
  description: textSchema.optional(),
  secret: z.boolean().default(true),
  required: z.boolean().default(false),
  url: z.url({ protocol: /^https?$/ }).optional(),
})
const settingsSchema = z.strictObject({
  settings: z.array(settingSchema).min(1).max(MAX_CONNECTOR_SETTINGS),
})

/** Display text in Chinese, with an optional English version. */
export interface SettingText {
  readonly zh: string
  readonly en?: string
}

/** One value a market connector asks the user for. */
export interface ConnectorSettingSpec {
  /** Environment variable the program reads the value from. */
  readonly env: string
  readonly label: SettingText
  readonly description?: SettingText
  /** Whether the value is a secret; the page never shows a saved secret. */
  readonly secret: boolean
  /** Whether the connector cannot start without the value. */
  readonly required: boolean
  /** Page where the user gets the value, such as the provider's key dashboard. */
  readonly url?: string
}

/** A `settings.json` the connector kind cannot use. */
export class ConnectorSettingsError extends Error {
  override name = 'ConnectorSettingsError'
}

/**
 * Validate `settings.json` text.
 * @param text - content of `settings.json`.
 * @param manifestEnv - names `mcp.json` already sets; a setting may not take one of them over.
 * @returns the declared settings in file order.
 * @throws ConnectorSettingsError when the text is not a valid declaration, names one variable
 *   twice, or names a variable `mcp.json` sets.
 */
export function parseConnectorSettings(text: string, manifestEnv: Iterable<string> = []): readonly ConnectorSettingSpec[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    // JSON.parse throws only SyntaxError.
    throw new ConnectorSettingsError(`${CONNECTOR_SETTINGS} is not JSON: ${(error as SyntaxError).message}`)
  }
  const parsed = settingsSchema.safeParse(raw)
  if (!parsed.success) {
    // A failed parse always carries at least one issue.
    const [issue] = parsed.error.issues as [z.core.$ZodIssue, ...z.core.$ZodIssue[]]
    throw new ConnectorSettingsError(`${CONNECTOR_SETTINGS} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const taken = new Set(manifestEnv)
  const seen = new Set<string>()
  for (const setting of parsed.data.settings) {
    if (seen.has(setting.env)) throw new ConnectorSettingsError(`${CONNECTOR_SETTINGS} declares ${setting.env} more than once`)
    if (taken.has(setting.env)) throw new ConnectorSettingsError(`${CONNECTOR_SETTINGS} declares ${setting.env}, which mcp.json already sets`)
    seen.add(setting.env)
  }
  return parsed.data.settings.map(setting => ({
    env: setting.env,
    label: textOf(setting.label),
    ...setting.description === undefined ? {} : { description: textOf(setting.description) },
    secret: setting.secret,
    required: setting.required,
    ...setting.url === undefined ? {} : { url: setting.url },
  }))
}

function textOf(text: z.infer<typeof textSchema>): SettingText {
  return text.en === undefined ? { zh: text.zh } : { zh: text.zh, en: text.en }
}

/**
 * Read the settings declaration of one package directory.
 * @param directory - absolute package directory.
 * @param manifestEnv - names the package's `mcp.json` sets.
 * @returns the declared settings; empty when the package has no `settings.json`.
 * @throws ConnectorSettingsError when the file exists but is not a valid declaration.
 */
export async function readConnectorSettings(
  directory: string, manifestEnv: Iterable<string> = [],
): Promise<readonly ConnectorSettingSpec[]> {
  let text: string
  try {
    text = await readFile(join(directory, CONNECTOR_SETTINGS), 'utf8')
  } catch (error) {
    // readFile rejects only with a system error.
    const failure = error as NodeJS.ErrnoException
    if (failure.code === 'ENOENT') return []
    throw new ConnectorSettingsError(`${CONNECTOR_SETTINGS} cannot be read: ${failure.message}`)
  }
  return parseConnectorSettings(text, manifestEnv)
}
