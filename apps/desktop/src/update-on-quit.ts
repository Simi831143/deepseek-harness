/** Install a downloaded Windows update when the user quits; every ordinary quit retries until the update lands. */

import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

// Electron's patched fs treats every *.asar as a directory and keeps it open; staged installer trees contain app.asar.
// original-fs is the unpatched module inside Electron and does not exist under plain Node, where node:fs is equivalent.
const require = createRequire(import.meta.url)
const rawFs: typeof import('node:fs') = (() => {
  try { return require('original-fs') as typeof import('node:fs') } catch { return require('node:fs') as typeof import('node:fs') }
})()

/** Persisted attempt: the version a quit install started from and the version it targeted. */
interface UpdateOnQuitRecord {
  readonly from: string
  readonly target: string
}

/** Why a quit does or does not hand over to the installer. */
export type UpdateOnQuitDecision = 'install' | 'no-update' | 'session-ending' | 'recovery' | 'mandatory' | 'unsupported'

/** Facts the quit path knows when it decides; each one that is false or set keeps the ordinary quit. */
export interface UpdateOnQuitContext {
  readonly platform: NodeJS.Platform
  readonly ready: boolean
  readonly sessionEnding: boolean
  readonly recovery: boolean
  readonly mandatory: boolean
}

/** Owns the attempt record under the Electron user-data directory; it only reports, it never stops a later install. */
export class DesktopUpdateOnQuit {
  /**
   * @param path - Record file; an unreadable or malformed record counts as no prior attempt.
   * @param currentVersion - Version of the running application.
   */
  constructor(private readonly path: string, private readonly currentVersion: string) {}

  /**
   * Read and forget the previous attempt. The caller must not load while an installer is running.
   * @returns Whether the previous quit install was interrupted: this launch still runs the version it started from.
   */
  async load(): Promise<boolean> {
    const record = await this.read()
    if (record === undefined) return false
    await this.clear()
    return record.from === this.currentVersion
  }

  /**
   * Decide whether this quit installs. Order matters: the reason reported is the first that applies.
   * @param context - Facts known when the quit confirmation has passed.
   * @returns `install`, or the reason the quit stays ordinary.
   */
  decide(context: UpdateOnQuitContext): UpdateOnQuitDecision {
    if (context.platform !== 'win32') return 'unsupported'
    if (!context.ready) return 'no-update'
    if (context.sessionEnding) return 'session-ending'
    if (context.recovery) return 'recovery'
    if (context.mandatory) return 'mandatory'
    return 'install'
  }

  /**
   * Record an attempt before the installer starts, so the next launch can report whether it was interrupted.
   * @param target - Version being installed.
   */
  async begin(target: string): Promise<void> {
    await this.write({ from: this.currentVersion, target })
  }

  /** Forget the attempt record. */
  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }

  private async read(): Promise<UpdateOnQuitRecord | undefined> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return undefined
    }
    try {
      const value = JSON.parse(text) as Partial<UpdateOnQuitRecord>
      if (typeof value.from !== 'string' || typeof value.target !== 'string') return undefined
      return { from: value.from, target: value.target }
    } catch {
      return undefined
    }
  }

  private async write(record: UpdateOnQuitRecord): Promise<void> {
    await writeFileAtomic(this.path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  }
}

// NSIS formats CoCreateGuid output with braces: `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`.
const STAGED_SUFFIX = /^\.(?:new|old)-\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/u

/**
 * Report a running installer that owns the installation directory. The installer writes its PID to
 * `<dir>.installing` before staging and removes the file when it finishes or rolls back.
 * @param installDirectory - Directory holding the running executable.
 * @param isRunning - Whether a process with the PID exists; injectable for tests.
 * @returns The installer PID, or undefined when no marker names a live process.
 */
export async function runningInstaller(installDirectory: string,
  isRunning: (pid: number) => boolean = processExists): Promise<number | undefined> {
  let text: string
  try {
    text = await readFile(`${installDirectory}.installing`, 'utf8')
  } catch {
    return undefined
  }
  const pid = Number(text.trim())
  // A marker whose installer is gone belongs to an interrupted run; its staged siblings may then be swept.
  return Number.isSafeInteger(pid) && pid > 0 && isRunning(pid) ? pid : undefined
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists under another account.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Remove what an interrupted installer left beside the installation: `<dir>.new-{GUID}`, `<dir>.old-{GUID}`, and a
 * stale `<dir>.installing` marker. Only exact sibling names are touched, through the unpatched fs so `app.asar` files are
 * not held open. The caller must first confirm through {@link runningInstaller} that no installer is running.
 * @param installDirectory - Directory holding the running executable.
 * @returns Names of the removed siblings.
 */
export async function removeStagedInstallDirectories(installDirectory: string): Promise<string[]> {
  const parent = dirname(installDirectory)
  const name = basename(installDirectory)
  let entries
  try {
    entries = await rawFs.promises.readdir(parent, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.name.startsWith(name)) continue
    const suffix = entry.name.slice(name.length)
    const staged = entry.isDirectory() && STAGED_SUFFIX.test(suffix)
    if (!staged && !(entry.isFile() && suffix === '.installing')) continue
    try {
      await rawFs.promises.rm(join(parent, entry.name), { recursive: true, force: true, maxRetries: 2 })
      removed.push(entry.name)
    } catch (error) {
      console.warn('desktop update: cannot remove staged installer directory', entry.name, error)
    }
  }
  return removed
}
