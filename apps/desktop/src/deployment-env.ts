/** Read deployment-owned values without placing them in a Desktop profile. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

/** Names that the Desktop shell may inject into the Host environment. */
export const DEPLOYMENT_ENVIRONMENT_NAMES = ['FEISHU_APP_SECRET', 'LONGCHEER_API_KEY'] as const

/** Deployment environment values accepted by the Desktop shell. */
export type DeploymentEnvironment = Partial<Record<typeof DEPLOYMENT_ENVIRONMENT_NAMES[number], string>>

/** Name of the profile environment file whose legacy deployment entries are removed during migration. */
export const PROFILE_ENV_FILENAME = '.env'

/** Name of the packaged deployment environment resource. */
export const DEPLOYMENT_ENV_FILENAME = 'deployment-env.json'

/** Name of the development-only repository secret file. */
export const SECRETS_ENV_FILENAME = '.secrets.env'

/**
 * Read a development or packaged deployment environment for the Host.
 * @param options - Application mode and the two environment roots.
 * @returns Allowed deployment values, or an empty object when the source is absent.
 */
export function readDeploymentEnvironment(options: {
  readonly packaged: boolean
  readonly repositoryRoot: string
  readonly resourcesPath: string
}): DeploymentEnvironment {
  return options.packaged
    ? readJsonEnvironment(join(options.resourcesPath, DEPLOYMENT_ENV_FILENAME))
    : readSecretsEnvironment(join(options.repositoryRoot, SECRETS_ENV_FILENAME))
}

/**
 * Read an allowed subset of a JSON deployment resource.
 * @param path - JSON resource path.
 * @returns Allowed deployment values, or an empty object when the resource is absent.
 */
function readJsonEnvironment(path: string): DeploymentEnvironment {
  if (!existsSync(path)) return {}
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`dsh desktop: invalid deployment environment resource at ${path}`)
  }
  return selectDeploymentValues(value)
}

/**
 * Read the repository-local dotenv file used by unpackaged development.
 * @param path - Dotenv path.
 * @returns Allowed deployment values, or an empty object when the file is absent.
 */
function readSecretsEnvironment(path: string): DeploymentEnvironment {
  if (!existsSync(path)) return {}
  try {
    return selectDeploymentValues(parseEnv(readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')))
  } catch {
    throw new Error(`dsh desktop: invalid deployment environment dotenv at ${path}`)
  }
}

/**
 * Keep only the names owned by the Desktop deployment and ignore unrelated dotenv or JSON fields.
 * @param value - Parsed dotenv or JSON value.
 * @returns Allowed non-empty deployment values.
 */
function selectDeploymentValues(value: unknown): DeploymentEnvironment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: DeploymentEnvironment = {}
  for (const name of DEPLOYMENT_ENVIRONMENT_NAMES) {
    const candidate = Object.getOwnPropertyDescriptor(value, name)?.value
    if (typeof candidate === 'string' && candidate !== '') result[name] = candidate
  }
  return result
}

/**
 * Return the dotenv name declared by one profile line.
 * @param line - One line of the profile environment file.
 * @returns The declared name, or `undefined` for non-assignment lines.
 */
export function declaredEnvName(line: string): string | undefined {
  return /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]
}
