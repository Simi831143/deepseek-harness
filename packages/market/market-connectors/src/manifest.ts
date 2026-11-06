/**
 * The launch manifest `mcp.json` at the root of a connector package: which program inside the
 * package to start as a stdio MCP server, with which arguments and environment. The program
 * travels with the package, so the command must name a file inside it; nothing is looked up on
 * PATH or taken from the user's machine.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { z } from 'zod'

/** File name of the launch manifest at the package root. */
export const LAUNCH_MANIFEST = 'mcp.json'

/** The only placeholder `args` and `env` values may use; it expands to the package directory. */
const DIR_PLACEHOLDER = '${dir}'
const PLACEHOLDER = /\$\{([^}]*)\}/g
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Interpreters that read PYTHONPATH and the user site directory unless started isolated. */
const PYTHON_COMMANDS = new Set(['python', 'python.exe', 'python3', 'python3.exe', 'pythonw.exe'])

const manifestSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
  toolCallTimeoutMs: z.number().int().min(1).max(MAX_TIMER_DELAY_MS).optional(),
})

/** One connector program, resolved against its package directory. */
export interface LaunchSpec {
  /** Absolute path of the program inside the package. */
  readonly command: string
  /** Command as `mcp.json` writes it, relative to the package directory. */
  readonly commandPath: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** Working directory: the package directory. */
  readonly cwd: string
  readonly toolCallTimeoutMs?: number
}

/** A launch manifest that cannot start a program. */
export class LaunchManifestError extends Error {
  override name = 'LaunchManifestError'
}

/**
 * Validate `mcp.json` text and resolve it against the package directory, without touching the disk.
 * @param directory - absolute package directory.
 * @param text - content of `mcp.json`.
 * @returns the resolved launch.
 * @throws LaunchManifestError when the text is not a valid manifest, the command leaves the
 *   package, an unknown `${...}` placeholder appears, or a Python interpreter is not started with `-I`.
 */
export function parseLaunchManifest(directory: string, text: string): LaunchSpec {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new LaunchManifestError(`${LAUNCH_MANIFEST} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new LaunchManifestError(`${LAUNCH_MANIFEST} is invalid at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'unknown issue'}`)
  }
  const manifest = parsed.data
  if (isAbsolute(manifest.command) || win32.isAbsolute(manifest.command)) {
    throw new LaunchManifestError(`${LAUNCH_MANIFEST} command must be a path inside the package, not ${manifest.command}`)
  }
  const command = resolve(directory, manifest.command)
  const inside = relative(directory, command)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new LaunchManifestError(`${LAUNCH_MANIFEST} command ${manifest.command} leaves the package`)
  }
  const expand = (value: string, where: string): string => value.replace(PLACEHOLDER, (match) => {
    if (match !== DIR_PLACEHOLDER) throw new LaunchManifestError(`${LAUNCH_MANIFEST} ${where} uses ${match}; only ${DIR_PLACEHOLDER} is supported`)
    return directory
  })
  const args = manifest.args.map((arg, index) => expand(arg, `args[${index}]`))
  if (PYTHON_COMMANDS.has(basename(command).toLowerCase()) && args[0] !== '-I') {
    throw new LaunchManifestError(`${LAUNCH_MANIFEST} starts Python; its first argument must be -I so the user's Python settings stay out`)
  }
  const env = Object.fromEntries(Object.entries(manifest.env).map(([name, value]) => [name, expand(value, `env.${name}`)]))
  return {
    command, commandPath: manifest.command, args, env, cwd: directory,
    ...manifest.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: manifest.toolCallTimeoutMs },
  }
}

/**
 * Read, validate and resolve the launch manifest of one package directory.
 * @param directory - absolute package directory.
 * @returns the resolved launch, whose command exists as a file.
 * @throws LaunchManifestError when the manifest is missing or invalid, or its command is not a file in the package.
 */
export async function readLaunchManifest(directory: string): Promise<LaunchSpec> {
  let text: string
  try {
    text = await readFile(resolve(directory, LAUNCH_MANIFEST), 'utf8')
  } catch (_missing) {
    throw new LaunchManifestError(`the package has no ${LAUNCH_MANIFEST} at its root`)
  }
  const spec = parseLaunchManifest(directory, text)
  const file = await stat(spec.command).catch(() => undefined)
  if (file?.isFile() !== true) throw new LaunchManifestError(`${LAUNCH_MANIFEST} command ${spec.commandPath} is not a file in the package`)
  return spec
}
