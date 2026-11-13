// @vitest-environment jsdom
/** Skill catalog shortcuts initialize localized requests for finding or creating skills. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import type { MarketState } from '../src/client/market-store.ts'
import { MarketPage, type MarketPageProps } from '../src/client/MarketPage.tsx'
import type { MarketView } from '../src/client/navigation-store.ts'

const state: MarketState = {
  market: { revision: 1, source: 'remote', categories: [], featured: [], items: [], kinds: ['skill'], installing: [], progress: [] },
  streamFailed: false,
  installedSkills: { complete: true, skills: [] },
  installedLoading: false, switching: [], canReveal: false, connectors: undefined, connectorBusy: [], notice: null,
}

function translate(copy: Readonly<Record<keyof typeof en, string>>): MarketPageProps['t'] {
  return (key, params) => {
    const template: string = key in copy ? copy[key as keyof typeof copy] : key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
  }
}

afterEach(() => { cleanup() })

it('starts 创建技能 with the skill-creator chip and the request template after it', () => {
  const view: MarketView = { kind: 'catalog', tab: 'skill' }
  const props = {
    t: translate(zh),
    useStore: <T,>(select: (value: { view: MarketView }) => T): T => select({ view }),
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    useLanguage: <T,>(select: (value: string) => T): T => select('zh'),
    actions: { setView: vi.fn() },
    refresh: vi.fn(() => Promise.resolve()),
    loadInstalledSkills: vi.fn(() => Promise.resolve()),
    trySkill: vi.fn(),
  }
  // The page reads only these members of its props before the menu pick.
  render(<MarketPage {...Object.assign({} as MarketPageProps, props)} />)
  fireEvent.click(screen.getByRole('button', { name: zh.addSkill }))
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(zh.addCreate) }))
  expect(props.trySkill).toHaveBeenCalledWith('skill-creator', '请帮我创建一个可以实现「」的技能')
  // The chip carries the skill; the template itself must not repeat it as text.
  expect(zh.promptCreate).not.toContain('/skill-creator')
})

it.each([
  { language: 'zh', copy: zh },
  { language: 'en', copy: en },
])('opens Find skills with the localized request and closes the menu in $language', ({ language, copy }) => {
  const view: MarketView = { kind: 'catalog', tab: 'skill' }
  const props = {
    t: translate(copy),
    useStore: <T,>(select: (value: { view: MarketView }) => T): T => select({ view }),
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    useLanguage: <T,>(select: (value: string) => T): T => select(language),
    actions: { setView: vi.fn() },
    refresh: vi.fn(() => Promise.resolve()),
    loadInstalledSkills: vi.fn(() => Promise.resolve()),
    findSkills: vi.fn(),
    trySkill: vi.fn(),
  }
  render(<MarketPage {...Object.assign({} as MarketPageProps, props)} />)
  fireEvent.click(screen.getByRole('button', { name: copy.addSkill }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    copy.addFind + copy.addFindDescription,
    copy.addUpload + copy.addUploadDescription,
    copy.addCreate + copy.addCreateDescription,
  ])
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(copy.addFind) }))
  expect(props.findSkills).toHaveBeenCalledExactlyOnceWith(copy.promptFind)
  expect(props.trySkill).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('button', { name: copy.addSkill }).getAttribute('aria-expanded')).toBe('false')
})
