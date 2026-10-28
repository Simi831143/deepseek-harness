/** Verify the installed Cua Driver MCP starts from its relocated resource without model credentials. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import lock from './cua-driver-lock.json' with { type: 'json' }
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/** Tools the Desktop computer-use workflow depends on. */
const REQUIRED_TOOLS = [
  'list_apps', 'list_windows', 'launch_app', 'get_window_state', 'click', 'type_text', 'press_key', 'hotkey',
  'scroll', 'start_session', 'end_session', 'check_permissions',
]

/**
 * Exercise MCP discovery, the locked server version and a read-only permission probe.
 * The probe needs no window or input, so it runs on a build host without driving its desktop.
 * @param root - Relocated application resource directory containing cua-driver.exe.
 * @returns Resolves only after every probe succeeds and the owned subprocess closes.
 */
export async function smokeCuaDriverRuntime(root: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-cua-driver-smoke-'))
  const client = new Client({ name: 'dsh-desktop-cua-driver-smoke', version: '1' }, {
    capabilities: {}, versionNegotiation: { mode: 'auto' },
  })
  const inherited = Object.entries(scrubWindowsSigningEnvironment(process.env))
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
  const transport = new StdioClientTransport({
    command: join(root, 'cua-driver.exe'), args: ['mcp'], cwd: temporary,
    env: { ...Object.fromEntries(inherited), CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
    stderr: 'inherit',
  })
  try {
    await client.connect(transport)
    const version = client.getServerVersion()?.version
    if (version !== lock.cuaDriverVersion) throw new Error(`Cua Driver smoke: expected ${lock.cuaDriverVersion}, got ${String(version)}`)
    const { tools } = await client.listTools()
    for (const name of REQUIRED_TOOLS) {
      if (!tools.some(tool => tool.name === name)) throw new Error(`Cua Driver smoke: missing tool ${name}`)
    }
    const permissions = await client.callTool({ name: 'check_permissions', arguments: { prompt: false } }, { timeout: 60_000 })
    if (permissions.isError) throw new Error(`Cua Driver smoke check_permissions: ${JSON.stringify(permissions)}`)
    process.stdout.write(`Cua Driver MCP smoke passed (${version}, ${String(tools.length)} tools; permission probe).\n`)
  } finally {
    await client.close()
    await transport.close()
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (import.meta.main) {
  if (process.argv[2] === undefined) throw new Error('Usage: smoke-cua-driver-runtime.ts <Cua Driver resource directory>')
  await smokeCuaDriverRuntime(resolve(process.argv[2]))
}
