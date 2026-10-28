/** Locate the Windows Desktop's bundled Cua Driver MCP server outside ASAR. */
import { dirname, join } from 'node:path'
import type { StdioConfig } from '@deepseek-ai/dsh-mcp-client'

/**
 * Select the bundled stdio server without depending on PATH or a separate Cua Driver installation.
 * The MCP client owns startup diagnostics, reconnection and subprocess disposal; the driver
 * exits when its stdin closes. Desktop does not forward driver usage events to the upstream telemetry service.
 * @param source - Desktop primary-runtime directory in application resources.
 * @param platform - Application host platform.
 * @returns Windows server configuration, or undefined for platforms without this payload.
 */
export function desktopCuaDriverConfig(source: string, platform: NodeJS.Platform = process.platform): StdioConfig | undefined {
  if (platform !== 'win32') return undefined
  const root = join(dirname(source), 'cua-driver')
  return {
    serverName: 'cua-driver',
    transport: 'stdio',
    command: join(root, 'cua-driver.exe'),
    args: ['mcp'],
    cwd: root,
    env: { CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
    toolCallTimeoutMs: 120_000,
    failOnStartupError: true,
  }
}
