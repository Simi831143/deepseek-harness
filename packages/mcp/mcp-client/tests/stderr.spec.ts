/**
 * Stderr of stdio MCP servers: line splitting and decoding, the bounded tail, and
 * real child processes whose stderr reaches the Host log and the startup error
 * without blocking the server.
 */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { McpStartupError, STDERR_TAIL_CHARS, STDERR_TAIL_LINES } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { decodeStderrLine, readStderrLines, StderrTail } from '@deepseek-ai/dsh-mcp-client/src/stderr.ts'

const exitFixture = fileURLToPath(new URL('./fixtures/stderr-exit.mjs', import.meta.url))
const floodFixture = fileURLToPath(new URL('./fixtures/stderr-flood-server.mjs', import.meta.url))
const NOT_A_COMMAND = '不是内部或外部命令'

describe('decodeStderrLine', () => {
  it('reads UTF-8 as UTF-8', () => {
    expect(decodeStderrLine(Buffer.from(`错误: ${NOT_A_COMMAND}`, 'utf8'))).toBe(`错误: ${NOT_A_COMMAND}`)
  })

  it('reads bytes that are not UTF-8 as GBK', () => {
    expect(decodeStderrLine(Buffer.from('b2bbcac7c4dab2bfbbf2cde2b2bfc3fcc1ee', 'hex'))).toBe(NOT_A_COMMAND)
  })
})

describe('readStderrLines', () => {
  function collect(): { stream: PassThrough; lines: string[] } {
    const stream = new PassThrough()
    const lines: string[] = []
    readStderrLines(stream, (line) => { lines.push(line) })
    return { stream, lines }
  }

  it('splits chunks into lines, drops CR and blank lines, and delivers the open line at the end', async () => {
    const { stream, lines } = collect()
    stream.write('first li')
    stream.write('ne\r\nsecond\n\n')
    stream.write('   \n')
    stream.end('last without newline')
    await new Promise(resolve => stream.once('end', resolve))
    expect(lines).toEqual(['first line', 'second', 'last without newline'])
  })

  it('decodes a GBK line whose bytes arrive in two chunks', () => {
    const { stream, lines } = collect()
    const bytes = Buffer.from('b2bbcac7c4dab2bfbbf2cde2b2bfc3fcc1ee0a', 'hex')
    stream.write(bytes.subarray(0, 5))
    stream.write(bytes.subarray(5))
    expect(lines).toEqual([NOT_A_COMMAND])
  })

  it('cuts a run without newlines into bounded lines', () => {
    const { stream, lines } = collect()
    stream.write('a'.repeat(3000))
    stream.write('a'.repeat(7000))
    stream.destroy(new Error('pipe closed'))
    return new Promise<void>((resolve) => {
      stream.once('close', () => {
        expect(lines.map(line => line.length)).toEqual([4096, 4096, 1808])
        resolve()
      })
    })
  })
})

describe('StderrTail', () => {
  it('keeps the last lines', () => {
    const tail = new StderrTail()
    for (let index = 0; index < STDERR_TAIL_LINES + 10; index += 1) tail.add(`line ${index}`)
    const lines = tail.lines()
    expect(lines).toHaveLength(STDERR_TAIL_LINES)
    expect(lines[0]).toBe('line 10')
    expect(lines.at(-1)).toBe(`line ${STDERR_TAIL_LINES + 9}`)
  })

  it('keeps at most the character budget', () => {
    const tail = new StderrTail()
    tail.add('a'.repeat(3000))
    tail.add('b'.repeat(3000))
    tail.add('c'.repeat(3000))
    expect(tail.lines().map(line => line[0])).toEqual(['b', 'c'])
    tail.add('d'.repeat(STDERR_TAIL_CHARS + 100))
    expect(tail.lines()).toEqual(['d'.repeat(STDERR_TAIL_CHARS)])
  })
})

async function mountRegistry(): Promise<{ ctx: Context; logged: string[] }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const logged: string[] = []
  const info = ctx.logger.info.bind(ctx.logger)
  ctx.logger.info = (format: unknown, ...args: unknown[]) => {
    if (format === '%s stderr: %s') logged.push(`${String(args[0])} ${String(args[1])}`)
    else info(format, ...args)
  }
  return { ctx, logged }
}

describe('stdio server stderr', () => {
  it('logs every line and attaches the last lines to the startup error', async () => {
    const { ctx, logged } = await mountRegistry()
    const fiber = ctx.plugin(mcpClient, {
      transport: 'stdio', serverName: 'noisy', command: process.execPath, args: [exitFixture], failOnStartupError: true,
    })
    const error: unknown = await fiber.then(() => undefined, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(McpStartupError)
    const startup = error as McpStartupError
    expect(startup.serverName).toBe('noisy')
    expect(startup.message).toBe('mcp-client(noisy): initial connection or tool synchronization failed')
    expect(startup.cause).toBeInstanceOf(Error)
    expect(startup.stderr).toEqual(['starting fixture', NOT_A_COMMAND, 'Error: package mcp-server-missing not found'])
    expect(logged).toContain(`mcp-client(noisy) ${NOT_A_COMMAND}`)
  }, 30_000)

  it('keeps serving a server that writes a lot to stderr', async () => {
    const { ctx, logged } = await mountRegistry()
    await ctx.plugin(mcpClient, {
      transport: 'stdio', serverName: 'flood', command: process.execPath, args: [floodFixture], failOnStartupError: true,
    })
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('stderr-flood-1'), name: 'mcp__flood__echo', arguments: { text: 'still here' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'still here' })
    expect(logged.length).toBeGreaterThan(1024)
  }, 30_000)
})
