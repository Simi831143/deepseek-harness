/**
 * Legacy stdio MCP server with one `echo` tool that writes 1 MiB to stderr before it
 * answers `initialize` and 256 KiB before every tool result. Writes are synchronous,
 * so the server blocks when nobody reads its stderr pipe. Dependency-free.
 */
import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

const flood = (bytes) => {
  const line = Buffer.from(`${'x'.repeat(1023)}\n`)
  for (let written = 0; written < bytes; written += line.length) writeSync(2, line)
}

process.stdin.once('end', () => process.exit(0))
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  switch (request.method) {
    case 'initialize':
      flood(1024 * 1024)
      reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'flood', version: '1' } })
      return
    case 'tools/list':
      reply(request.id, { tools: [{ name: 'echo', description: 'Repeat the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] })
      return
    case 'tools/call':
      flood(256 * 1024)
      reply(request.id, { content: [{ type: 'text', text: String(request.params.arguments?.text ?? '') }] })
      return
    default:
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `no ${request.method}` } })}\n`)
  }
})
