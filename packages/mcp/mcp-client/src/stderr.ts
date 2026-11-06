/**
 * Stderr of stdio MCP servers: split into lines, decoded, and kept as a short tail
 * for startup diagnostics. A piped stderr must be read for the child's whole life;
 * a server that writes a lot to an unread pipe blocks once the pipe buffer fills.
 *
 * @module
 */

import type { Stream } from 'node:stream'

/** Lines kept in a {@link StderrTail}. */
export const STDERR_TAIL_LINES = 50

/** Characters kept in a {@link StderrTail} across all of its lines. */
export const STDERR_TAIL_CHARS = 8_192

/** Bytes of one line; a longer run without a newline is cut into lines of this size. */
const MAX_LINE_BYTES = 4_096

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

let strictUtf8: TextDecoder | undefined
let fallbackDecoder: TextDecoder | undefined

/**
 * Decode one stderr line. Bytes that are valid UTF-8 are read as UTF-8; other bytes
 * are read as GBK, the code page `cmd.exe` and many Windows programs write on a
 * Chinese system. A runtime without GBK support reads them as lossy UTF-8.
 *
 * @param bytes - one line without its line break.
 * @returns the decoded text.
 */
export function decodeStderrLine(bytes: Uint8Array): string {
  strictUtf8 ??= new TextDecoder('utf-8', { fatal: true })
  try {
    return strictUtf8.decode(bytes)
  } catch (_notUtf8) {
    fallbackDecoder ??= gbkOrLossyUtf8()
    return fallbackDecoder.decode(bytes)
  }
}

function gbkOrLossyUtf8(): TextDecoder {
  try {
    return new TextDecoder('gbk')
  /* v8 ignore next 4 -- Node builds without full ICU have no GBK decoder; the test runtime has it */
  } catch (_noGbk) {
    return new TextDecoder('utf-8')
  }
}

/** The last lines one MCP server wrote to stderr, bounded by line count and total characters. */
export class StderrTail {
  private readonly kept: string[] = []
  private chars = 0

  /**
   * Keep one line, dropping the oldest lines past the bounds.
   * @param line - decoded line.
   */
  add(line: string): void {
    const text = line.length > STDERR_TAIL_CHARS ? line.slice(0, STDERR_TAIL_CHARS) : line
    this.kept.push(text)
    this.chars += text.length
    while (this.kept.length > STDERR_TAIL_LINES || this.chars > STDERR_TAIL_CHARS) {
      this.chars -= (this.kept.shift() as string).length
    }
  }

  /**
   * Read the kept lines.
   * @returns a copy of the kept lines, oldest first.
   */
  lines(): string[] {
    return [...this.kept]
  }
}

/**
 * Read a child's stderr stream to its end, one decoded line at a time. Empty lines are skipped.
 * A line still open when the stream ends is delivered too.
 *
 * @param stream - the piped stderr stream.
 * @param onLine - receives each decoded line.
 */
export function readStderrLines(stream: Stream, onLine: (line: string) => void): void {
  let pending: Buffer[] = []
  let pendingBytes = 0
  const emit = (bytes: Buffer): void => {
    let end = bytes.length
    if (end > 0 && bytes[end - 1] === CARRIAGE_RETURN) end -= 1
    const line = decodeStderrLine(bytes.subarray(0, end))
    if (line.trim() !== '') onLine(line)
  }
  const flush = (): void => {
    if (pendingBytes === 0) return
    const bytes = Buffer.concat(pending, pendingBytes)
    pending = []
    pendingBytes = 0
    emit(bytes)
  }
  // The SDK's piped stream has no encoding set, so chunks are Buffers.
  stream.on('data', (chunk: Buffer) => {
    let bytes = chunk
    for (;;) {
      const newline = bytes.indexOf(NEWLINE)
      if (newline === -1) break
      pending.push(bytes.subarray(0, newline))
      pendingBytes += newline
      flush()
      bytes = bytes.subarray(newline + 1)
    }
    while (pendingBytes + bytes.length > MAX_LINE_BYTES) {
      const room = MAX_LINE_BYTES - pendingBytes
      pending.push(bytes.subarray(0, room))
      pendingBytes += room
      flush()
      bytes = bytes.subarray(room)
    }
    if (bytes.length > 0) {
      pending.push(bytes)
      pendingBytes += bytes.length
    }
  })
  stream.on('end', flush)
  stream.on('close', flush)
  // A destroyed pipe reports an error; the transport's own close path owns the failure.
  stream.on('error', flush)
}
