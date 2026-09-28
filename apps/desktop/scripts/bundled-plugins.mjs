/**
 * Third-party plugin payloads a Desktop build carries into every freshly created profile.
 *
 * A payload directory is copied beside the packaged application and seeded into a new
 * profile's `node_modules`, so a fresh installation starts with the bundle selected in
 * `dsh.profile.bundles` and needs no package installation of its own.
 *
 * The names live in their own dependency-free module so the packaging scripts and the
 * application source share one list without either loading the other.
 */

import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resources subdirectory holding one directory per bundled plugin. */
export const BUNDLED_PLUGIN_DIRECTORY = 'plugins'

/**
 * Bundled plugins, each the package name of a directory carrying a `package.json`,
 * a `cordis.patch.yml`, and whatever built files that package loads.
 */
export const BUNDLED_PLUGINS = ['dsh-bundle-exa-search']

/**
 * Locate the checkout a bundled plugin is copied from at packaging time.
 * @param {string} name - bundled plugin package name, the directory name inside the root.
 * @param {NodeJS.ProcessEnv} [env] - packaging environment; `DSH_DESKTOP_BUNDLED_PLUGINS_DIR` overrides the root.
 * @param {string} [appRoot] - Desktop application directory, whose grandparent holds the sibling checkouts.
 * @returns {string} Absolute source directory, whether or not it exists.
 */
export function bundledPluginSource(name, env = process.env, appRoot = fileURLToPath(new URL('..', import.meta.url))) {
  const configured = env.DSH_DESKTOP_BUNDLED_PLUGINS_DIR
  const root = configured === undefined || configured === '' ? resolve(appRoot, '..', '..', '..') : configured
  return join(root, name)
}
