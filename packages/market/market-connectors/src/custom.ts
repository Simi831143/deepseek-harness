/**
 * Custom connectors: MCP servers the user adds outside the market, by pasting the JSON an MCP
 * project publishes or by filling in a form. This module reads pasted JSON, checks one
 * configuration against the rules, and turns it into the mcp-client instance it runs as.
 * Nothing here touches the disk.
 */
import { isAbsolute, win32 } from 'node:path'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {
  CustomConnectorConfig, CustomProblem, ParsedCustomConnectors, ParsedCustomEntry,
} from './types.ts'

/** Prefix of a custom connector's id and mcp-client `serverName`; market connector ids may not use it. */
export const CUSTOM_PREFIX = 'custom-'

/** Longest name: mcp-client allows a 32-character `serverName`, and the prefix takes 7. */
export const CUSTOM_NAME_MAX = 32 - CUSTOM_PREFIX.length

const NAME = /^[A-Za-z0-9_-]+$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** RFC 9110 header field name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const LINE_BREAK = /[\r\n]/

/** A configuration that breaks a rule. */
export class CustomConfigError extends Error {
  override name = 'CustomConfigError'

  /**
   * @param problem - which rule.
   * @param detail - the offending field or value, when one is named.
   */
  constructor(readonly problem: CustomProblem, readonly detail?: string) {
    super(detail === undefined ? problem : `${problem}: ${detail}`)
  }
}

/**
 * Id of a custom connector, which is also its mcp-client `serverName`.
 * @param name - custom connector name.
 * @returns the id and mcp-client `serverName` of the connector.
 */
export function customId(name: string): string {
  return `${CUSTOM_PREFIX}${name}`
}

/**
 * Check one configuration and return it in its stored shape: trimmed strings, no empty optional fields.
 * @param config - configuration from the form or from pasted JSON.
 * @returns the normalized configuration.
 * @throws CustomConfigError when a rule is broken.
 */
export function normalizeCustomConfig(config: CustomConnectorConfig): CustomConnectorConfig {
  const name = config.name.trim()
  if (name.length === 0 || name.length > CUSTOM_NAME_MAX || !NAME.test(name)) throw new CustomConfigError('invalid-name', config.name)
  const timeout = config.toolCallTimeoutMs
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMER_DELAY_MS)) {
    throw new CustomConfigError('invalid-field', 'toolCallTimeoutMs')
  }
  const timeoutField = timeout === undefined ? {} : { toolCallTimeoutMs: timeout }
  if (config.transport === 'stdio') {
    const command = config.command.trim()
    if (command === '') throw new CustomConfigError('no-command-or-url')
    if (LINE_BREAK.test(command)) throw new CustomConfigError('invalid-field', 'command')
    for (const [index, arg] of config.args.entries()) {
      if (typeof arg !== 'string') throw new CustomConfigError('invalid-field', `args[${index}]`)
    }
    for (const [key, value] of Object.entries(config.env)) {
      if (!ENV_NAME.test(key) || typeof value !== 'string') throw new CustomConfigError('invalid-field', `env.${key}`)
    }
    const cwd = config.cwd?.trim() ?? ''
    if (cwd !== '' && !isAbsolute(cwd) && !win32.isAbsolute(cwd)) throw new CustomConfigError('cwd-not-absolute', cwd)
    return {
      name, transport: 'stdio', command, args: [...config.args], env: { ...config.env },
      ...cwd === '' ? {} : { cwd }, ...timeoutField,
    }
  }
  const url = config.url.trim()
  if (url === '') throw new CustomConfigError('no-command-or-url')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (_invalid) {
    throw new CustomConfigError('invalid-url', url)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new CustomConfigError('invalid-url', url)
  for (const [key, value] of Object.entries(config.headers)) {
    if (!HEADER_NAME.test(key) || typeof value !== 'string' || LINE_BREAK.test(value)) throw new CustomConfigError('invalid-field', `headers.${key}`)
  }
  return { name, transport: 'streamable-http', url, headers: { ...config.headers }, ...timeoutField }
}

/** mcp-client instance config of one local program. */
export interface McpStdioLaunch {
  readonly transport: 'stdio'
  readonly serverName: string
  readonly command: string
  readonly args: string[]
  readonly env: Record<string, string>
  readonly cwd: string
  readonly toolCallTimeoutMs?: number
  readonly failOnStartupError: true
}

/** mcp-client instance config of one remote service. */
export interface McpHttpLaunch {
  readonly transport: 'streamable-http'
  readonly serverName: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly toolCallTimeoutMs?: number
  readonly failOnStartupError: true
}

/** mcp-client instance config of one connector program or service. */
export type McpLaunch = McpStdioLaunch | McpHttpLaunch

/**
 * Turn a custom configuration into the mcp-client instance config it runs with.
 * @param config - a normalized custom configuration.
 * @param home - working directory when the configuration names none.
 * @returns the mcp-client config the connector runs with.
 */
