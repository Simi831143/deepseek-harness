/** Assemble the Windows PDF skill from its repository source and checksum-locked LiteParse, pypdf and pdfcpu releases. */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import extractZip from 'extract-zip'
import { downloadPrimaryRuntimeAsset } from '../../../scripts/primary-runtime/prepare.ts'
import { BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY, recordBundledSkill } from './bundled-content.mjs'
import lock from './pdf-skill-lock.json' with { type: 'json' }
import { replacePreparedDirectory } from './prepared-directory.ts'

/** Skill name, which is also its directory name in the repository source and in the bundled content. */
export const PDF_SKILL = 'pdf'

/** Repository-relative skill source holding `SKILL.md`, `scripts/`, `licenses/` and the pdfcpu settings. */
const SOURCE = 'apps/desktop/skills/pdf'

/**
 * Copy the skill source to `runtime/bundled/skills/pdf`, unpack the locked wheels into its `vendor/` and the
 * locked pdfcpu executable into `bin/win-x64/`, and record the skill in the bundled-content manifest.
 * Runs after `prepareBundledContent`, which replaces the bundled content directory. Nothing unpacked here is
 * executed; the packaged-runtime smoke runs the skill after signed builds sign it.
 * @param runtimeDir - Desktop runtime resource directory.
 * @param target - Desktop build target; only `win-x64` carries the skill.
 * @param downloads - Download cache directory.
 * @returns Resolves after the complete skill replaces any earlier copy; other targets carry no PDF skill.
 */
export async function preparePdfSkill(runtimeDir: string, target: string, downloads: string): Promise<void> {
  if (target !== 'win-x64') return
  const staging = mkdtempSync(join(runtimeDir, '.pdf-skill-'))
  try {
    cpSync(join(import.meta.dirname, '..', '..', '..', ...SOURCE.split('/')), staging, {
      recursive: true, filter: entry => basename(entry) !== '__pycache__' && !entry.endsWith('.pyc'),
    })
    for (const wheel of lock.wheels) {
      const archive = await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, downloads)
      // The scripts import from vendor/, and pdf_read.py reads LiteParse's version from its distribution metadata.
      await extractZip(archive, { dir: join(staging, 'vendor') })
    }
    const archive = await downloadPrimaryRuntimeAsset(lock.pdfcpu.url, lock.pdfcpu.sha256, downloads)
    const extracted = join(staging, '.archive')
    await extractZip(archive, { dir: extracted })
    mkdirSync(join(staging, 'bin', 'win-x64'), { recursive: true })
    cpSync(join(extracted, lock.pdfcpu.directory, 'pdfcpu.exe'), join(staging, 'bin', 'win-x64', 'pdfcpu.exe'))
    rmSync(extracted, { recursive: true, force: true })
    const skills = join(runtimeDir, BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY)
    const destination = join(skills, PDF_SKILL)
    mkdirSync(skills, { recursive: true })
    rmSync(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await replacePreparedDirectory(staging, destination, 'PDF skill')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  recordBundledSkill(runtimeDir, {
    name: PDF_SKILL,
    path: SOURCE,
    payload: { ...Object.fromEntries(lock.wheels.map(wheel => [wheel.name, wheel.version])), pdfcpu: lock.pdfcpu.version },
  })
}
