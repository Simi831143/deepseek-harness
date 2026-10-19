/** Verify the installed Scrapling MCP against a private local page without model credentials. */
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/**
 * Exercise MCP discovery, HTTP, both browser drivers, screenshots and session closure.
 * The child receives an empty browser cache and no Python or browser commands through PATH.
 * @param root - Relocated application resource directory containing python.exe and mcp-server.py.
 * @returns Resolves only after every probe succeeds and owned subprocesses and HTTP sockets close.
 */
export async function smokeScraplingRuntime(root: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-scrapling-smoke-'))
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><p id="result">HTTP_READY</p><script>document.querySelector("#result").textContent="JS_READY"</script>')
  })
  const client = new Client({ name: 'dsh-desktop-scrapling-smoke', version: '1' }, {
    capabilities: {}, versionNegotiation: { mode: 'auto' },
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Scrapling smoke: no fixture port')
    const url = `http://127.0.0.1:${String(address.port)}/`
    const environment = scrubWindowsSigningEnvironment(process.env)
    const transport = new StdioClientTransport({
      command: join(root, 'python.exe'), args: ['-I', '-B', join(root, 'mcp-server.py')], cwd: temporary,
      env: {
        ...Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        PATH: `${root}${delimiter}${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}`, PYTHONPATH: temporary,
        PLAYWRIGHT_BROWSERS_PATH: join(temporary, 'empty-browser-cache'),
        SCRAPLING_EXECUTABLE_PATH: join(temporary, 'missing-browser.exe'),
      },
      stderr: 'inherit',
    })
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      const required = ['make_request', 'fetch', 'stealthy_fetch', 'open_session', 'session_fetch', 'screenshot', 'close_session', 'list_sessions']
      for (const name of required) {
        if (!tools.some(tool => tool.name === name)) throw new Error(`Scrapling smoke: missing tool ${name}`)
      }
      const call = async (name: string, args: Record<string, string | boolean>): Promise<string> => {
        const result = await client.callTool({ name, arguments: args }, { timeout: 120_000 })
        if (result.isError) throw new Error(`Scrapling smoke ${name}: ${JSON.stringify(result)}`)
        return JSON.stringify(result)
      }
      for (const [name, expected] of [['make_request', 'HTTP_READY'], ['fetch', 'JS_READY'], ['stealthy_fetch', 'JS_READY']] as const) {
        const output = await call(name, { url, extraction_type: 'text', css_selector: '#result' })
        if (!output.includes(expected)) throw new Error(`Scrapling smoke: ${name} did not return ${expected}: ${output}`)
      }
      const sessionId = 'desktop-payload-smoke'
      await call('open_session', { session_type: 'dynamic', session_id: sessionId })
      try {
        const page = await call('session_fetch', { session_id: sessionId, url, extraction_type: 'text', css_selector: '#result' })
        if (!page.includes('JS_READY')) throw new Error(`Scrapling smoke: persistent page content missing: ${page}`)
        const result = await client.callTool({ name: 'screenshot', arguments: { session_id: sessionId, url } }, { timeout: 120_000 })
        if (result.isError || !result.content?.some(block => block.type === 'image')) throw new Error('Scrapling smoke: screenshot did not return an image')
      } finally {
        await call('close_session', { session_id: sessionId })
      }
      const sessions = await call('list_sessions', {})
      if (sessions.includes(sessionId)) throw new Error('Scrapling smoke: browser session remains open')
      process.stdout.write(`Scrapling MCP smoke passed (${String(tools.length)} tools; HTTP, dynamic, stealth, screenshot, session cleanup).\n`)
    } finally {
      await client.close()
      await transport.close()
    }
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((done, reject) => server.close((error) => { if (error) reject(error); else done() }))
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (import.meta.main) {
  if (process.argv[2] === undefined) throw new Error('Usage: smoke-scrapling-runtime.ts <Scrapling resource directory>')
  await smokeScraplingRuntime(resolve(process.argv[2]))
}
