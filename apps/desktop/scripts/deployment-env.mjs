import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseEnv } from 'node:util'

/** Names that may be copied into the packaged Host environment. */
export const DEPLOYMENT_ENVIRONMENT_NAMES = ['FEISHU_APP_SECRET', 'LONGCHEER_API_KEY']

/**
 * Copy allowed deployment values from the development dotenv file to a build resource.
 * @param {{ source: string, target: string }} paths - Source and generated resource paths.
 * @returns {boolean} Whether a non-empty resource was generated.
 */
export function prepareDeploymentEnvironment({ source, target }) {
  if (!existsSync(source)) {
    rmSync(target, { force: true })
    return false
  }
  let values
  try {
    values = selectDeploymentValues(parseEnv(readFileSync(source, 'utf8').replace(/^\uFEFF/u, '')))
  } catch {
    throw new Error(`desktop package: invalid deployment environment dotenv at ${source}`)
  }
  if (Object.keys(values).length === 0) {
    rmSync(target, { force: true })
    return false
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(values, undefined, 2)}\n`, { mode: 0o600 })
  return true
}

/**
 * Keep only non-empty deployment values and discard unrelated dotenv names.
 * @param {Record<string, string>} values - Parsed dotenv values.
 * @returns {Record<string, string>} Allowed deployment values.
 */
function selectDeploymentValues(values) {
  return Object.fromEntries(DEPLOYMENT_ENVIRONMENT_NAMES.flatMap(name => {
    const value = values[name]
    return value === undefined || value === '' ? [] : [[name, value]]
  }))
}
