import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopUpdateOnQuit, removeStagedInstallDirectories, runningInstaller, type UpdateOnQuitContext } from '../src/update-on-quit.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'update-on-quit-'))
  directories.push(directory)
  return directory
}

const QUIT: UpdateOnQuitContext = { platform: 'win32', ready: true, sessionEnding: false, recovery: false, mandatory: false }

describe('desktop update on quit', () => {
  it('installs only on an ordinary Windows quit with a ready download', async () => {
    const state = new DesktopUpdateOnQuit(join(await scratch(), 'record.json'), '1.0.0')
    expect(state.decide(QUIT)).toBe('install')
    expect(state.decide({ ...QUIT, platform: 'darwin' })).toBe('unsupported')
    expect(state.decide({ ...QUIT, ready: false })).toBe('no-update')
    expect(state.decide({ ...QUIT, sessionEnding: true })).toBe('session-ending')
    expect(state.decide({ ...QUIT, recovery: true })).toBe('recovery')
    expect(state.decide({ ...QUIT, mandatory: true })).toBe('mandatory')
  })

  it('reports an interrupted install and keeps installing on every later quit', async () => {
    const path = join(await scratch(), 'record.json')
    const first = new DesktopUpdateOnQuit(path, '1.0.0')
    expect(await first.load()).toBe(false)
    await first.begin('1.1.0')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ from: '1.0.0', target: '1.1.0' })
    for (let attempt = 0; attempt < 5; attempt++) {
      const relaunch = new DesktopUpdateOnQuit(path, '1.0.0')
      expect(await relaunch.load()).toBe(true)
      expect(relaunch.decide(QUIT)).toBe('install')
      await relaunch.begin('1.1.0')
    }
  })

  it('forgets the record once the launch runs another version', async () => {
    const path = join(await scratch(), 'record.json')
    const before = new DesktopUpdateOnQuit(path, '1.0.0')
    await before.begin('1.1.0')
    const after = new DesktopUpdateOnQuit(path, '1.1.0')
    expect(await after.load()).toBe(false)
    expect(after.decide(QUIT)).toBe('install')
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['', '{', 'null', '[]', '{"from":1,"target":"1.1.0"}', '{"from":"1.0.0"}'])(
    'treats an unreadable record %j as no prior attempt', async (content) => {
      const path = join(await scratch(), 'record.json')
      await writeFile(path, content)
      const state = new DesktopUpdateOnQuit(path, '1.0.0')
      expect(await state.load()).toBe(false)
      expect(state.decide(QUIT)).toBe('install')
    })

  it('removes only GUID-named staging siblings of the installation directory', async () => {
    const parent = await scratch()
    const install = join(parent, 'LC_Camera_Agent')
    const guid = '{0F8FAD5B-D9CB-469F-A165-70867728950E}'
    const kept = ['LC_Camera_Agent', 'LC_Camera_Agent.new-backup', 'LC_Camera_Agent.old-0F8FAD5B-D9CB-469F-A165-70867728950E',
      'Other.new-' + guid, 'LC_Camera_Agent2.old-' + guid]
    const removed = ['LC_Camera_Agent.new-' + guid, 'LC_Camera_Agent.old-{5C3F9D1E-2A4B-4C6D-8E7F-0123456789AB}']
    for (const name of [...kept, ...removed]) await mkdir(join(parent, name, 'resources'), { recursive: true })
    // A staged tree holds an app.asar; Electron's patched fs would open it as an archive instead of deleting it.
    await writeFile(join(parent, removed[0]!, 'resources', 'app.asar'), 'not an archive')
    await writeFile(join(parent, 'LC_Camera_Agent.new-' + guid + '.txt'), '')
    await writeFile(join(parent, 'LC_Camera_Agent.installing'), '4242')
    expect((await removeStagedInstallDirectories(install)).sort()).toEqual([...removed, 'LC_Camera_Agent.installing'].sort())
    expect((await readdir(parent)).sort()).toEqual([...kept, 'LC_Camera_Agent.new-' + guid + '.txt'].sort())
  })

  it('recognizes a live installer only through its marker PID', async () => {
    const install = join(await scratch(), 'LC_Camera_Agent')
    const alive = new Set([4242])
    const isRunning = (pid: number) => alive.has(pid)
    expect(await runningInstaller(install, isRunning)).toBeUndefined()
    for (const [content, expected] of [['4242', 4242], [' 4242\r\n', 4242], ['1717', undefined], ['', undefined],
      ['0', undefined], ['-1', undefined], ['4242.5', undefined], ['abc', undefined]] as const) {
      await writeFile(`${install}.installing`, content)
      expect(await runningInstaller(install, isRunning)).toBe(expected)
    }
  })

  it('finds this process through the default liveness probe', async () => {
    const install = join(await scratch(), 'LC_Camera_Agent')
    await writeFile(`${install}.installing`, String(process.pid))
    expect(await runningInstaller(install)).toBe(process.pid)
  })

  it('returns nothing when the parent directory cannot be read', async () => {
    expect(await removeStagedInstallDirectories(join(await scratch(), 'missing', 'LC_Camera_Agent'))).toEqual([])
  })
})
