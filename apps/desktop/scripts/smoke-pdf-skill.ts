/** Verify the bundled PDF skill edits, reads and renders a PDF from its relocated resource with the bundled Python. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/** Text stamped on the fixture page and expected back from the reader, with no characters Markdown escapes. */
const MARKER = 'PdfSkillReady'

/**
 * Write a blank page with the vendored pypdf, stamp a marker on it through the pdfcpu wrapper, read the marker
 * back with `pdf_read.py`, and render the page with `lit.py`. The scripts run with `-I` only, as the skill
 * instructs, and the check fails if any of them wrote bytecode into the skill directory. The temp folder is a
 * fresh directory, so the wrapper also creates its pdfcpu settings there. Needs no network access or LLM key.
 * @param skill - Skill directory holding `scripts/`, `vendor/` and `bin/`.
 * @param python - Python interpreter of the bundled primary runtime.
 */
export function smokePdfSkill(skill: string, python: string): void {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-pdf-skill-smoke-'))
  try {
    const env = { ...scrubWindowsSigningEnvironment(process.env), TEMP: temporary, TMP: temporary }
    const run = (args: string[]): string => execFileSync(python, args, { cwd: temporary, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const script = (name: string, ...args: string[]): string => run(['-I', join(skill, 'scripts', name), ...args])
    run(['-I', '-B', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); from pypdf import PdfWriter; w = PdfWriter(); w.add_blank_page(595, 842); w.write(sys.argv[2])',
      join(skill, 'vendor'), 'blank.pdf'])
    script('pdfcpu.py', 'stamp', 'add', '--mode', 'text', '--', MARKER, 'fontname:Helvetica, points:24, rot:0', 'blank.pdf', 'stamped.pdf')
    const page = script('pdf_read.py', 'stamped.pdf', '--print')
    if (!page.includes(MARKER)) throw new Error(`PDF skill smoke: pdf_read.py did not return the stamped text: ${page}`)
    script('lit.py', 'screenshot', 'stamped.pdf', '--target-pages', '1', '--dpi', '50', '-o', 'shots')
    if (!existsSync(join(temporary, 'shots', 'page_1.png'))) throw new Error('PDF skill smoke: lit.py screenshot wrote no page_1.png')
    const bytecode = readdirSync(skill, { recursive: true, encoding: 'utf8' }).filter(path => path.endsWith('__pycache__'))
    if (bytecode.length > 0) throw new Error(`PDF skill smoke: the scripts wrote bytecode into the skill: ${bytecode.join(', ')}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
