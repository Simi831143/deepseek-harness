// @vitest-environment jsdom
/** Plugin market actions use the common lifecycle and retain per-version compatibility. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MarketItemView } from '@deepseek-ai/dsh-market/types'
import { en, zh } from '../src/client/locales.ts'
import { MarketPage, type MarketPageProps } from '../src/client/MarketPage.tsx'
import { PluginCatalog, PluginDetail } from '../src/client/Plugins.tsx'
import type { MarketState } from '../src/client/market-store.ts'
import type { MarketView } from '../src/client/navigation-store.ts'

const plugin: MarketItemView = {
  kind: 'plugin', id: 'camera-tools', version: '2.0.0', name: { zh: '相机工具', en: 'Camera tools' },
  description: { zh: '相机检查和调试', en: 'Inspect and debug cameras' }, category: 'camera',
  managed: {
    installed: false, compatible: true,
    versions: [{ version: '2.0.0', compatible: true }, { version: '1.0.0', compatible: false, reason: 'Requires DSH 0.1' }],
  },
  plugin: {
    name: 'lc-camera-tools', metadata: { keywords: [], labels: [], sortKeys: {} },
    versions: ['2.0.0', '1.0.0'].map(version => ({
      version, publishTimestamp: 0, engines: {}, source: { type: 'tarball', path: 'camera.tgz', url: 'https://market.example/camera.tgz', size: 1, sha256: 'a'.repeat(64) },
    })),
  },
}

function stateOf(items: readonly MarketItemView[] = [plugin]): MarketState {
  return {
    market: {
      revision: 1, source: 'remote', categories: [{ kind: 'plugin', id: 'camera', name: { zh: '相机' } }], featured: [],
      items, kinds: ['skill', 'connector', 'plugin'], installing: [], progress: [],
    },
    streamFailed: false, installedSkills: undefined, installedLoading: false, switching: [], canReveal: false,
    connectors: undefined, connectorBusy: [], notice: null,
  }
}

function actions(state: MarketState, copy: typeof zh | typeof en = zh) {
  const t: MarketPageProps['t'] = (key, params) => {
    const template: string = key in copy ? copy[key as keyof typeof copy] : key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
  }
  return {
    t, text: (value: { zh: string }) => value.zh,
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    install: vi.fn(() => Promise.resolve(true)), uninstall: vi.fn(() => Promise.resolve()),
  }
}

function detail(state: MarketState) {
  const props = actions(state)
  render(<PluginDetail {...Object.assign({} as MarketPageProps, props)} text={props.text} id={plugin.id} onClose={vi.fn()} />)
  return props
}

afterEach(() => { cleanup() })

it('places plugins after experts, skills, and connectors in the shared market', () => {
  const state = stateOf()
  const view: MarketView = { kind: 'catalog', tab: 'plugin' }
  const props = {
    ...actions(state), actions: { setView: vi.fn() }, refresh: vi.fn(() => Promise.resolve()), followCatalog: vi.fn(() => () => {}),
    useStore: <T,>(select: (value: { view: MarketView }) => T): T => select({ view }),
    useLanguage: <T,>(select: (language: string) => T): T => select('zh'),
  }
  render(<MarketPage {...Object.assign({} as MarketPageProps, props)} />)
  expect(screen.getAllByRole('tab').map(tab => ({ label: tab.textContent, selected: tab.getAttribute('aria-selected') }))).toMatchInlineSnapshot(`
    [
      {
        "label": "专家",
        "selected": "false",
      },
      {
        "label": "技能",
        "selected": "false",
      },
      {
        "label": "连接器",
        "selected": "false",
      },
      {
        "label": "插件",
        "selected": "true",
      },
    ]
  `)
  expect(screen.getByText('相机工具')).toBeTruthy()
  expect(screen.getByText('lc-camera-tools')).toBeTruthy()
})

it('searches plugin package names and excludes other resource kinds', () => {
  const state = stateOf([plugin, { kind: 'skill', id: 'camera', version: '1', name: { zh: '技能' }, description: { zh: '技能说明' } }])
  const props = actions(state)
  render(<PluginCatalog {...Object.assign({} as MarketPageProps, props)} market={state.market} text={props.text} />)
  expect(screen.queryByText('技能')).toBeNull()
  fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlugins }), { target: { value: 'lc-camera-tools' } })
  expect(screen.getByText('相机工具')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlugins }), { target: { value: 'missing' } })
  expect(screen.getByText(zh.emptyPluginSearch)).toBeTruthy()
})

it('confirms executable installation and sends the selected exact version to the shared market', async () => {
  const props = detail(stateOf())
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  const confirmation = screen.getByRole('alertdialog', { name: '要安装相机工具吗？' })
  expect(within(confirmation).getByText(zh.confirmInstallPluginText)).toBeTruthy()
  expect(props.install).not.toHaveBeenCalled()
  fireEvent.click(within(confirmation).getByRole('button', { name: zh.install }))
  await vi.waitFor(() => { expect(props.install).toHaveBeenCalledWith({ kind: 'plugin', id: 'camera-tools', version: '2.0.0' }, '相机工具') })
})

it('keeps an incompatible selected version visible and prevents its installation', () => {
  const props = detail(stateOf())
  fireEvent.click(screen.getByRole('button', { name: zh.pluginSelectVersion }))
  fireEvent.click(screen.getByRole('menuitem', { name: '1.0.0' }))
  expect(screen.getByText('Requires DSH 0.1')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.install }).hasAttribute('disabled')).toBe(true)
  expect(props.install).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('offers update and confirms shared-market removal of an installed plugin', async () => {
  const props = detail(stateOf([{ ...plugin, installedVersion: '1.0.0', managed: { ...plugin.managed, installed: true, compatible: true } }]))
  expect(screen.getByRole('button', { name: zh.update })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.uninstall }))
  const confirmation = screen.getByRole('alertdialog', { name: '确定卸载相机工具吗？' })
  expect(within(confirmation).getByText(zh.confirmUninstallPlugin)).toBeTruthy()
  fireEvent.click(within(confirmation).getByRole('button', { name: zh.uninstall }))
  await vi.waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith({ kind: 'plugin', id: 'camera-tools' }, '相机工具') })
})

it('does not offer uninstall or replacement of an app-provided plugin', () => {
  const props = detail(stateOf([{ ...plugin, installedVersion: '2.0.0', managed: { installed: true, provided: true, compatible: true } }]))
  expect(screen.getByRole('button', { name: zh.pluginProvided }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: zh.uninstall })).toBeNull()
  expect(props.uninstall).not.toHaveBeenCalled()
})

it('shows package application as an indeterminate shared progress step', () => {
  const base = stateOf()
  detail({ ...base, market: base.market === undefined ? undefined : {
    ...base.market, installing: ['plugin:camera-tools'], progress: [{ key: 'plugin:camera-tools', phase: 'install', done: 0, total: 1 }],
  } })
  const progress = screen.getByRole('progressbar', { name: zh.installApplying })
  expect(progress.hasAttribute('aria-valuenow')).toBe(false)
  expect(screen.getByRole('button', { name: zh.installing }).hasAttribute('disabled')).toBe(true)
})

it('keeps a refused installation visible and blocks duplicate requests while it is pending', async () => {
  let settle!: (installed: boolean) => void
  const props = actions(stateOf())
  const install = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
  const rendered = render(<PluginDetail {...Object.assign({} as MarketPageProps, props, { install })}
    text={props.text} id={plugin.id} onClose={vi.fn()} />)
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.install }))
    const confirmation = screen.getByRole('alertdialog')
    const confirm = within(confirmation).getByRole('button', { name: zh.install })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(install).toHaveBeenCalledOnce()
    expect(confirm.hasAttribute('disabled')).toBe(true)
    settle(false)
    await vi.waitFor(() => { expect(confirm.hasAttribute('disabled')).toBe(false) })
    expect(screen.getByRole('dialog', { name: '相机工具' })).toBeTruthy()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  } finally {
    settle(false)
    rendered.unmount()
  }
})

it('shows Host-owned restart guidance for an installed plugin', () => {
  detail(stateOf([{ ...plugin, installedVersion: '2.0.0', managed: { installed: true, compatible: true, restartRequired: true } }]))
  expect(screen.getByRole('status').textContent).toBe(zh.pluginRestartRequired)
})
