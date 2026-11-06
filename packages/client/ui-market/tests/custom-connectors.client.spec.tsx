// @vitest-environment jsdom
/**
 * Custom connectors in the connector section: the command line and pair helpers, the card, the
 * add dialog's paste and form pages, and the detail of a failed connector with its hint, stderr
 * and the diagnosis request, which carries variable names but never their values.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorView, CustomConnectorConfig, ParsedCustomConnectors } from '@deepseek-ai/dsh-market-connectors/types'
import { formatPairs, joinCommandLine, parsePairs, splitCommandLine } from '../src/client/command-line.ts'
import { ConnectorCatalog, ConnectorDetail, type ConnectorDetailProps } from '../src/client/Connectors.tsx'
import { CustomConnectorDialog } from '../src/client/CustomConnectorDialog.tsx'
import { zh } from '../src/client/locales.ts'
import type { MarketState } from '../src/client/market-store.ts'
import type { MarketPageProps } from '../src/client/MarketPage.tsx'

afterEach(() => { cleanup() })

const t: MarketPageProps['t'] = (key, params) => {
  const template: string = key in zh ? zh[key as keyof typeof zh] : key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
}

describe('command line and pairs', () => {
  it('splits on whitespace, keeps quoted parts whole, and treats backslashes as text', () => {
    expect(splitCommandLine('  npx -y @modelcontextprotocol/server-filesystem "D:\\My Docs" \'a "b"\' ""  ')).toEqual({
      command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\My Docs', 'a "b"', ''],
    })
    expect(splitCommandLine('   ')).toEqual({ command: '', args: [] })
  })

  it('joins a program and arguments into a line that splits back the same', () => {
    const args = ['-y', 'D:\\My Docs', 'say "hi"', '']
    const line = joinCommandLine('C:\\Program Files\\nodejs\\npx.cmd', args)
    expect(line).toBe('"C:\\Program Files\\nodejs\\npx.cmd" -y "D:\\My Docs" \'say "hi"\' ""')
    expect(splitCommandLine(line)).toEqual({ command: 'C:\\Program Files\\nodejs\\npx.cmd', args })
  })

  it('reads KEY=VALUE and Name: Value lines and names the first line without a key', () => {
    expect(parsePairs('A=1\n\n# note\nB = x=y\r\n', '=')).toEqual({ ok: true, pairs: { A: '1', B: 'x=y' } })
    expect(parsePairs('Authorization: Bearer a:b', ':')).toEqual({ ok: true, pairs: { Authorization: 'Bearer a:b' } })
    expect(parsePairs('A=1\nnot a pair', '=')).toEqual({ ok: false, line: 2 })
    expect(formatPairs({ A: '1' }, '=')).toBe('A=1')
    expect(formatPairs({ Authorization: 'Bearer t' }, ':')).toBe('Authorization: Bearer t')
  })
})

const timeConfig: CustomConnectorConfig = {
  name: 'time', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-time'], env: { GITHUB_TOKEN: 'secret-value' },
}
const time: ConnectorView = {
  id: 'custom-time', origin: 'custom', enabled: true, confirmed: true, state: 'connected',
  launch: { command: 'npx', args: ['-y', 'mcp-time'] }, custom: timeConfig,
}

function stateOf(views: readonly ConnectorView[]): MarketState {
  return {
    market: { revision: 1, source: 'remote', categories: [], featured: [], items: [], kinds: ['skill', 'connector'], installing: [], progress: [] },
    streamFailed: false, installedSkills: undefined, installedLoading: false, switching: [], canReveal: false,
    connectors: { revision: 1, connectors: [...views] }, connectorBusy: [], notice: null,
  }
}

function pageProps(state: MarketState) {
  return {
    t, text: (value: { zh: string }) => value.zh,
    useMarket: <T,>(select: (value: MarketState) => T): T => select(state),
    install: vi.fn(() => Promise.resolve(true)),
    uninstall: vi.fn(() => Promise.resolve()),
    setConnectorEnabled: vi.fn(() => Promise.resolve(true)),
    retryConnector: vi.fn(() => Promise.resolve()),
    refreshConnectors: vi.fn(() => Promise.resolve(undefined)),
    parseCustomConnectors: vi.fn(() => Promise.resolve({ ok: true as const, value: { entries: [] } })),
    saveCustomConnector: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    removeCustomConnector: vi.fn(() => Promise.resolve(true)),
    diagnose: vi.fn<(prompt: string) => void>(),
  }
}

it('lists custom connectors first with their tag and command, and switches them from the card', () => {
  const state = stateOf([time])
  const props = pageProps(state)
  const page: Partial<MarketPageProps> = props
  render(<ConnectorCatalog {...(page as MarketPageProps)} market={state.market} text={props.text} />)
  expect(screen.getByText(zh.customTag)).toBeTruthy()
  expect(screen.getByText('npx -y mcp-time')).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: '连接time' }))
  expect(props.setConnectorEnabled).toHaveBeenCalledWith('custom-time', false, false, 'time')

  fireEvent.click(screen.getByRole('button', { name: zh.addConnector }))
  expect(screen.getByRole('dialog', { name: zh.addConnectorTitle })).toBeTruthy()
})

describe('add dialog', () => {
  it('previews pasted servers and adds the usable ones with their switch', async () => {
    const parsed: ParsedCustomConnectors = {
      entries: [
        { name: 'filesystem', enabled: true, ignored: ['autoApprove'], config: { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', 'fs'], env: {} } },
        { name: 'remote', enabled: false, ignored: [], config: { name: 'remote', transport: 'streamable-http', url: 'https://x.example/mcp', headers: {} } },
        { name: 'legacy', enabled: true, ignored: [], problem: 'sse' },
      ],
    }
    const parse = vi.fn(() => Promise.resolve({ ok: true as const, value: parsed }))
    const save = vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } }))
    const onClose = vi.fn()
    render(<CustomConnectorDialog t={t} parse={parse} save={save} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox', { name: zh.pasteLabel }), { target: { value: '{ "mcpServers": {} }' } })
    await vi.waitFor(() => { expect(screen.getByText('filesystem')).toBeTruthy() })
    expect(parse).toHaveBeenCalledWith('{ "mcpServers": {} }')
    expect(screen.getByText(zh.problemSse)).toBeTruthy()
    expect(screen.getByText(zh.pasteDisabled)).toBeTruthy()
    expect(screen.getByText('未使用的字段：autoApprove')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加 2 个' }))
    await vi.waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(save).toHaveBeenNthCalledWith(1, { config: parsed.entries[0]?.config, enabled: true })
    expect(save).toHaveBeenNthCalledWith(2, { config: parsed.entries[1]?.config, enabled: false })
  })

  it('reports pasted text that is not JSON', async () => {
    const parse = vi.fn(() => Promise.resolve({ ok: true as const, value: { entries: [], problem: 'not-json' as const, detail: 'Unexpected token' } }))
    render(<CustomConnectorDialog t={t} parse={parse} save={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: zh.pasteLabel }), { target: { value: 'npx something' } })
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('不是有效的 JSON：Unexpected token') })
    expect(screen.getByRole('button', { name: '添加 0 个' }).hasAttribute('disabled')).toBe(true)
  })

  it('builds a local program from the form, previews its JSON, and shows a refusal', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: { code: 'market-connectors/name-taken', message: 'taken', details: { name: 'docs' } } })
      .mockResolvedValueOnce({ ok: true as const, value: { revision: 1, connectors: [] } })
    const onClose = vi.fn()
    render(<CustomConnectorDialog t={t} parse={vi.fn()} save={save} onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: zh.modeForm }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.fieldName }), { target: { value: 'docs' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.missingCommand) })
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: zh.fieldCommand }), { target: { value: 'npx -y @scope/fs "D:\\My Docs"' } })
    fireEvent.change(screen.getByRole('textbox', { name: zh.fieldEnv }), { target: { value: 'LOG=1' } })
    fireEvent.change(screen.getByRole('textbox', { name: zh.fieldTimeout }), { target: { value: '120' } })
    const config = { name: 'docs', transport: 'stdio', command: 'npx', args: ['-y', '@scope/fs', 'D:\\My Docs'], env: { LOG: '1' }, toolCallTimeoutMs: 120_000 }
    expect(JSON.parse(screen.getByText(/"mcpServers"/).textContent ?? '')).toEqual({
      mcpServers: { docs: { command: 'npx', args: ['-y', '@scope/fs', 'D:\\My Docs'], env: { LOG: '1' }, toolCallTimeoutMs: 120_000 } },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(zh.problemNameTaken) })
    expect(save).toHaveBeenLastCalledWith({ config })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(onClose).toHaveBeenCalled() })
  })

  it('edits a remote service and refuses a header line without a separator', async () => {
    const save = vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } }))
    const editing: CustomConnectorConfig = { name: 'remote', transport: 'streamable-http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer t' } }
    render(<CustomConnectorDialog t={t} editing={editing} parse={vi.fn()} save={save} onClose={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: zh.modePaste })).toBeNull()
    expect(screen.queryByRole('tab', { name: zh.typeStdio })).toBeNull()
    expect(screen.getByText(zh.typeHttp)).toBeTruthy()
    expect(screen.getByText(zh.typeHttpDescription)).toBeTruthy()
    expect(screen.getByText(zh.typeFixed)).toBeTruthy()
    const url = screen.getByRole('textbox', { name: zh.fieldUrl })
    fireEvent.change(url, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.missingUrl) })
    fireEvent.change(url, { target: { value: editing.url } })
    const headers = screen.getByRole('textbox', { name: zh.fieldHeaders })
    expect((headers as HTMLTextAreaElement).value).toBe('Authorization: Bearer t')
    fireEvent.change(headers, { target: { value: 'Authorization Bearer t' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Headers第 1 行缺少名称或值。') })
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(headers, { target: { value: 'Authorization: Bearer u' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith({ previousName: 'remote', config: { ...editing, headers: { Authorization: 'Bearer u' } } })
    })
  })
})

function showDetail(view: ConnectorView) {
  const props = { ...pageProps(stateOf([view])), id: view.id, connectOnOpen: false, onClose: vi.fn(), onEdit: vi.fn() }
  const page: Partial<ConnectorDetailProps> = props
  render(<ConnectorDetail {...(page as ConnectorDetailProps)} />)
  return props
}

describe('custom connector detail', () => {
  it('explains a missing command, shows stderr, and asks for a diagnosis without the values', () => {
    const failed: ConnectorView = {
      ...time, state: 'failed', hint: 'command-not-found', error: 'command npx was not found', stderr: ['line one', 'line two'],
    }
    const props = showDetail(failed)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('找不到命令 npx。请先安装 Node.js，然后重启应用。')
    expect(alert.textContent).toContain('command npx was not found')
    expect(within(alert).getByText(/line one/).textContent).toBe('line one\nline two')

    fireEvent.click(screen.getByRole('button', { name: zh.diagnose }))
    expect(props.onClose).toHaveBeenCalled()
    const prompt = props.diagnose.mock.calls[0]?.[0] ?? ''
    expect(prompt).toContain('连接器 time 启动失败')
    expect(prompt).toContain('命令: npx -y mcp-time')
    expect(prompt).toContain('环境变量: GITHUB_TOKEN （值未附上）')
    expect(prompt).toContain('line two')
    expect(prompt).not.toContain('secret-value')
  })

  it('hides environment values until shown, edits, and deletes after a confirmation', async () => {
    const props = showDetail(time)
    expect(screen.queryByText('secret-value')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.showValues }))
    expect(screen.getByText('secret-value')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.edit }))
    expect(props.onEdit).toHaveBeenCalledWith(timeConfig)

    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.delete }))
    expect(screen.getByText(zh.confirmDeleteText)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.delete }))
    await vi.waitFor(() => { expect(props.removeCustomConnector).toHaveBeenCalledWith('time') })
    await vi.waitFor(() => { expect(props.onClose).toHaveBeenCalled() })
  })

  it('names a refused token and an SSE address of a remote service', () => {
    const remote: ConnectorView = {
      id: 'custom-remote', origin: 'custom', enabled: true, confirmed: true, state: 'failed', hint: 'unauthorized', error: 'HTTP 401',
      custom: { name: 'remote', transport: 'streamable-http', url: 'https://x.example/mcp', headers: {} },
    }
    showDetail(remote)
    expect(screen.getByRole('alert').textContent).toContain(zh.hintUnauthorized)
    cleanup()
    showDetail({ ...remote, hint: 'maybe-sse' })
    expect(screen.getByRole('alert').textContent).toContain(zh.hintMaybeSse)
  })
})
