import { join } from 'node:path'
import { expect, it } from 'vitest'
import { desktopScraplingConfig } from '../src/scrapling.ts'

it('uses the installed resource directory for every server path', () => {
  const resources = join('installed app with spaces', 'resources', 'runtime')
  const root = join(resources, 'scrapling')
  expect(desktopScraplingConfig(join(resources, 'primary-runtime'), 'win32')).toEqual({
    serverName: 'scrapling', transport: 'stdio', command: join(root, 'python.exe'),
    args: ['-I', '-B', join(root, 'mcp-server.py')], cwd: root, env: {},
    toolCallTimeoutMs: 120_000, failOnStartupError: true,
  })
})

it.each(['darwin', 'linux'] as const)('omits the Windows payload on %s', (platform) => {
  expect(desktopScraplingConfig('/resources/runtime/primary-runtime', platform)).toBeUndefined()
})
