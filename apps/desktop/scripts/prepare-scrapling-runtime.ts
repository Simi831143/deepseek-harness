/** Assemble the Windows Scrapling MCP without requiring Python or pip on the build host. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { downloadPrimaryRuntimeAsset } from '../../../scripts/primary-runtime/prepare.ts'
import pythonLock from '../../../scripts/primary-runtime/lock.json' with { type: 'json' }
import lock from './scrapling-lock.json' with { type: 'json' }
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

// Windows endpoint scanners can hold a handle while they inspect a newly extracted tree.
// Keep the complete staged directory intact for the same 60-second window as the installer.
const DIRECTORY_REPLACE_ATTEMPTS = 240
const DIRECTORY_REPLACE_DELAY_MS = 250

async function replacePreparedDirectory(source: string, destination: string): Promise<void> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < DIRECTORY_REPLACE_ATTEMPTS; attempt++) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      lastError = error instanceof Error ? error : new Error(String(error), { cause: error })
      await new Promise<void>(resolve => setTimeout(resolve, DIRECTORY_REPLACE_DELAY_MS))
    }
  }
  throw lastError ?? new Error(`Scrapling runtime: unable to replace ${destination}`)
}

/**
 * Download checksum-locked Python, MCP libraries and Chromium to external application resources.
 * Target code is executed by the packaged-runtime smoke after signing on signed Windows builds.
 * @returns Resolves after replacing the Windows payload; other Desktop targets have no Scrapling payload.
 */
export async function prepareScraplingRuntime(): Promise<void> {
  if (resolveDesktopBuildTarget() !== 'win-x64') return
  const paths = resolveDesktopTargetBuildPaths()
  mkdirSync(paths.runtime, { recursive: true })
  const staging = mkdtempSync(join(paths.runtime, '.scrapling-'))
  try {
    const pythonTarget = pythonLock.targets['win-x64']
    const filename = `cpython-${pythonLock.pythonVersion}+${pythonLock.pythonRelease}-${pythonTarget.pythonTarget}-install_only_stripped.tar.gz`
    const python = await downloadPrimaryRuntimeAsset(
      `https://github.com/astral-sh/python-build-standalone/releases/download/${pythonLock.pythonRelease}/${encodeURIComponent(filename)}`,
      pythonTarget.pythonSha256, paths.downloads,
    )
    await extractTar({ file: python, cwd: staging, strip: 1 })
    const packages = join(staging, 'packages')
    mkdirSync(packages)
    // Preserve distribution metadata, namespace data and the complete Playwright/Patchright drivers.
    for (const wheel of lock.wheels) {
      const archive = await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads)
      // The application does not compile extensions, so wheel headers and build metadata can remain inert.
      await extractZip(archive, { dir: packages })
    }
    const browser = await downloadPrimaryRuntimeAsset(lock.browser.url, lock.browser.sha256, paths.downloads)
    await extractZip(browser, { dir: join(staging, 'browser') })
    cpSync(join(import.meta.dirname, 'scrapling-mcp-server.py'), join(staging, 'mcp-server.py'))
    mkdirSync(join(staging, 'licenses'))
    cpSync(join(import.meta.dirname, 'scrapling-license.txt'), join(staging, 'licenses', 'Scrapling-LICENSE.txt'))
    writeFileSync(join(staging, 'runtime.json'), `${JSON.stringify({
      python: pythonLock.pythonVersion, ...lock,
    }, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'scrapling')
    rmSync(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await replacePreparedDirectory(staging, destination)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) await prepareScraplingRuntime()
