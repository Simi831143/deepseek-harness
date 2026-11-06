/**
 * Saved values of market connector settings. Each connector owns one `api-key` credential
 * record, `market-connectors/<id>`, whose `env` maps the declared environment variable names to
 * the values the user saved. Values never leave this module except as the environment of the
 * connector's own program.
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialKeyId, credentialKeyScope, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ConnectorSettingSpec } from './settings.ts'

/** Credential key scope of connector settings; it is the plugin's registration name. */
export const SETTINGS_SCOPE = 'market-connectors'

/** Saved environment values of one connector, by variable name. */
export type SettingValues = Readonly<Record<string, string>>

/** Reads and writes connector setting records through the credential store. */
export class ConnectorSettingStore {
  /**
   * @param ctx - context whose `credentials` service holds the records.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Read the saved values of one connector, limited to the settings it declares now.
   * @param id - connector id.
   * @param specs - the connector's declared settings.
   * @returns the saved values of declared settings.
   */
  async read(id: string, specs: readonly ConnectorSettingSpec[]): Promise<SettingValues> {
    if (specs.length === 0) return {}
    const record = await this.ctx.credentials.readRecord(keyOf(id))
    const env = record?.kind === 'api-key' ? record.env ?? {} : {}
    const declared = new Set(specs.map(spec => spec.env))
    return Object.fromEntries(Object.entries(env).filter(([name, value]) => declared.has(name) && value.length > 0))
  }

  /**
   * Apply changes to one connector's saved values; the record is removed once it holds none.
   * @param id - connector id.
   * @param changes - new values by variable name, `null` to clear one.
   */
  async write(id: string, changes: Readonly<Record<string, string | null>>): Promise<void> {
    const key = keyOf(id)
    const outcome: { empty: boolean } = { empty: false }
    // The change applies to the record as it is when the write is exclusive.
    await this.ctx.credentials.modifyRecord(key, (current) => {
      const env = new Map(Object.entries(current?.kind === 'api-key' ? current.env ?? {} : {}))
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) env.delete(name)
        else env.set(name, value)
      }
      outcome.empty = env.size === 0
      const next: CredentialRecord | undefined = outcome.empty ? undefined : { kind: 'api-key', env: Object.fromEntries(env) }
      return Promise.resolve(next)
    })
    if (outcome.empty) await this.ctx.credentials.deleteRecord(key)
  }

  /**
   * Remove the saved values of every connector that is no longer installed, including one that
   * was never switched on.
   * @param installed - ids of the installed market connectors.
   */
  async prune(installed: ReadonlySet<string>): Promise<void> {
    for (const entry of await this.ctx.credentials.listRecords()) {
      const id = ConnectorSettingStore.connectorOf(entry.key)
      if (id !== undefined && !installed.has(id)) await this.ctx.credentials.deleteRecord(entry.key)
    }
  }

  /**
   * The connector a changed credential record belongs to.
   * @param key - key from `credentials/record-updated`.
   * @returns the connector id, or undefined when the record is not a connector setting record.
   */
  static connectorOf(key: CredentialKey): string | undefined {
    return credentialKeyScope(key) === SETTINGS_SCOPE ? credentialKeyId(key) : undefined
  }
}

/**
 * A digest of saved values for the restart fingerprint, so a changed value restarts the program
 * without the value itself being kept outside the credential store.
 * @param values - saved values.
 * @returns hex SHA-256 of the sorted name/value pairs.
 */
export function digestOf(values: SettingValues): string {
  const pairs = Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
}

function keyOf(id: string): CredentialKey {
  return credentialKey(SETTINGS_SCOPE, id)
}
