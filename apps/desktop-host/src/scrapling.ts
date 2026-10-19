/** Locate the Windows Desktop's self-contained Scrapling MCP server outside ASAR. */
import { dirname, join } from 'node:path'
import type { StdioConfig } from '@deepseek-ai/dsh-mcp-client'

/**
 * Select the bundled stdio server without depending on PATH or user Python installations.
 * The MCP client owns startup diagnostics, reconnection and subprocess disposal.
 * @param source - Desktop primary-runtime directory in application resources.
 * @param platform - Application host platform.
 * @returns Windows server configuration, or undefined for platforms without this payload.
 */
export function desktopScraplingConfig(source: string, platform: NodeJS.Platform = process.platform): StdioConfig | undefined {
  if (platform !== 'win32') return undefined
  const root = join(dirname(source), 'scrapling')
  return {
    serverName: 'scrapling',
    transport: 'stdio',
    command: join(root, 'python.exe'),
    args: ['-I', '-B', join(root, 'mcp-server.py')],
    cwd: root,
    env: {},
    toolCallTimeoutMs: 120_000,
    failOnStartupError: true,
  }
}
