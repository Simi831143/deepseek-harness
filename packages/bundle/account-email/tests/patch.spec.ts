/** The email sign-in bundle replaces the two browser-flow account rows and inserts its own three. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

interface Manifest {
  name?: string
  icon?: string
  private?: boolean
  publishConfig?: { access?: string }
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

describe('email sign-in bundle', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Manifest

  it('publishes as a bundle with plugin-manager display metadata', () => {
    expect(manifest.name).toBe('@deepseek-ai/dsh-account-email')
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.icon).toBe('./icon.svg')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    // Each row this patch names has to resolve from the bundle, so both the
    // controller module and the browser half are declared as dependencies.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-account-email', '@deepseek-ai/dsh-email-code-account',
    ])
  })

  it('switches the browser-flow rows off and inserts the email rows', () => {
    const parsed = yaml.load(readFileSync(resolve(root, './cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    expect(parsed).toEqual([
      { id: 'deepseek-account', disabled: true },
      { id: 'ui-settings-account', disabled: true },
      { insert: [
        { id: 'email-code-account', name: '@deepseek-ai/dsh-email-code-account' },
        { id: 'email-login-controller', name: '@deepseek-ai/dsh-email-code-account/controller' },
        { id: 'ui-account-email', name: '@deepseek-ai/dsh-client-ui-account-email' },
      ] },
    ])
  })

  // `id` + `disabled` only edits a row another layer already contributed; naming
  // a row nobody contributed is silently ignored, and would leave the browser
  // round trip composed alongside the email card.
  it.each([
    ['base', '../../../packages/bundle/base/cordis.patch.yml', 'deepseek-account'],
    ['web-app', '../../../packages/bundle/web-app/cordis.patch.yml', 'ui-settings-account'],
  ])('disables a row the %s layer contributes', (_layer, patch, rowId) => {
    const parsed = yaml.load(readFileSync(resolve(root, patch), 'utf8'), { schema: entryListSchema })
    const declared = new Set<string>()
    for (const entry of parsed as readonly (Record<string, unknown>)[]) {
      if (typeof entry.id === 'string') declared.add(entry.id)
      for (const inserted of (entry.insert ?? []) as readonly { id?: string }[]) {
        if (inserted.id !== undefined) declared.add(inserted.id)
      }
    }
    expect(declared.has(rowId)).toBe(true)
  })
})
