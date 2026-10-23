/**
 * The installed-skill card's switch as CSS text. CSS Modules resolve to
 * class-name maps in component suites, so only the stylesheet shows whether
 * a card class would resize or repaint the Switch track.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/MarketPage.module.css', import.meta.url)), 'utf8')

it('only lifts the card switch above the card overlay and leaves its track to Switch', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selector]) => /\.cardSwitch\b/.test(selector ?? ''))
  expect(rules.length).toBeGreaterThan(0)
  for (const [, , body] of rules) {
    const properties = (body ?? '').split(';').map(line => line.split(':')[0]?.trim()).filter(Boolean)
    expect(properties.sort()).toEqual(['position', 'z-index'])
  }
})