export function customLaunch(config: CustomConnectorConfig, home: string): McpLaunch {
  const timeout = config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }
  const serverName = customId(config.name)
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio', serverName, command: config.command, args: [...config.args], env: { ...config.env },
      cwd: config.cwd ?? home, failOnStartupError: true, ...timeout,
    }
  }
  return { transport: 'streamable-http', serverName, url: config.url, headers: { ...config.headers }, failOnStartupError: true, ...timeout }
}

// ---- Pasted JSON ----

const STDIO_FIELDS = new Set(['command', 'args', 'env', 'cwd'])
const HTTP_FIELDS = new Set(['url', 'serverUrl', 'headers'])
const SHARED_FIELDS = new Set(['type', 'transport', 'disabled', 'enabled'])
const HTTP_TYPES = new Set(['http', 'streamable-http', 'streamablehttp', 'streamable_http'])
/** Launchers whose first argument that is not an option names the server package. */
const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'uv', 'pipx', 'pnpm', 'npm', 'yarn', 'bun', 'deno', 'node', 'python', 'python3', 'py'])

/**
 * Read the MCP servers in pasted text. Accepts `{ "mcpServers": { ... } }` (Claude Desktop,
 * Cursor and most READMEs), VS Code's `{ "servers": { ... } }`, the bare object of servers, a
 * single server object, and the same text without its outer braces; comments and trailing
 * commas are allowed. Names that break the name rule are changed to fit.
 * @param text - pasted text.
 * @param taken - names already in use, lower-cased.
 * @returns every server found, each with its configuration or the reason it cannot be added.
 */
export function parseCustomConnectors(text: string, taken: ReadonlySet<string>): ParsedCustomConnectors {
  let root: unknown
  try {
    root = parseLenientJson(text)
  } catch (error) {
    return { entries: [], problem: 'not-json', detail: error instanceof Error ? error.message : String(error) }
  }
  const servers = serversOf(root)
  if (servers.length === 0) return { entries: [], problem: 'no-servers' }
  const used = new Set(taken)
  const entries = servers.map(([key, raw]): ParsedCustomEntry => {
    const read = readServer(raw)
    const preferred = key ?? (read.config === undefined ? 'server' : suggestName(read.config))
    const fitted = fitName(preferred)
    const name = key !== undefined && fitted === key ? key : unique(fitted, used)
    const renamed = key !== undefined && name !== key ? { renamedFrom: key } : {}
    const base = { name, ...renamed, enabled: read.enabled, ignored: read.ignored }
    if (read.problem !== undefined) return { ...base, problem: read.problem, ...read.detail === undefined ? {} : { detail: read.detail } }
    if (used.has(name.toLowerCase())) return { ...base, problem: 'name-taken' }
    used.add(name.toLowerCase())
    try {
      return { ...base, config: normalizeCustomConfig({ ...read.config, name }) }
    } catch (error) {
      if (!(error instanceof CustomConfigError)) throw error
      return { ...base, problem: error.problem, ...error.detail === undefined ? {} : { detail: error.detail } }
    }
  })
  return { entries }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeServer(value: Record<string, unknown>): boolean {
  return ['command', 'url', 'serverUrl', 'type'].some(key => key in value)
}

/** The servers in parsed JSON, keyed by name; a single unnamed server has no key. */
function serversOf(root: unknown): (readonly [string | undefined, unknown])[] {
  if (!isRecord(root)) return []
  if (looksLikeServer(root)) return [[undefined, root]]
  const holder = isRecord(root.mcpServers) ? root.mcpServers : isRecord(root.servers) ? root.servers : root
  return Object.entries(holder).filter(([, value]) => isRecord(value) && looksLikeServer(value))
}

/** A server's configuration without its name, or why it cannot be used. */
type ReadServer = {
  readonly enabled: boolean
  readonly ignored: string[]
} & (
  | { readonly config: DistributiveOmit<CustomConnectorConfig, 'name'>; readonly problem?: undefined }
  | { readonly config?: undefined; readonly problem: CustomProblem; readonly detail?: string }
)

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function readServer(raw: unknown): ReadServer {
  const server = raw as Record<string, unknown>
  const enabled = server.disabled !== true && server.enabled !== false
  const declared = typeof server.type === 'string' ? server.type : typeof server.transport === 'string' ? server.transport : undefined
  const type = declared?.toLowerCase()
  const fail = (problem: CustomProblem, detail?: string): ReadServer => ({
    enabled, ignored: [], problem, ...detail === undefined ? {} : { detail },
  })
  if (type === 'sse') return fail('sse')
  let transport: 'stdio' | 'streamable-http'
  if (type === 'stdio') transport = 'stdio'
  else if (type !== undefined && HTTP_TYPES.has(type)) transport = 'streamable-http'
  else if (type !== undefined) return fail('unknown-type', declared)
  else if ('command' in server) transport = 'stdio'
  else if ('url' in server || 'serverUrl' in server) transport = 'streamable-http'
  else return fail('no-command-or-url')
  const used = transport === 'stdio' ? STDIO_FIELDS : HTTP_FIELDS
  const ignored = Object.keys(server).filter(key => !used.has(key) && !SHARED_FIELDS.has(key))
  const problem = (detail: string): ReadServer => ({ enabled, ignored, problem: 'invalid-field', detail })
  if (transport === 'stdio') {
    if (typeof server.command !== 'string') return server.command === undefined ? { ...fail('no-command-or-url'), ignored } : problem('command')
    const args = stringList(server.args)
    if (args === undefined) return problem('args')
    const env = stringRecord(server.env)
    if (env === undefined) return problem('env')
    if (server.cwd !== undefined && typeof server.cwd !== 'string') return problem('cwd')
    const cwd = typeof server.cwd === 'string' && server.cwd.trim() !== '' ? { cwd: server.cwd } : {}
    return { config: { transport, command: server.command, args, env, ...cwd }, enabled, ignored }
  }
  const url = server.url ?? server.serverUrl
  if (typeof url !== 'string') return url === undefined ? { ...fail('no-command-or-url'), ignored } : problem('url')
  const headers = stringRecord(server.headers)
  if (headers === undefined) return problem('headers')
  return { config: { transport, url, headers }, enabled, ignored }
}

/** Strings, numbers and booleans as strings; undefined for anything else. */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return undefined
  const list = value.map(scalar)
  return list.every(item => item !== undefined) ? list : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).map(([key, item]) => [key, scalar(item)] as const)
  return entries.every(([, item]) => item !== undefined) ? Object.fromEntries(entries) as Record<string, string> : undefined
}

