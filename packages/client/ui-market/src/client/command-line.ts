/**
 * Text forms of a custom connector's fields: the whole command line the user pastes, and the
 * `KEY=VALUE` and `Name: Value` lines of environment variables and headers. The Host checks the
 * resulting configuration; these helpers only move between text and values.
 */

/**
 * Split a command line into program and arguments: whitespace separates, and a part in single
 * or double quotes stays one argument. A backslash is an ordinary character, because Windows
 * paths are full of them.
 * @param line - the command line.
 * @returns the program and its arguments; an empty program for a blank line.
 */
export function splitCommandLine(line: string): { readonly command: string; readonly args: string[] } {
  const parts: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | undefined
  for (const char of line) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) parts.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) parts.push(current)
  const [command = '', ...args] = parts
  return { command, args }
}

/**
 * Join a program and its arguments back into one line that {@link splitCommandLine} reads the same.
 * @param command - program.
 * @param args - arguments.
 * @returns the command line.
 */
export function joinCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quotePart).join(' ')
}

function quotePart(part: string): string {
  if (part !== '' && !/[\s"']/.test(part)) return part
  return part.includes('"') ? `'${part}'` : `"${part}"`
}

/** Lines read into pairs, or the first line that has no separator. */
export type PairsResult =
  | { readonly ok: true; readonly pairs: Record<string, string> }
  | { readonly ok: false; readonly line: number }

/**
 * Read `KEY=VALUE` or `Name: Value` lines; blank lines and lines starting with `#` are skipped.
 * @param text - one pair per line.
 * @param separator - `=` for environment variables, `:` for headers.
 * @returns the pairs, or the 1-based number of the first line without a key and separator.
 */
export function parsePairs(text: string, separator: '=' | ':'): PairsResult {
  const pairs: Record<string, string> = {}
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const at = line.indexOf(separator)
    const key = at === -1 ? '' : line.slice(0, at).trim()
    if (key === '') return { ok: false, line: index + 1 }
    pairs[key] = line.slice(at + 1).trim()
  }
  return { ok: true, pairs }
}

/**
 * Write pairs back as one `KEY=VALUE` or `Name: Value` line each.
 * @param pairs - names and values.
 * @param separator - `=` for environment variables, `:` for headers.
 * @returns one pair per line.
 */
export function formatPairs(pairs: Readonly<Record<string, string>>, separator: '=' | ':'): string {
  const joiner = separator === ':' ? ': ' : '='
  return Object.entries(pairs).map(([key, value]) => `${key}${joiner}${value}`).join('\n')
}
