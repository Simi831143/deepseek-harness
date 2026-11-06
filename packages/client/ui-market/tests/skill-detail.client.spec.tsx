// @vitest-environment jsdom
/**
 * The skill detail dialog joins the catalog entry with the installed state:
 * display fields, install, the success-toned switch, one more-actions menu
 * (edit, open folder, uninstall) for market and personal skills alike, the
 * overview of the skill's instructions with its search, an example
 * turning into a conversation that opens with the skill, and the progress of
 * a running install.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MarketItemView } from '@deepseek-ai/dsh-market/types'
import type { InstalledSkillView, SkillDocumentValue } from '@deepseek-ai/dsh-market-skills/types'
import { zh } from '../src/client/locales.ts'
import type { MarketResult, MarketState } from '../src/client/market-store.ts'
import { SkillDetail, type SkillDetailProps } from '../src/client/SkillDetail.tsx'

const lark: MarketItemView = {
  kind: 'skill', id: 'lark-unified', version: '2.3.0',
  name: { zh: '飞书套件', en: 'Feishu Suite' },
  description: { zh: '飞书/Lark 全能套件' },
  examples: [{ zh: '用飞书给团队群发一条消息' }, { zh: '在飞书云文档新建一篇文档' }],
}

const larkInstalled: InstalledSkillView = {
  name: 'lark-unified', description: 'Lark', origin: 'market', enabled: true, path: 'C:\\dsh\\market\\skill\\lark-unified\\SKILL.md',
}

const cameraLog: InstalledSkillView = {
  name: 'camera-log', description: '相机日志汇总', origin: 'user', enabled: true, path: 'C:\\Users\\me\\.agents\\skills\\camera-log\\SKILL.md',
}

function stateOf(items: readonly MarketItemView[], installed: readonly InstalledSkillView[] | undefined, canReveal = true): MarketState {
  return {
    market: { revision: 1, source: 'remote', categories: [], featured: [], items: [...items], kinds: ['skill'], installing: [], progress: [] },
    streamFailed: false,
    installedSkills: installed === undefined ? undefined : { complete: true, skills: [...installed] },
    installedLoading: false, switching: [], canReveal, connectors: undefined, connectorBusy: [], notice: null,
  }
}

// Market keys resolve against the Chinese dictionary; a shared common key passes through.
const t: SkillDetailProps['t'] = (key, params) => {
  const template: string = key in zh ? zh[key as keyof typeof zh] : key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
}

const DOCUMENT = '# 使用说明\n\n先读取飞书文档，再写回飞书。\n\n```sh\nlark docs read\n```'

function show(skill: string, state: MarketState, patch: {
  install?: (ref: unknown, name: string) => Promise<boolean>
  document?: () => Promise<MarketResult<SkillDocumentValue>>
  uninstallPersonal?: () => Promise<boolean>
} = {}) {
  const props = {
    t, skill, text: (value: { zh: string }) => value.zh, onClose: vi.fn(),
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    install: vi.fn(patch.install ?? (() => Promise.resolve(true))),
    uninstall: vi.fn(() => Promise.resolve()),
    uninstallPersonal: vi.fn(patch.uninstallPersonal ?? (() => Promise.resolve(true))),
    revealSkill: vi.fn(() => Promise.resolve()),
    loadInstalledSkills: vi.fn(() => Promise.resolve()),
    setSkillsEnabled: vi.fn(() => Promise.resolve(true)),
    readSkillDocument: vi.fn(patch.document ?? (() => Promise.resolve({ ok: true as const, value: { name: skill, content: DOCUMENT } }))),
    trySkill: vi.fn(),
    editSkill: vi.fn(),
  }
  // The dialog reads only these members of the page props.
  const page: Partial<SkillDetailProps> = props
  render(<SkillDetail {...(page as SkillDetailProps)} />)
  return props
}

// jsdom has no scrollIntoView; the overview scrolls the current match into view.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup() })

it('shows how far a running install has come', () => {
  const state = stateOf([lark], [])
  if (state.market === undefined) throw new Error('stateOf always builds a market snapshot')
  const progress = { key: 'skill:lark-unified', phase: 'unpack', done: 3, total: 4 } as const
  show('lark-unified', { ...state, market: { ...state.market, installing: [progress.key], progress: [progress] } })
  expect(screen.getByRole('button', { name: zh.installing })).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: '正在解压 3 / 4 个文件' }).getAttribute('aria-valuenow')).toBe('75')
})

it('shows the display name, description, examples and version of a catalog skill not yet installed', () => {
  const props = show('lark-unified', stateOf([lark], []))
  expect(screen.getByRole('heading', { name: '飞书套件' })).toBeTruthy()
  expect(screen.getByText('/lark-unified')).toBeTruthy()
  expect(screen.getByText('飞书/Lark 全能套件')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.install })).toBeTruthy()
  expect(screen.getByText(zh.tryAsking)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /飞书/ })).toHaveLength(2)
  expect(screen.getByText('v2.3.0')).toBeTruthy()
  // Not installed: no switch, no uninstall, and the overview asks for an install first.
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: zh.more })).toBeNull()
  expect(screen.getByText(zh.notInstalledOverview)).toBeTruthy()
  expect(props.readSkillDocument).not.toHaveBeenCalled()
  expect(props.loadInstalledSkills).toHaveBeenCalled()
})

it('installs before opening a conversation that starts with the skill for an example', async () => {
  const props = show('lark-unified', stateOf([lark], []))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '用飞书给团队群发一条消息' })) })
  expect(props.install).toHaveBeenCalledWith({ kind: 'skill', id: 'lark-unified' }, '飞书套件')
  expect(props.onClose).toHaveBeenCalledOnce()
  expect(props.trySkill).toHaveBeenCalledWith('lark-unified', '用飞书给团队群发一条消息')
})

it('stays open without a conversation when the install fails', async () => {
  const props = show('lark-unified', stateOf([lark], []), { install: () => Promise.resolve(false) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '在飞书云文档新建一篇文档' })) })
  expect(props.trySkill).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
})

it('skips the install for an installed skill, switches it, and renders its instructions', async () => {
  const props = show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]))
  // Try it stands for the installed state; the dialog shows no separate installed mark.
  expect(screen.getByRole('button', { name: zh.tryIt })).toBeTruthy()
  expect(screen.queryByText(zh.installedBadge)).toBeNull()
  expect(screen.queryByRole('button', { name: zh.install })).toBeNull()
  const toggle = screen.getByRole('switch', { name: '启用飞书套件' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(toggle)
  expect(props.setSkillsEnabled).toHaveBeenCalledWith(['lark-unified'], false)
  expect(await screen.findByRole('heading', { name: '使用说明' })).toBeTruthy()
  expect(props.readSkillDocument).toHaveBeenCalledWith('lark-unified')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '在飞书云文档新建一篇文档' })) })
  expect(props.install).not.toHaveBeenCalled()
  expect(props.trySkill).toHaveBeenCalledWith('lark-unified', '在飞书云文档新建一篇文档')
})

it('switches a disabled skill on before trying it', async () => {
  const props = show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [{ ...larkInstalled, enabled: false }]))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.tryIt })) })
  expect(props.setSkillsEnabled).toHaveBeenCalledWith(['lark-unified'], true)
  expect(props.trySkill).toHaveBeenCalledWith('lark-unified', '')
})

it('marks and steps through overview matches outside code blocks', async () => {
  show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]))
  await screen.findByRole('heading', { name: '使用说明' })
  fireEvent.click(screen.getByRole('button', { name: zh.overviewSearch }))
  const box = screen.getByRole('searchbox', { name: zh.overviewSearch })
  fireEvent.change(box, { target: { value: '飞书' } })
  const marks = () => [...document.querySelectorAll('mark[data-overview-hit]')]
  // Two hits in the paragraph; `lark docs read` sits in a code block and is never marked.
  expect(marks()).toHaveLength(2)
  expect(screen.getByText('1/2')).toBeTruthy()
  expect(marks()[0]?.hasAttribute('data-current')).toBe(true)
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(screen.getByText('2/2')).toBeTruthy()
  expect(marks()[1]?.hasAttribute('data-current')).toBe(true)
  fireEvent.change(box, { target: { value: 'lark' } })
  expect(marks()).toHaveLength(0)
  expect(screen.getByText('0/0')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.overviewSearchClose }))
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.getByText('先读取飞书文档，再写回飞书。')).toBeTruthy()
})

it('reports an overview that could not be read', async () => {
  show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]), {
    document: () => Promise.resolve({ ok: false as const, error: { message: 'skill disappeared' } }),
  })
  expect((await screen.findByRole('alert')).textContent).toBe('无法读取技能说明：skill disappeared')
})

it('uninstalls a market skill by deleting it after a confirmation', async () => {
  const props = show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.uninstall }))
  const confirm = screen.getByRole('alertdialog', { name: '确定卸载飞书套件吗？' })
  expect(confirm.textContent).toContain(zh.confirmUninstallMarket)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.uninstall })) })
  expect(props.uninstall).toHaveBeenCalledWith({ kind: 'skill', id: 'lark-unified' }, '飞书套件')
  expect(props.uninstallPersonal).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('offers the same more-actions menu for market and personal skills', () => {
  show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  const market = screen.getAllByRole('menuitem').map(item => item.textContent)
  cleanup()
  show('camera-log', stateOf([], [cameraLog]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(market)
  expect(market).toEqual([zh.edit, zh.openFolder, zh.uninstall])
})

it('deletes a personal skill from its folder after a confirmation and closes the dialog', async () => {
  const props = show('camera-log', stateOf([], [cameraLog]))
  expect(screen.getByRole('heading', { name: 'camera-log' })).toBeTruthy()
  expect(screen.getByText(zh.originUser)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.uninstall }))
  expect(screen.getByRole('alertdialog').textContent).toContain(zh.confirmUninstallUser)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.uninstall })) })
  expect(props.uninstallPersonal).toHaveBeenCalledWith('camera-log', 'camera-log')
  expect(props.uninstall).not.toHaveBeenCalled()
  expect(props.onClose).toHaveBeenCalledOnce()
})

it('stays open when a personal skill could not be deleted', async () => {
  const props = show('camera-log', stateOf([], [cameraLog]), { uninstallPersonal: () => Promise.resolve(false) })
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.uninstall }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.uninstall })) })
  expect(props.onClose).not.toHaveBeenCalled()
})

it('opens the folder of the skill file in the Host file manager', () => {
  const props = show('camera-log', stateOf([], [cameraLog]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.openFolder }))
  expect(props.revealSkill).toHaveBeenCalledWith(cameraLog.path, 'camera-log')
  expect(screen.queryByRole('menu')).toBeNull()
})

it('hides open folder when the Host has no file manager or the skill has no file', () => {
  show('camera-log', stateOf([], [cameraLog], false))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  expect(screen.queryByRole('menuitem', { name: zh.openFolder })).toBeNull()
  cleanup()
  const { path: _path, ...virtual } = cameraLog
  show('camera-log', stateOf([], [virtual]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.edit, zh.uninstall])
})

it('closes the dialog and hands the skill to the editor conversation', () => {
  const props = show('lark-unified', stateOf([{ ...lark, installedVersion: '2.3.0' }], [larkInstalled]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.edit }))
  expect(props.onClose).toHaveBeenCalledOnce()
  expect(props.editSkill).toHaveBeenCalledWith('lark-unified')
})

it('switches a personal skill through the shared registry setting', () => {
  const props = show('camera-log', stateOf([], [cameraLog]))
  expect(screen.getByText('相机日志汇总')).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: '启用camera-log' }))
  expect(props.setSkillsEnabled).toHaveBeenCalledWith(['camera-log'], false)
})

it('renders nothing for a skill that is neither published nor installed', () => {
  show('missing', stateOf([lark], []))
  expect(screen.queryByRole('dialog')).toBeNull()
})