/** A name for a server pasted without one, from the package it runs or the host it reaches. */
function suggestName(config: DistributiveOmit<CustomConnectorConfig, 'name'>): string {
  if (config.transport === 'streamable-http') {
    try {
      return new URL(config.url).hostname.split('.').filter(part => part !== 'www' && part !== 'mcp')[0] ?? 'server'
    } catch (_invalid) {
      return 'server'
    }
  }
  const program = config.command.split(/[\\/]/).at(-1)?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() ?? ''
  const operands = config.args.filter(arg => !arg.startsWith('-'))
  const operand = program === 'docker' ? operands.at(-1) : PACKAGE_RUNNERS.has(program) ? operands[0] : undefined
  if (operand === undefined) return program
  // `@scope/name@1.2.3` and `git+https://.../name.git` both name the package last.
  return operand.replace(/@[^@/]*$/, '').split(/[\\/:]/).filter(Boolean).at(-1)?.replace(/\.(git|py|js|mjs|ts)$/i, '') ?? program
}

/** Replace characters outside the name rule with `-` and cut to the length limit. */
function fitName(name: string): string {
  const fitted = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, CUSTOM_NAME_MAX).replace(/-+$/, '')
  return fitted === '' ? 'server' : fitted
}

/** `name`, or `name-2`, `name-3`, ... when it is taken. */
function unique(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name.toLowerCase())) return name
  for (let index = 2; ; index += 1) {
    const suffix = `-${index}`
    const candidate = `${name.slice(0, CUSTOM_NAME_MAX - suffix.length)}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Parse JSON that may have comments, trailing commas, or no outer braces, as README snippets
 * often do.
 * @param text - pasted text.
 * @returns the parsed value.
 * @throws SyntaxError when the text is not JSON even after those repairs.
 */
export function parseLenientJson(text: string): unknown {
  const cleaned = stripJsonComments(text).trim()
  try {
    return JSON.parse(cleaned)
  } catch (error) {
    // `"github": { ... }` copied without the object around it.
    if (cleaned.startsWith('"')) {
      try {
        return JSON.parse(`{${cleaned.replace(/,\s*$/, '')}}`)
      } catch (_stillNotJson) {
        // Report the error of the text as pasted.
      }
    }
    throw error
  }
}

/** Remove `//` and `/* *\/` comments, then trailing commas, outside strings. */
function stripJsonComments(text: string): string {
  return dropTrailingCommas(walkOutsideStrings(text, (rest) => {
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n')
      return end === -1 ? rest.length : end
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2)
      return end === -1 ? rest.length : end + 2
    }
    return 0
  }))
}

function dropTrailingCommas(text: string): string {
  return walkOutsideStrings(text, rest => /^,\s*[}\]]/.test(rest) ? 1 : 0)
}

/**
 * Copy `text`, letting `skip` drop characters outside JSON strings.
 * @param text - source text.
 * @param skip - given the text from the current position, how many characters to drop there.
 * @returns the text without the dropped characters.
 */
function walkOutsideStrings(text: string, skip: (rest: string) => number): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
      continue
    }
    const dropped = skip(text.slice(index))
    if (dropped > 0) {
      index += dropped
      continue
    }
    out += text.charAt(index)
    index += 1
  }
  return out
}
