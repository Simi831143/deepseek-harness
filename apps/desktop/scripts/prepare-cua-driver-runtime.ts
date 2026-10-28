/** Assemble the Windows Cua Driver MCP from its checksum-locked upstream release archive. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import extractZip from 'extract-zip'
import { downloadPrimaryRuntimeAsset } from '../../../scripts/primary-runtime/prepare.ts'
import lock from './cua-driver-lock.json' with { type: 'json' }
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { replacePreparedDirectory } from './prepared-directory.ts'

/**
 * Download the locked release, keep its upstream-signed driver executable and licenses,
 * and replace `runtime/cua-driver` with the complete staged copy.
 * The SDK libraries and the UIAccess worker stay out: `cua-driver mcp` owns its runtime in-process,
 * and a per-user installation cannot grant the worker UIAccess integrity.
 * @returns Resolves after replacing the Windows payload; other Desktop targets have no Cua Driver payload.
 */
export async function prepareCuaDriverRuntime(): Promise<void> {
  if (resolveDesktopBuildTarget() !== 'win-x64') return
  const paths = resolveDesktopTargetBuildPaths()
  mkdirSync(paths.runtime, { recursive: true })
  const staging = mkdtempSync(join(paths.runtime, '.cua-driver-'))
  try {
    const archive = await downloadPrimaryRuntimeAsset(lock.archive.url, lock.archive.sha256, paths.downloads)
    const extracted = join(staging, '.archive')
    await extractZip(archive, { dir: extracted })
    const release = join(extracted, lock.archive.directory)
    cpSync(join(release, 'cua-driver.exe'), join(staging, 'cua-driver.exe'))
    mkdirSync(join(staging, 'licenses'))
    cpSync(join(release, 'LICENSE'), join(staging, 'licenses', 'Cua-Driver-LICENSE.txt'))
    cpSync(join(release, 'THIRD_PARTY_NOTICES.md'), join(staging, 'licenses', 'Cua-Driver-THIRD_PARTY_NOTICES.md'))
    rmSync(extracted, { recursive: true, force: true })
    writeFileSync(join(staging, 'runtime.json'), `${JSON.stringify(lock, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'cua-driver')
    rmSync(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await replacePreparedDirectory(staging, destination, 'Cua Driver runtime')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) await prepareCuaDriverRuntime()
