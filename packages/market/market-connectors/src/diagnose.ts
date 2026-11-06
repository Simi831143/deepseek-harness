/**
 * Why a connector did not start, in a form the page can show: a hint code for common causes,
 * a readable one-line reason, and the program's last stderr lines. Also the check run before a
 * custom connector's program starts, because on Windows a command that is not found does not
 * fail the spawn: cross-spawn hands it to `cmd.exe`, and the SDK reports only a closed connection.
 */
import { stat } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join, resolve, win32 } from 'node:path'
import type { ConnectorHint } from './types.ts'

/** Characters of a reason that came from an HTML error page. */
const HTML_REASON_CHARS = 300
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'])

/** What a failed start left behind. */
export interface StartFailure {
  readonly error: string
  readonly hint?: ConnectorHint
  readonly stderr?: readonly string[]
}

/**
 * Look a command up the way the program will be started: a path is checked as it is, relative to
 * the working directory; a bare name is searched on `PATH`, on Windows also with each `PATHEXT`
 * extension and in the working directory first.
 * @param command - command as configured.
 * @param cwd - the program's working directory.
 * @param env - the program's environment, whose `PATH` and `PATHEXT` count.
 * @param platform - platform whose lookup rules apply.
 * @returns the file the command names, or undefined when there is none.
 */
export async function findCommand(
  command: string, cwd: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const windows = platform === 'win32'
  const extensions = windows
    ? ['', ...(envValue(env, 'PATHEXT', windows) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : ['']
  // An explicit extension is tried as written first; without one Windows only runs PATHEXT files.
  const candidates = (base: string): string[] => windows && extname(base) === '' ? extensions.slice(1).map(ext => base + ext) : extensions.map(ext => base + ext)
  const hasSeparator = command.includes('/') || (windows && command.includes('\\'))
  if (isAbsolute(command) || (windows && win32.isAbsolute(command)) || hasSeparator) {
    return firstFile(candidates(resolve(cwd, command)))
  }
  const separator = windows ? ';' : delimiter
  const directories = (envValue(env, 'PATH', windows) ?? '').split(separator).map(entry => entry.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
  for (const directory of windows ? [cwd, ...directories] : directories) {
    const found = await firstFile(candidates(join(directory, command)))
    if (found !== undefined) return found
  }
  return undefined
}

/** An environment variable, matched without case on Windows; a later spelling wins. */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string, windows: boolean): string | undefined {
  let value: string | undefined
  for (const [key, entry] of Object.entries(env)) {
    if (key === name || (windows && key.toUpperCase() === name)) value = entry
  }
  return value
}

async function firstFile(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    if ((await stat(path).catch(() => undefined))?.isFile() === true) return path
  }
  return undefined
}

/**
 * Check that a working directory exists.
 * @param path - directory path.
 * @returns whether the directory exists.
 */
export async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true
}

/**
 * Describe a failed start.
 * @param error - what the mcp-client instance threw.
 * @param transport - the connector's transport, which decides which hints apply.
 * @param url - a remote connector's address.
 * @returns the reason, the hint when the cause is a common one, and stderr lines when there are any.
 */
export function describeStartFailure(error: unknown, transport: 'stdio' | 'streamable-http', url?: string): StartFailure {
  const chain = causes(error)
  const stderr = chain.map(item => (item as { stderr?: unknown }).stderr).find(isStringList)
  const hint = hintOf(chain, transport, url)
  return {
    error: readableReason(describeError(error)),
    ...hint === undefined ? {} : { hint },
    ...stderr === undefined || stderr.length === 0 ? {} : { stderr },
  }
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function causes(error: unknown): object[] {
  const chain: object[] = []
  let current: unknown = error
  while (typeof current === 'object' && current !== null && chain.length < 8 && !chain.includes(current)) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

function hintOf(chain: readonly object[], transport: 'stdio' | 'streamable-http', url: string | undefined): ConnectorHint | undefined {
  const codes = chain.map(item => (item as { code?: unknown }).code).filter((code): code is string => typeof code === 'string')
  const statuses = chain.map(item => (item as { data?: { status?: unknown } }).data?.status).filter((status): status is number => typeof status === 'number')
  const timedOut = codes.includes('REQUEST_TIMEOUT')
  if (transport === 'stdio') return timedOut ? 'start-timeout' : undefined
  if (timedOut || codes.some(code => UNREACHABLE_CODES.has(code))) return 'unreachable'
  if (statuses.some(status => status === 401 || status === 403)) return 'unauthorized'
  if (statuses.some(status => status === 404 || status === 405) || isSsePath(url)) return 'maybe-sse'
  // fetch reports refused connections and bad ports as a TypeError without a status.
  if (statuses.length === 0 && chain.some(item => item instanceof TypeError && item.message === 'fetch failed')) return 'unreachable'
  return undefined
}

function isSsePath(url: string | undefined): boolean {
  if (url === undefined) return false
  try {
    return /\/sse\/?$/i.test(new URL(url).pathname)
  } catch (_invalid) {
    return false
  }
}

/**
 * One line for an error and the causes it wraps, such as mcp-client's startup failure.
 * @param error - thrown value.
 * @returns the distinct messages of the chain, joined.
 */
export function describeError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  while (current instanceof Error && parts.length < 4) {
    if (!parts.includes(current.message)) parts.push(current.message)
    current = current.cause
  }
  return parts.length === 0 ? String(error) : parts.join(': ')
}

/** Text of a reason that carries an HTML error page, which the SDK puts into its message whole. */
function readableReason(reason: string): string {
  if (!/<(?:!doctype|html|body|head)\b/i.test(reason)) return reason
  const text = reason
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > HTML_REASON_CHARS ? `${text.slice(0, HTML_REASON_CHARS)}…` : text
}
