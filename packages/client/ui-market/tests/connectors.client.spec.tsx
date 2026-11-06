// @vitest-environment jsdom
/**
 * The connector section: connecting installs first and shows how far the install has come,
 * asks once whether the program may run and shows that program, an accepted connector
 * switches from its card, and a failed start offers a retry with its reason.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MarketInstallProgress, MarketItemView } from '@deepseek-ai/dsh-market/types'
import type { ConnectorView, ConnectorsValue } from '@deepseek-ai/dsh-market-connectors/types'
import { ConnectorCatalog, ConnectorDetail, type ConnectorDetailProps } from '../src/client/Connectors.tsx'
import { zh } from '../src/client/locales.ts'
import type { MarketState } from '../src/client/market-store.ts'
import type { MarketPageProps } from '../src/client/MarketPage.tsx'

const lab: MarketItemView = {
  kind: 'connector', id: 'camera-lab', version: '1.0.0', name: { zh: '相机实验室' }, description: { zh: '读取相机调试数据' },
}

const launch = { command: 'bin/camera-lab.exe', args: ['--stdio'] }

function stateOf(views: readonly ConnectorView[] | undefined, items: readonly MarketItemView[] = [lab]): MarketState {
  return {
    market: { revision: 1, source: 'remote', categories: [], featured: [], items: [...items], kinds: ['skill', 'connector'], installing: [], progress: [] },
    streamFailed: false, installedSkills: undefined, installedLoading: false, switching: [], canReveal: false,
    connectors: views === undefined ? undefined : { revision: 1, connectors: [...views] }, connectorBusy: [], notice: null,
  }
}

const t: MarketPageProps['t'] = (key, params) => {
  const template: string = key in zh ? zh[key as keyof typeof zh] : key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
}

function actions(state: MarketState, refreshed?: ConnectorsValue) {
  return {
    t, text: (value: { zh: string }) => value.zh,
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    install: vi.fn(() => Promise.resolve(true)),
    uninstall: vi.fn(() => Promise.resolve()),
    setConnectorEnabled: vi.fn(() => Promise.resolve(true)),
    retryConnector: vi.fn(() => Promise.resolve()),
    refreshConnectors: vi.fn(() => Promise.resolve(refreshed)),
  }
}

function showDetail(state: MarketState, patch: Partial<ConnectorDetailProps> = {}, refreshed?: ConnectorsValue) {
  const props = { ...actions(state, refreshed), id: 'camera-lab', connectOnOpen: false, onClose: vi.fn(), ...patch }
  // The dialog reads only these members of the page props.
  const page: Partial<ConnectorDetailProps> = props
  render(<ConnectorDetail {...(page as ConnectorDetailProps)} />)
  return props
}

afterEach(() => { cleanup() })

it('installs a connector, shows the program it runs, and connects only after the user accepts it', async () => {
  const props = showDetail(stateOf([]), {}, { revision: 1, connectors: [{ id: 'camera-lab', origin: 'market', enabled: false, confirmed: false, state: 'off', launch }] })
  fireEvent.click(screen.getByRole('button', { name: zh.connect }))
  await vi.waitFor(() => { expect(screen.getByRole('alertdialog', { name: '要在这台电脑上运行相机实验室吗？' })).toBeTruthy() })
  expect(props.install).toHaveBeenCalledWith({ kind: 'connector', id: 'camera-lab' }, '相机实验室')
  expect(screen.getByText('bin/camera-lab.exe --stdio')).toBeTruthy()
  expect(props.setConnectorEnabled).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: zh.confirmConnectAccept }))
  await vi.waitFor(() => { expect(props.setConnectorEnabled).toHaveBeenCalledWith('camera-lab', true, true, '相机实验室') })
})

it('connects an accepted connector without asking again', async () => {
  const props = showDetail(stateOf([{ id: 'camera-lab', origin: 'market', enabled: false, confirmed: true, state: 'off', launch }]))
  fireEvent.click(screen.getByRole('switch', { name: '连接相机实验室' }))
  await vi.waitFor(() => { expect(props.setConnectorEnabled).toHaveBeenCalledWith('camera-lab', true, false, '相机实验室') })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.queryByText('bin/camera-lab.exe --stdio')).toBeNull()
})

it('shows the running install step and its percent in the dialog and on the card', () => {
  const installing = (progress: MarketInstallProgress): MarketState => {
    const base = stateOf([])
    if (base.market === undefined) throw new Error('stateOf always builds a market snapshot')
    return { ...base, market: { ...base.market, installing: [progress.key], progress: [progress] } }
  }
  showDetail(installing({ key: 'connector:camera-lab', phase: 'download', done: 52_428_800, total: 125_829_120 }))
  expect(screen.getByRole('progressbar', { name: '正在下载 50.0 / 120.0 MB' }).getAttribute('aria-valuenow')).toBe('41')
  cleanup()

  const unpacking = installing({ key: 'connector:camera-lab', phase: 'unpack', done: 12_000, total: 24_000 })
  const props = actions(unpacking)
  const page: Partial<MarketPageProps> = props
  render(<ConnectorCatalog {...(page as MarketPageProps)} market={unpacking.market} text={props.text} />)
  expect(screen.getByRole('progressbar', { name: '正在解压 12000 / 24000 个文件' }).getAttribute('aria-valuenow')).toBe('50')
})

it('shows why a start failed and retries it', () => {
  const props = showDetail(stateOf([{ id: 'camera-lab', origin: 'market', enabled: true, confirmed: true, state: 'failed', error: 'mcp-client(camera-lab): spawn EACCES', launch }]))
  expect(screen.getByRole('alert').textContent).toContain('spawn EACCES')
  expect(screen.getAllByText(zh.connectorFailed).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(props.retryConnector).toHaveBeenCalledWith('camera-lab', '相机实验室')
})

it('confirms before uninstalling', async () => {
  const props = showDetail(stateOf([{ id: 'camera-lab', origin: 'market', enabled: true, confirmed: true, state: 'connected', launch }]))
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.uninstall }))
  expect(screen.getByText(zh.confirmUninstallConnector)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.uninstall }))
  await vi.waitFor(() => { expect(props.uninstall).toHaveBeenCalledWith({ kind: 'connector', id: 'camera-lab' }, '相机实验室') })
})

it('lists catalog connectors with their state and switches an accepted one from its card', () => {
  const state = stateOf([{ id: 'camera-lab', origin: 'market', enabled: true, confirmed: true, state: 'connected', launch }], [
    lab, { ...lab, id: 'log-reader', name: { zh: '日志读取' } },
  ])
  const props = actions(state)
  const page: Partial<MarketPageProps> = props
  render(<ConnectorCatalog {...(page as MarketPageProps)} market={state.market} text={props.text} />)
  expect(screen.getByText(zh.connectorConnected)).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.connect })).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: '连接相机实验室' }))
  expect(props.setConnectorEnabled).toHaveBeenCalledWith('camera-lab', false, false, '相机实验室')

  fireEvent.change(screen.getByRole('searchbox', { name: zh.searchConnectors }), { target: { value: '日志' } })
  expect(screen.queryByText('相机实验室')).toBeNull()
  expect(screen.getByText('日志读取')).toBeTruthy()
})

const keySetting = {
  env: 'LAB_API_KEY', label: { zh: 'API key' }, secret: true, required: true, url: 'https://lab.example/keys',
} as const

it('saves a typed setting, never shows a saved one, clears it, and explains a missing required value', async () => {
  const saved = { revision: 2, connectors: [] }
  const save = vi.fn(() => Promise.resolve({ ok: true as const, value: saved }))
  showDetail(stateOf([{
    id: 'camera-lab', origin: 'market', enabled: true, confirmed: true, state: 'off', launch,
    error: 'needs a value for LAB_API_KEY', hint: 'setting-required', settings: [{ ...keySetting, configured: false }],
  }]), { saveConnectorSettings: save })
  expect(screen.getByRole('alert').textContent).toContain(zh.hintSettingRequired)
  const field = screen.getByLabelText('API key')
  expect(field.getAttribute('type')).toBe('password')
  expect(screen.getByRole('link', { name: zh.settingGetValue }).getAttribute('href')).toBe('https://lab.example/keys')
  const submit = screen.getByRole('button', { name: zh.settingsSave })
  expect((submit as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(field, { target: { value: 'ctx7sk-new' } })
  fireEvent.click(submit)
  await vi.waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh.settingsSaved) })
  expect(save).toHaveBeenCalledWith('camera-lab', { LAB_API_KEY: 'ctx7sk-new' })
  expect((field as HTMLInputElement).value).toBe('')
  cleanup()

  showDetail(stateOf([{
    id: 'camera-lab', origin: 'market', enabled: true, confirmed: true, state: 'connected', launch, settings: [{ ...keySetting, configured: true }],
  }]), { saveConnectorSettings: save })
  expect(screen.getByLabelText('API key').getAttribute('placeholder')).toBe(zh.settingSavedPlaceholder)
  fireEvent.click(screen.getByRole('button', { name: zh.settingClear }))
  await vi.waitFor(() => { expect(save).toHaveBeenLastCalledWith('camera-lab', { LAB_API_KEY: null }) })
})

it('shows why saving a setting was refused', async () => {
  const save = vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'market-connectors/settings-unavailable', message: 'disk full' } }))
  showDetail(stateOf([{
    id: 'camera-lab', origin: 'market', enabled: false, confirmed: true, state: 'off', launch, settings: [{ ...keySetting, configured: false }],
  }]), { saveConnectorSettings: save })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } })
  fireEvent.click(screen.getByRole('button', { name: zh.settingsSave }))
  await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('disk full') })
})

it('shows a plain setting with its description, and a refusal without a message', async () => {
  const save = vi.fn(() => Promise.resolve({ ok: false as const, error: 'offline' }))
  showDetail(stateOf([{
    id: 'camera-lab', origin: 'market', enabled: false, confirmed: true, state: 'off', launch,
    settings: [{ env: 'LAB_REGION', label: { zh: '区域' }, description: { zh: '数据中心所在区域' }, secret: false, required: false, configured: false }],
  }]), { saveConnectorSettings: save })
  const field = screen.getByLabelText('区域')
  expect(field.getAttribute('type')).toBe('text')
  expect(screen.getByText('数据中心所在区域')).toBeTruthy()
  expect(screen.queryByRole('link', { name: zh.settingGetValue })).toBeNull()
  fireEvent.change(field, { target: { value: 'cn' } })
  fireEvent.click(screen.getByRole('button', { name: zh.settingsSave }))
  await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('offline') })
})
