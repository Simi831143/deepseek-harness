import { join } from 'node:path'
import { expect, it } from 'vitest'
import { desktopCuaDriverConfig } from '../src/cua-driver.ts'

it('uses the installed resource directory and disables upstream telemetry', () => {
  const resources = join('installed app with spaces', 'resources', 'runtime')
  const root = join(resources, 'cua-driver')
  expect(desktopCuaDriverConfig(join(resources, 'primary-runtime'), 'win32')).toEqual({
    serverName: 'cua-driver', transport: 'stdio', command: join(root, 'cua-driver.exe'),
    args: ['mcp'], cwd: root, env: { CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
    toolCallTimeoutMs: 120_000, failOnStartupError: true,
  })
})

it.each(['darwin', 'linux'] as const)('omits the Windows payload on %s', (platform) => {
  expect(desktopCuaDriverConfig('/resources/runtime/primary-runtime', platform)).toBeUndefined()
})
