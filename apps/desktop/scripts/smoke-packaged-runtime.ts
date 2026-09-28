/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { packagedApplicationEntry, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

/**
 * Locate the assembled application inside an artifact directory.
 *
 * electron-builder names the application bundle after the configured product name, so the
 * entry is resolved from the artifacts rather than assumed to be a fixed brand string.
 * @param {string} target - Resolved Desktop build target.
 * @param {string} artifacts - Artifact directory of the release flavor being validated.
 * @returns {{ application: string, resources: string, executable: string }} Bundle, resource, and executable paths.
 */
function packagedApplication(target: string, artifacts: string) {
  if (target === 'win-x64') {
    const application = join(artifacts, 'win-unpacked')
    return {
      application,
      resources: join(application, 'resources'),
      executable: join(application, packagedApplicationEntry(application, '.exe')),
    }
  }
  const root = join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac')
  const bundleName = packagedApplicationEntry(root, '.app')
  const application = join(root, bundleName, 'Contents')
  return {
    application,
    resources: join(application, 'Resources'),
    executable: join(application, 'MacOS', bundleName.slice(0, -'.app'.length)),
  }
}

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
if (values.unsigned && !windows) throw new Error('desktop smoke: unsigned artifacts require Windows')
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const { application, resources, executable } = packagedApplication(target, artifacts)
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
