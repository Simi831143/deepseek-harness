/** Personal skill uploads through the market UI and the real Host importer, without model calls. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator, type Page } from 'playwright'
import { strToU8, zipSync } from 'fflate'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft, ZH_BROWSER_LOCALE } from './support.ts'

const BUNDLE_DIR = fileURLToPath(new URL('../../../packages/bundle/market', import.meta.url))
const EXPECTED_DIR = fileURLToPath(new URL('./expected/market-skill-import', import.meta.url))
const ANCHOR = 'upload-e2e-anchor'
const MARKDOWN_SKILL = 'upload-e2e-markdown'
const ZIP_SKILL = 'upload-e2e-package'

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
}

async function openUpload(page: Page): Promise<Locator> {
  await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Market', exact: true }).click()
  await page.getByRole('tab', { name: 'Skills', exact: true }).click()
  const back = page.getByRole('button', { name: 'All skills', exact: true })
  if (await back.count() > 0) await back.click()
  await page.getByRole('button', { name: 'Add skill', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Upload skill/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload skill', exact: true })
  await dialog.getByRole('button', { name: 'Choose file', exact: true }).waitFor()
  return dialog
}

async function dropSkillFile(page: Page, dialog: Locator, name: string, type: string, bytes: Uint8Array): Promise<void> {
  const url = page.url()
  const target = dialog.getByRole('button', { name: /^(Choose|Change) file$/ })
  const transfer = await page.evaluateHandle(({ name, type, bytes }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type }))
    return transfer
  }, { name, type, bytes: [...bytes] })
  try {
    await target.dispatchEvent('dragenter', { dataTransfer: transfer })
    const dragoverPrevented = await target.evaluate((element, dataTransfer) => {
      const event = new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }, transfer)
    expect(dragoverPrevented).toBe(true)
    await expect.poll(() => target.getAttribute('data-dragging')).toBe('true')
    const dropPrevented = await target.evaluate((element, dataTransfer) => {
      const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }, transfer)
    expect(dropPrevented).toBe(true)
    await dialog.getByText(name, { exact: true }).waitFor()
    await expect.poll(() => target.getAttribute('data-dragging')).toBeNull()
    expect(page.url()).toBe(url)
  } finally {
    await transfer.dispose()
  }
}

async function inspectUploadLayout(page: Page, dialog: Locator, state: 'empty' | 'conflict'): Promise<void> {
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
        await expect.poll(() => dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
            && element.scrollWidth <= element.clientWidth
        })).toBe(true)
        expect(await dialog.getByRole('button', { name: 'Install', exact: true }).isVisible()).toBe(true)
        expect(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isVisible()).toBe(true)
        expect(await dialog.getByRole('button', { name: 'Choose a ZIP or Markdown file', exact: true }).isVisible()).toBe(true)
        expect(await dialog.getByRole('region', { name: 'File requirements', exact: true }).getByRole('listitem').count()).toBe(2)
        if (webSnapshotMode() === 'refresh') {
          const directory = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
          await mkdir(directory, { recursive: true })
          const prefix = state === 'empty' ? 'market-upload-empty' : 'market-upload'
          await dialog.screenshot({ path: join(directory, `${prefix}-${width}-${colorScheme}.png`), animations: 'disabled' })
        }
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: null })
    await page.setViewportSize({ width: 1680, height: 1000 })
  }
}

it('installs Markdown and packaged skills, refreshes the slash menu, and preserves existing files on conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-market-import-browser-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const overlay = join(root, 'market.yml')
  await writeFile(overlay, JSON.stringify([{ id: 'market', config: { catalogUrl: '' } }]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(BUNDLE_DIR, 'cordis.patch.yml'), overlay],
    extraInstallAnchors: [join(BUNDLE_DIR, 'package.json')],
  })
  onTestFinished(() => scaffold.close())
  const personalRoot = join(scaffold.harnessHome, 'skills')
  await mkdir(join(personalRoot, ANCHOR), { recursive: true })
  await writeFile(join(personalRoot, ANCHOR, 'SKILL.md'), skillFile(ANCHOR, 'Existing personal skill', 'Keep this skill.'))
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-market-skill-import'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const session = scaffold.ctx.sessions.list()[0]
  if (session === undefined) throw new Error('connected workspace did not create a Session')
  const sessionIds = scaffold.ctx.sessions.list().map(value => value.id)
  const input = page.locator('[data-composer-input]').first()
  const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })

  // The existing entry marks a completed catalog read before the import invalidates that cache.
  await writeComposerDraft(page, input, '/upload-e2e-')
  await menu.getByRole('option', { name: new RegExp(`^${ANCHOR} `) }).waitFor()
  expect(await menu.getByRole('option', { name: new RegExp(MARKDOWN_SKILL) }).count()).toBe(0)
  const sessionEvents = session.seq
  await page.keyboard.press('Escape')

  let dialog = await openUpload(page)
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'picker.expected.md'), await dialog.ariaSnapshot(), webSnapshotMode())
  await inspectUploadLayout(page, dialog, 'empty')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Choose a ZIP or Markdown file', exact: true }).click(),
  ])
  expect(chooser.isMultiple()).toBe(false)
  await chooser.setFiles([])
  expect(await dialog.getByRole('button', { name: 'Install', exact: true }).isDisabled()).toBe(true)
  expect(await dialog.getByRole('button', { name: 'Choose file', exact: true }).count()).toBe(1)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'cancelled.md', mimeType: 'text/markdown', buffer: Buffer.from(skillFile('upload-e2e-cancelled', 'Cancelled skill', 'Never installed.')),
  })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await readdir(personalRoot)).sort()).toEqual([ANCHOR])

  dialog = await openUpload(page)
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'invalid.md', mimeType: 'text/markdown', buffer: Buffer.from('# No skill frontmatter\n') })
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'invalid.expected.md'), await dialog.ariaSnapshot(), webSnapshotMode())
  expect((await readdir(personalRoot)).sort()).toEqual([ANCHOR])

  const markdown = skillFile(MARKDOWN_SKILL, 'Imported from Markdown', 'MARKDOWN_IMPORT_BODY')
  // The uploaded filename deliberately differs from the frontmatter name used for placement.
  await dropSkillFile(page, dialog, 'different-filename.md', 'text/markdown', strToU8(markdown))
  expect((await readdir(personalRoot)).sort()).toEqual([ANCHOR])
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: `Show details of ${MARKDOWN_SKILL}`, exact: true }).waitFor()
  expect(await readFile(join(personalRoot, MARKDOWN_SKILL, 'SKILL.md'), 'utf8')).toBe(markdown)

  await page.getByRole('button', { name: `Show details of ${MARKDOWN_SKILL}`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: MARKDOWN_SKILL, exact: true })
  await detail.getByText('MARKDOWN_IMPORT_BODY', { exact: true }).waitFor()
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'detail.expected.md'), await detail.ariaSnapshot(), webSnapshotMode())
  await detail.getByRole('button', { name: 'Close', exact: true }).click()

  dialog = await openUpload(page)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'replacement.md', mimeType: 'text/markdown', buffer: Buffer.from(skillFile(MARKDOWN_SKILL, 'Replacement description', 'REPLACEMENT_BODY')),
  })
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: `A skill named ${MARKDOWN_SKILL} already exists.` }).waitFor()
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'conflict.expected.md'), await dialog.ariaSnapshot(), webSnapshotMode())
  await inspectUploadLayout(page, dialog, 'conflict')
  expect(await readFile(join(personalRoot, MARKDOWN_SKILL, 'SKILL.md'), 'utf8')).toBe(markdown)

  const script = 'throw new Error("An uploaded script must not execute during import")\n'
  const reference = 'ZIP_REFERENCE_BODY\n'
  const asset = Buffer.from([0, 1, 2, 254, 255])
  const archive = zipSync({
    'wrapper/SKILL.md': strToU8(skillFile(ZIP_SKILL, 'Imported with its supporting files', 'ZIP_IMPORT_BODY')),
    'wrapper/scripts/no-run.js': strToU8(script),
    'wrapper/references/guide.md': strToU8(reference),
    'wrapper/assets/sample.bin': asset,
  })
  await dropSkillFile(page, dialog, 'resources.zip', 'application/zip', archive)
  expect((await readdir(personalRoot)).sort()).toEqual([ANCHOR, MARKDOWN_SKILL])
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: `Show details of ${ZIP_SKILL}`, exact: true }).waitFor()
  expect(await readFile(join(personalRoot, ZIP_SKILL, 'scripts', 'no-run.js'), 'utf8')).toBe(script)
  expect(await readFile(join(personalRoot, ZIP_SKILL, 'references', 'guide.md'), 'utf8')).toBe(reference)
  expect(await readFile(join(personalRoot, ZIP_SKILL, 'assets', 'sample.bin'))).toEqual(asset)
  expect((await readdir(personalRoot)).sort()).toEqual([ANCHOR, MARKDOWN_SKILL, ZIP_SKILL])
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'installed.expected.md'), await page.getByRole('tabpanel', { name: 'Skills', exact: true }).ariaSnapshot(), webSnapshotMode())

  await page.locator(`[data-row-key="session:${session.id}"]`).click()
  await writeComposerDraft(page, input, '/upload-e2e-')
  await menu.getByRole('option', { name: new RegExp(`^${ZIP_SKILL} `) }).waitFor()
  expect(await menu.getByRole('option', { name: new RegExp(`^${MARKDOWN_SKILL} `) }).count()).toBe(1)
  await compareOrRefreshGolden(join(EXPECTED_DIR, 'menu.expected.md'), await menu.ariaSnapshot(), webSnapshotMode())
  expect(scaffold.ctx.sessions.list().map(value => value.id)).toEqual(sessionIds)
  expect(session.seq).toBe(sessionEvents)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
  const chinese = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  try {
    await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await chinese.getByRole('button', { name: '市场', exact: true }).click()
    await chinese.getByRole('tab', { name: '技能', exact: true }).click()
    await chinese.getByRole('button', { name: '添加技能', exact: true }).click()
    await chinese.getByRole('menuitem', { name: /^上传技能/ }).click()
    const translated = chinese.getByRole('dialog', { name: '上传技能', exact: true })
    await translated.getByRole('button', { name: '选择文件', exact: true }).waitFor()
    for (const width of [1280, 390]) {
      await chinese.setViewportSize({ width, height: 1000 })
      for (const colorScheme of ['light', 'dark'] as const) {
        await chinese.emulateMedia({ colorScheme })
        await expect.poll(() => chinese.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
        expect(await translated.getByRole('button', { name: '安装', exact: true }).isVisible()).toBe(true)
        expect(await translated.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        if (webSnapshotMode() === 'refresh') {
          await translated.screenshot({
            path: fileURLToPath(new URL(`../../../.artifacts/market-upload-empty-zh-${width}-${colorScheme}.png`, import.meta.url)),
            animations: 'disabled',
          })
        }
      }
    }
  } finally { await chinese.close() }
  await assertFixtureInventory(EXPECTED_DIR, ['conflict.expected.md', 'detail.expected.md', 'installed.expected.md', 'invalid.expected.md', 'menu.expected.md', 'picker.expected.md'])
})
