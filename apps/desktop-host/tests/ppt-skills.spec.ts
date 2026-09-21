import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { expect, it } from 'vitest'
import { PAYLOAD_DIRECTORY, SKILL_ENTRY } from '../src/ppt-payload.ts'
import * as desktopPptSkills from '../src/ppt-skills.ts'

const BODY = '# PPT Master\n\nRouted presentation workflow.'
const SKILL = `---\nname: ${SKILL_ENTRY}\ndescription: Presentation workflow for PPTX decks.\n---\n\n${BODY}\n`

/**
 * Build a runtime tree for one case.
 * @param withSkill - Whether the build carried the optional skill payload.
 * @returns the temporary root holding the runtime the Host receives.
 */
async function scaffold(withSkill: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-ppt-skills-'))
  if (withSkill) {
    const directory = join(root, 'runtime', PAYLOAD_DIRECTORY, SKILL_ENTRY)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), SKILL)
  }
  return root
}

/** The sibling runtime directory the Host is started with. */
function bundledSource(root: string): string {
  return join(root, 'runtime', 'primary-runtime')
}

it('publishes the bundled presentation skill and removes it on disposal', async () => {
  const root = await scaffold(true)
  const ctx = new Context()
  try {
    expect('default' in desktopPptSkills).toBe(false)
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(desktopPptSkills, { source: bundledSource(root) })
    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => skill.name)).toEqual([SKILL_ENTRY])
    expect(catalog[0]).toMatchObject({ source: 'bundled', invocation: { modelInvocable: true, userInvocable: true } })
    const loaded = await ctx.skills.get(SKILL_ENTRY)
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'runtime', PAYLOAD_DIRECTORY, SKILL_ENTRY) })
    expect(loaded?.content).toBe(BODY)
    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('leaves the skill out of the catalog when the optional payload is absent', async () => {
  const root = await scaffold(false)
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(desktopPptSkills, { source: bundledSource(root) })
    expect(await ctx.skills.list()).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
