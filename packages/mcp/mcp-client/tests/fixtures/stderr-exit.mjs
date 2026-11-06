/**
 * Stdio "server" that writes a few stderr lines and exits before answering, like a
 * server whose dependency is missing. One line is GBK, as cmd.exe writes on a
 * Chinese Windows system. Dependency-free.
 */
import { writeSync } from 'node:fs'

writeSync(2, 'starting fixture\r\n')
writeSync(2, Buffer.from('b2bbcac7c4dab2bfbbf2cde2b2bfc3fcc1ee0d0a', 'hex'))
writeSync(2, 'Error: package mcp-server-missing not found\n')
process.exit(3)
