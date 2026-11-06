/**
 * Legacy stdio MCP server with one `echo` tool for the connector kind's tests. It appends
 * `start <pid>` and `exit <pid>` lines to the file named by FIXTURE_LOG, so a test can see when
 * the connector program starts and stops, and `key <value> <pid>` when FIXTURE_KEY is set. Dependency-free because it runs from a temporary package.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = process.env.FIXTURE_LOG
const record = line => { if (log) appendFileSync(log, `${line} ${process.pid}\n`) }
record(`start ${process.env.FIXTURE_VERSION ?? ''}`.trim())
if (process.env.FIXTURE_KEY !== undefined) record(`key ${process.env.FIXTURE_KEY}`)
process.once('exit', () => record('exit'))
process.stdin.once('end', () => process.exit(0))

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } })
      return
    case 'tools/list':
      reply(request.id, { tools: [{ name: 'echo', description: 'Repeat the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] })
      return
    case 'tools/call':
      reply(request.id, { content: [{ type: 'text', text: String(request.params.arguments?.text ?? '') }] })
      return
    default:
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `no ${request.method}` } })}\n`)
  }
})
