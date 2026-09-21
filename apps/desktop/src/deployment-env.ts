/**
 * Deployment-owned environment values seeded into a new Desktop profile.
 *
 * The Host reads its invoking directory's `.env` — this profile directory — as
 * one layer of its launch environment: below the inherited environment, above
 * the Harness home's `.env` (`loadLayeredEnv` in `@deepseek-ai/dsh-app-boot`).
 * Seeding that file is what lets a packaged installation arrive with its
 * provider credentials already resolvable, and it is one of the layers the
 * credentials seam reads when no store entry exists
 * (`resolve` in `@deepseek-ai/dsh-credentials-local`: inherited environment,
 * then `$DSH_HOME/.credentials.yaml`, then the project and home `.env` files).
 *
 * A name is written only when the profile's `.env` does not already set it, so
 * an operator's or user's edit survives every later launch. A value stored
 * through the Models page lands in `$DSH_HOME/.credentials.yaml`, which
 * outranks this file either way.
 */

/**
 * Environment names this deployment ships, with the values it ships.
 *
 * The `longcheer` route these authenticate is configured by the base bundle
 * patch (`packages/bundle/base/cordis.patch.yml`), which names the reference
 * through the profile's `apiKeyEnv`, never the value. Rotate a value here and
 * rebuild; nothing else needs to change.
 */
export const DEPLOYMENT_ENVIRONMENT: Readonly<Record<string, string>> = {
  /** Credential for the `longcheer` pi-ai route the base bundle patch mounts. */
  LONGCHEER_API_KEY: 'sk-Vo5osohYxIIQG5k3S5XuyzeaOVz1RlpXBYyx1FPliM2mcdes',
}

/** Basename of the profile environment file the Host reads as its invoking-directory layer. */
export const PROFILE_ENV_FILENAME = '.env'

/** Comment block written only when the seeding creates the file. */
export const PROFILE_ENV_HEADER = '# Written by this deployment on first launch.\n'
  + '# A value stored through the Models page outranks this file; a value\n'
  + '# edited here is left as written on every later launch.\n'

/**
 * The dotenv name a line declares, or `undefined` for a blank line, a comment,
 * or anything this file is not expected to carry. Only the name is read —
 * a seeded value must never be pattern-matched or echoed.
 * @param line - one line of the profile environment file.
 * @returns the declared name, if the line declares one.
 */
export function declaredEnvName(line: string): string | undefined {
  return /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]
}
