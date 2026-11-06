/**
 * Custom connectors: reading pasted JSON, the configuration rules, the command lookup and the
 * failure hints. The process tests start real stdio programs and a local Streamable HTTP
 * server; they run on Windows only, like the market connector tests.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Market from '@deepseek-ai/dsh-market'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import MarketConnectors, { findCommand, normalizeCustomConfig, parseCustomConnectors, parseLenientJson } from '../src/index.ts'
import { describeStartFailure } from '../src/diagnose.ts'
import type { CustomConnectorConfig, ParsedCustomEntry } from '../src/types.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-custom-connectors-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const NONE = new Set<string>()

describe('parseCustomConnectors', () => {
  it('reads an mcpServers block with a local program, a remote service and an SSE server', () => {
    const parsed = parseCustomConnectors(JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\docs'], env: { LOG: 1 }, autoApprove: [] },
        time: { type: 'stdio', command: 'uvx', args: ['mcp-server-time'], disabled: true },
        everything: { type: 'streamableHttp', url: 'http://127.0.0.1:3001/mcp', headers: { Authorization: 'Bearer t' } },
        legacy: { type: 'sse', url: 'http://127.0.0.1:3001/sse' },
      },
    }), NONE)
    expect(parsed.problem).toBeUndefined()
    expect(parsed.entries).toEqual<ParsedCustomEntry[]>([
      {
        name: 'filesystem', enabled: true, ignored: ['autoApprove'],
        config: { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\docs'], env: { LOG: '1' } },
      },
      { name: 'time', enabled: false, ignored: [], config: { name: 'time', transport: 'stdio', command: 'uvx', args: ['mcp-server-time'], env: {} } },
      {
        name: 'everything', enabled: true, ignored: [],
        config: { name: 'everything', transport: 'streamable-http', url: 'http://127.0.0.1:3001/mcp', headers: { Authorization: 'Bearer t' } },
      },
      { name: 'legacy', enabled: true, ignored: [], problem: 'sse' },
    ])
  })

  it('reads VS Code servers with comments and trailing commas', () => {
    const parsed = parseCustomConnectors(`{
      // VS Code keeps inputs beside the servers
      "inputs": [],
      "servers": {
        "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/", }, /* trailing */
      },
    }`, NONE)
    expect(parsed.entries.map(entry => [entry.name, entry.config?.transport])).toEqual([['github', 'streamable-http']])
  })

  it('reads a server copied without the surrounding braces', () => {
    const parsed = parseCustomConnectors('"memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },', NONE)
    expect(parsed.entries.map(entry => entry.name)).toEqual(['memory'])
  })

  it('names a single unnamed server after the package or host it uses', () => {
    expect(parseCustomConnectors('{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem@1.2.0", "D:\\\\docs"] }', NONE).entries[0]?.name)
      .toBe('server-filesystem')
    expect(parseCustomConnectors('{ "command": "docker", "args": ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"] }', NONE).entries[0]?.name)
      .toBe('github-mcp-server')
    expect(parseCustomConnectors('{ "url": "https://mcp.example.com/mcp" }', NONE).entries[0]?.name).toBe('example')
    expect(parseCustomConnectors('{ "command": "C:\\\\tools\\\\lab-server.exe" }', NONE).entries[0]?.name).toBe('lab-server')
  })

  it('fits names to the name rule and keeps them unique', () => {
    const parsed = parseCustomConnectors(JSON.stringify({
      mcpServers: {
        'github.com': { url: 'https://a.example/mcp' },
        'github-com': { url: 'https://b.example/mcp' },
        ['x'.repeat(30)]: { command: 'node' },
        飞书: { command: 'node' },
      },
    }), NONE)
    expect(parsed.entries.map(entry => [entry.name, entry.renamedFrom, entry.problem])).toEqual([
      ['github-com', 'github.com', undefined],
      ['github-com', undefined, 'name-taken'],
      ['x'.repeat(25), 'x'.repeat(30), undefined],
      ['server', '飞书', undefined],
    ])
  })

  it('marks names already in use without case', () => {
    const parsed = parseCustomConnectors(JSON.stringify({ mcpServers: { GitHub: { url: 'https://a.example/mcp' } } }), new Set(['github']))
    expect(parsed.entries[0]).toMatchObject({ name: 'GitHub', problem: 'name-taken' })
  })

  it.each([
    ['an unknown type', { type: 'websocket', url: 'ws://x' }, 'unknown-type', 'websocket'],
    ['args that are not a list', { command: 'npx', args: '-y pkg' }, 'invalid-field', 'args'],
    ['env values that are objects', { command: 'npx', env: { A: { b: 1 } } }, 'invalid-field', 'env'],
    ['a relative working directory', { command: 'npx', cwd: 'docs' }, 'cwd-not-absolute', 'docs'],
    ['a URL that is not http', { url: 'ftp://example.com/mcp' }, 'invalid-url', 'ftp://example.com/mcp'],
    ['a stdio type without command', { type: 'stdio', args: [] }, 'no-command-or-url', undefined],
  ])('reports %s', (_label, server, problem, detail) => {
    const entry = parseCustomConnectors(JSON.stringify({ mcpServers: { lab: server } }), NONE).entries[0]
    expect(entry).toMatchObject({ name: 'lab', problem })
    expect(entry?.detail).toBe(detail)
    expect(entry?.config).toBeUndefined()
  })

  it('reports text that is not JSON or names no server', () => {
    expect(parseCustomConnectors('npx -y something', NONE)).toMatchObject({ entries: [], problem: 'not-json' })
    expect(parseCustomConnectors('{ "mcpServers": {} }', NONE)).toEqual({ entries: [], problem: 'no-servers' })
    expect(parseCustomConnectors('[1, 2]', NONE)).toEqual({ entries: [], problem: 'no-servers' })
  })

  it('keeps comment markers inside strings', () => {
    expect(parseLenientJson('{ "url": "http://host/a//b", "note": "/* x */" }')).toEqual({ url: 'http://host/a//b', note: '/* x */' })
  })
})

describe('normalizeCustomConfig', () => {
  const stdio: CustomConnectorConfig = { name: 'lab', transport: 'stdio', command: ' npx ', args: ['-y'], env: {}, cwd: ' ' }

  it('trims and drops empty optional fields', () => {
    expect(normalizeCustomConfig(stdio)).toEqual({ name: 'lab', transport: 'stdio', command: 'npx', args: ['-y'], env: {} })
  })

  it.each<[string, CustomConnectorConfig, string]>([
    ['a name with a dot', { ...stdio, name: 'a.b' }, 'invalid-name'],
    ['a name of 26 characters', { ...stdio, name: 'n'.repeat(26) }, 'invalid-name'],
    ['an empty command', { ...stdio, command: '  ' }, 'no-command-or-url'],
    ['a command with a line break', { ...stdio, command: 'npx\nrm' }, 'invalid-field'],
    ['an env name with a dash', { ...stdio, env: { 'A-B': '1' } }, 'invalid-field'],
    ['a zero timeout', { ...stdio, toolCallTimeoutMs: 0 }, 'invalid-field'],
    ['a header value with a line break', { name: 'lab', transport: 'streamable-http', url: 'https://x/mcp', headers: { A: 'b\r\nc' } }, 'invalid-field'],
    ['a header name with a space', { name: 'lab', transport: 'streamable-http', url: 'https://x/mcp', headers: { 'X Token': 'b' } }, 'invalid-field'],
    ['an empty URL', { name: 'lab', transport: 'streamable-http', url: ' ', headers: {} }, 'no-command-or-url'],
    ['a URL that does not parse', { name: 'lab', transport: 'streamable-http', url: 'not a url', headers: {} }, 'invalid-url'],
  ])('refuses %s', (_label, config, problem) => {
    expect(() => normalizeCustomConfig(config)).toThrow(expect.objectContaining({ problem }))
  })
})

describe('findCommand', () => {
  it('finds a bare name through PATH and PATHEXT on Windows, and a path as written', async () => {
    const dir = await tempDir()
    const bin = join(dir, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'tool.CMD'), '@echo off\r\n')
    await writeFile(join(bin, 'plain'), '')
    const env = { Path: `"${bin}";C:\\missing`, PATHEXT: '.EXE;.CMD' }
    expect(await findCommand('tool', dir, env, 'win32')).toBe(join(bin, 'tool.CMD'))
    expect(await findCommand('tool.cmd', dir, env, 'win32')).toBe(join(bin, 'tool.cmd'))
    // Windows starts only PATHEXT files for a name without an extension.
    expect(await findCommand('plain', dir, env, 'win32')).toBeUndefined()
    expect(await findCommand('missing', dir, env, 'win32')).toBeUndefined()
    expect(await findCommand(join(bin, 'tool'), dir, env, 'win32')).toBe(join(bin, 'tool.CMD'))
    expect(await findCommand('bin\\tool.CMD', dir, {}, 'win32')).toBe(join(bin, 'tool.CMD'))
  })

  it('searches only PATH on other platforms', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'tool'), '')
    expect(await findCommand('tool', tmpdir(), { PATH: dir }, 'linux')).toBe(join(dir, 'tool'))
    expect(await findCommand('tool', dir, { PATH: '' }, 'linux')).toBeUndefined()
  })
})

describe('describeStartFailure', () => {
  function httpError(status: number, message: string): Error {
    return Object.assign(new Error(message), { code: 'CLIENT_HTTP_NOT_IMPLEMENTED', data: { status, statusText: '', text: message } })
  }
  function startup(cause: unknown, stderr: string[] = []): Error {
    return Object.assign(new Error('mcp-client(custom-lab): initial connection or tool synchronization failed', { cause }), { stderr })
  }

  it('names common remote failures', () => {
    expect(describeStartFailure(startup(httpError(401, 'unauthorized')), 'streamable-http', 'https://x/mcp').hint).toBe('unauthorized')
    expect(describeStartFailure(startup(httpError(405, 'Method Not Allowed')), 'streamable-http', 'https://x/mcp').hint).toBe('maybe-sse')
    expect(describeStartFailure(startup(httpError(500, 'boom')), 'streamable-http', 'https://x/sse').hint).toBe('maybe-sse')
    expect(describeStartFailure(startup(httpError(400, 'missing required Authorization header')), 'streamable-http', 'https://x/mcp')).toEqual({
      error: 'mcp-client(custom-lab): initial connection or tool synchronization failed: missing required Authorization header',
    })
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
    expect(describeStartFailure(startup(refused), 'streamable-http', 'http://127.0.0.1:9/mcp').hint).toBe('unreachable')
    expect(describeStartFailure(startup(new TypeError('fetch failed', { cause: new Error('bad port') })), 'streamable-http', 'http://x:1/mcp').hint).toBe('unreachable')
  })

  it('names a slow local start and keeps its stderr', () => {
    const failure = describeStartFailure(startup(Object.assign(new Error('Request timed out'), { code: 'REQUEST_TIMEOUT' }), ['Downloading 40 MB']), 'stdio')
    expect(failure).toEqual({
      error: 'mcp-client(custom-lab): initial connection or tool synchronization failed: Request timed out',
      hint: 'start-timeout',
      stderr: ['Downloading 40 MB'],
    })
  })

  it('keeps only the text of an HTML error page', () => {
    const page = `<!doctype html><html><head><style>body{color:red}</style></head><body><h1>502 Bad&nbsp;Gateway</h1>${'<p>more</p>'.repeat(80)}</body></html>`
    const { error } = describeStartFailure(startup(httpError(502, `Error POSTing to endpoint: ${page}`)), 'streamable-http', 'https://x/mcp')
    expect(error.startsWith('mcp-client(custom-lab): initial connection or tool synchronization failed: Error POSTing to endpoint: 502 Bad Gateway more')).toBe(true)
    expect(error).not.toContain('<')
    expect(error.length).toBeLessThanOrEqual(301)
  })
})

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))
const WAIT = { timeout: 20_000 }

async function mount() {
  const home = await tempDir()
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('typert', {})
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry, { disabled: [] })
  // No catalog server: the market runs offline, which custom connectors do not need.
  await ctx.plugin(Market, { catalogUrl: 'http://127.0.0.1:9/index.json', home: join(home, 'market') })
  await ctx.plugin(MarketConnectors)
  return ctx
}

function view(ctx: Context, id: string) {
  return ctx.marketConnectors.connectorList().connectors.find(entry => entry.id === id)
}

async function lines(log: string): Promise<string[]> {
  return (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean)
}

/**
 * Process ids of the echo programs still alive. The log cannot say: the SDK terminates its
 * version probe process, which on Windows ends it before it can write its exit line.
 */
async function runningPids(log: string): Promise<string[]> {
  const pids = (await lines(log)).filter(line => line.startsWith('start')).map(line => line.split(' ').at(-1) as string)
  return pids.filter((pid) => {
    try {
      process.kill(Number(pid), 0)
      return true
    } catch (_gone) {
      return false
    }
  })
}

/**
 * A dependency-free Streamable HTTP MCP server with one `echo` tool. It answers JSON-RPC POSTs
 * with JSON bodies, refuses the modern discovery probe so the client falls back to `initialize`,
 * and has no event stream, which the client tolerates as 405.
 */
interface RpcMessage {
  readonly id?: number | string
  readonly method: string
  readonly params?: { readonly protocolVersion?: string; readonly arguments?: { readonly text?: string } }
}

async function serveHttp(): Promise<{ readonly url: string; readonly requests: string[] }> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    requests.push(`${req.method ?? ''} ${req.headers.authorization ?? ''}`)
    if (req.headers.authorization !== 'Bearer lab-token') { res.writeHead(401).end('missing token'); return }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', () => {
      const message = JSON.parse(body) as RpcMessage
      if (message.id === undefined) { res.writeHead(202).end(); return }
      const reply = (payload: object): void => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...payload }))
      }
      switch (message.method) {
        case 'initialize':
          reply({ result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-echo', version: '1' } } })
          return
        case 'tools/list':
          reply({ result: { tools: [{ name: 'echo', description: 'Repeat the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
          return
        case 'tools/call':
          reply({ result: { content: [{ type: 'text', text: message.params?.arguments?.text ?? '' }] } })
          return
        default:
          reply({ error: { code: -32601, message: `no ${message.method}` } })
      }
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve() }) }))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, requests }
}

describe.runIf(process.platform === 'win32')('custom connectors', () => {
  async function echoConfig(name: string, log: string, version = '1'): Promise<CustomConnectorConfig> {
    return { name, transport: 'stdio', command: process.execPath, args: [ECHO_SERVER], env: { FIXTURE_LOG: log, FIXTURE_VERSION: version } }
  }

  it('adds a local program that runs at once, restarts it when changed, and stops it when switched off or removed', async () => {
    const ctx = await mount()
    const log = join(await tempDir(), 'events.log')
    await ctx.marketConnectors.saveCustomConnector({ config: await echoConfig('Echo', log) })
    await vi.waitFor(() => { expect(view(ctx, 'custom-Echo')).toMatchObject({ origin: 'custom', state: 'connected', confirmed: true }) }, WAIT)
    expect(ctx.tools.get('mcp__custom-Echo__echo')).toBeDefined()
    expect(view(ctx, 'custom-Echo')?.custom).toMatchObject({ env: { FIXTURE_VERSION: '1' } })
    await vi.waitFor(async () => { expect(await runningPids(log)).toHaveLength(1) }, WAIT)
    const [firstPid] = await runningPids(log)

    await expect(ctx.marketConnectors.saveCustomConnector({ config: await echoConfig('echo', log) }))
      .rejects.toMatchObject({ code: 'market-connectors/name-taken' })

    await ctx.marketConnectors.saveCustomConnector({ previousName: 'Echo', config: await echoConfig('Echo', log, '2') })
    await vi.waitFor(() => { expect(view(ctx, 'custom-Echo')?.state).toBe('connected') }, WAIT)
    await vi.waitFor(async () => { expect(await runningPids(log)).toHaveLength(1) }, WAIT)
    expect(await runningPids(log)).not.toContain(firstPid)
    expect((await lines(log)).filter(line => line.startsWith('start')).at(-1)).toMatch(/^start 2 /)

    await ctx.marketConnectors.setConnectorEnabled({ id: 'custom-Echo', enabled: false })
    expect(ctx.tools.get('mcp__custom-Echo__echo')).toBeUndefined()
    expect(view(ctx, 'custom-Echo')).toMatchObject({ enabled: false, state: 'off' })
    await vi.waitFor(async () => { expect(await runningPids(log)).toEqual([]) }, WAIT)

    await ctx.marketConnectors.setConnectorEnabled({ id: 'custom-Echo', enabled: true })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__custom-Echo__echo')).toBeDefined() }, WAIT)
    await ctx.marketConnectors.removeCustomConnector({ name: 'Echo' })
    expect(ctx.tools.get('mcp__custom-Echo__echo')).toBeUndefined()
    expect(view(ctx, 'custom-Echo')).toBeUndefined()
    await vi.waitFor(async () => { expect(await runningPids(log)).toEqual([]) }, WAIT)
    await expect(ctx.marketConnectors.removeCustomConnector({ name: 'Echo' })).rejects.toMatchObject({ code: 'market-connectors/not-found' })
  }, 60_000)

  it('renames a connector by stopping the old one and starting the new one', async () => {
    const ctx = await mount()
    const log = join(await tempDir(), 'events.log')
    await ctx.marketConnectors.saveCustomConnector({ config: await echoConfig('one', log), enabled: false })
    expect(view(ctx, 'custom-one')).toMatchObject({ enabled: false, state: 'off' })
    await ctx.marketConnectors.saveCustomConnector({ previousName: 'one', config: await echoConfig('two', log), enabled: true })
    await vi.waitFor(() => { expect(view(ctx, 'custom-two')?.state).toBe('connected') }, WAIT)
    expect(view(ctx, 'custom-one')).toBeUndefined()
    await expect(ctx.marketConnectors.saveCustomConnector({ previousName: 'gone', config: await echoConfig('three', log) }))
      .rejects.toMatchObject({ code: 'market-connectors/not-found' })
  }, 60_000)

  it('refuses a configuration that breaks a rule', async () => {
    const ctx = await mount()
    await expect(ctx.marketConnectors.saveCustomConnector({ config: { name: 'a b', transport: 'stdio', command: 'npx', args: [], env: {} } }))
      .rejects.toMatchObject({ code: 'market-connectors/invalid-custom', details: { name: 'a b', problem: 'invalid-name', detail: 'a b' } })
    await expect(ctx.marketConnectors.setConnectorEnabled({ id: 'custom-none', enabled: true }))
      .rejects.toMatchObject({ code: 'market-connectors/not-installed' })
  })

  it('reports a command that is not found without starting anything', async () => {
    const ctx = await mount()
    await ctx.marketConnectors.saveCustomConnector({ config: { name: 'missing', transport: 'stdio', command: 'dsh-no-such-command-zz9', args: [], env: {} } })
    await vi.waitFor(() => { expect(view(ctx, 'custom-missing')?.state).toBe('failed') }, WAIT)
    expect(view(ctx, 'custom-missing')).toMatchObject({ hint: 'command-not-found', error: 'command dsh-no-such-command-zz9 was not found' })
    await ctx.marketConnectors.saveCustomConnector({
      previousName: 'missing', config: { name: 'missing', transport: 'stdio', command: process.execPath, args: [], env: {}, cwd: join(tmpdir(), 'dsh-no-such-dir-zz9') },
    })
    await vi.waitFor(() => { expect(view(ctx, 'custom-missing')?.hint).toBe('cwd-not-found') }, WAIT)
  })

  it('shows the stderr of a program that exits, and starts it again on retry', async () => {
    const ctx = await mount()
    const script = join(await tempDir(), 'broken.mjs')
    await writeFile(script, "process.stderr.write('error: No solution found when resolving tool dependencies\\n'); process.exit(2)\n")
    await ctx.marketConnectors.saveCustomConnector({ config: { name: 'broken', transport: 'stdio', command: process.execPath, args: [script], env: {}, cwd: dirname(script) } })
    await vi.waitFor(() => { expect(view(ctx, 'custom-broken')?.state).toBe('failed') }, WAIT)
    expect(view(ctx, 'custom-broken')?.stderr).toEqual(['error: No solution found when resolving tool dependencies'])
    expect(view(ctx, 'custom-broken')?.hint).toBeUndefined()
    const before = ctx.marketConnectors.connectorList().revision
    const retried = await ctx.marketConnectors.retryConnector({ id: 'custom-broken' })
    expect(retried.connectors.find(entry => entry.id === 'custom-broken')?.state).toBe('starting')
    expect(retried.revision).toBeGreaterThan(before)
    await vi.waitFor(() => { expect(view(ctx, 'custom-broken')?.state).toBe('failed') }, WAIT)
    // The second failure is a change of its own, newer than the call's result.
    expect(ctx.marketConnectors.connectorList().revision).toBeGreaterThan(retried.revision)
  }, 60_000)

  it('connects to a remote service with its headers and names a refused token', async () => {
    const ctx = await mount()
    const { url, requests } = await serveHttp()
    await ctx.marketConnectors.saveCustomConnector({ config: { name: 'remote', transport: 'streamable-http', url, headers: { Authorization: 'Bearer lab-token' } } })
    await vi.waitFor(() => { expect(view(ctx, 'custom-remote')?.state).toBe('connected') }, WAIT)
    expect(ctx.tools.get('mcp__custom-remote__echo')).toBeDefined()
    expect(view(ctx, 'custom-remote')?.launch).toBeUndefined()

    await ctx.marketConnectors.saveCustomConnector({ config: { name: 'denied', transport: 'streamable-http', url, headers: {} } })
    await vi.waitFor(() => { expect(view(ctx, 'custom-denied')?.state).toBe('failed') }, WAIT)
    expect(view(ctx, 'custom-denied')?.hint).toBe('unauthorized')
    expect(requests.some(line => line.endsWith('Bearer lab-token'))).toBe(true)
  }, 60_000)

  it('lists custom connectors by name and parses against the names in use', async () => {
    const ctx = await mount()
    const log = join(await tempDir(), 'events.log')
    await ctx.marketConnectors.saveCustomConnector({ config: await echoConfig('beta', log), enabled: false })
    await ctx.marketConnectors.saveCustomConnector({ config: await echoConfig('Alpha', log), enabled: false })
    expect(ctx.marketConnectors.connectorList().connectors.map(entry => entry.id)).toEqual(['custom-Alpha', 'custom-beta'])
    const parsed = ctx.marketConnectors.parseCustomConnectors({ text: '{ "mcpServers": { "ALPHA": { "command": "npx" }, "gamma": { "command": "npx" } } }' })
    expect(parsed.entries.map(entry => [entry.name, entry.problem])).toEqual([['ALPHA', 'name-taken'], ['gamma', undefined]])
  })
})
