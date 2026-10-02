import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { expect, it } from 'vitest'
import * as desktopBundledSkills from '../src/bundled-skills.ts'

const { BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY } = desktopBundledSkills

/**
 * Build a runtime tree for one case.
 * @param skills - Skill directory names the build carried; undefined means no skill payload at all.
 * @returns the temporary root holding the runtime the Host receives.
 */
async function scaffold(skills: readonly string[] | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-bundled-skills-'))
  await mkdir(join(root, 'runtime', 'primary-runtime'), { recursive: true })
  if (skills !== undefined) {
    await mkdir(join(root, 'runtime', BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY), { recursive: true })
    for (const skill of skills) {
      const directory = join(root, 'runtime', BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY, skill)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), `---\nname: ${skill}\ndescription: ${skill} workflow.\n---\n\n# ${skill}\n`)
    }
  }
  return root
}

/** The sibling runtime directory the Host is started with. */
function bundledSource(root: string): string {
  return join(root, 'runtime', 'primary-runtime')
}

it('publishes every bundled skill from one provider and removes them on disposal', async () => {
  const root = await scaffold(['ppt-master', 'writing-plans'])
  const ctx = new Context()
  try {
    expect('default' in desktopBundledSkills).toBe(false)
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(desktopBundledSkills, { source: bundledSource(root) })
    const catalog = await ctx.skills.list()
    expect(catalog.map(skill => skill.name)).toEqual(['ppt-master', 'writing-plans'])
    for (const skill of catalog) {
      expect(skill).toMatchObject({ source: 'bundled', provider: 'desktop-bundled', invocation: { modelInvocable: true, userInvocable: true } })
    }
    const loaded = await ctx.skills.get('ppt-master')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'runtime', BUNDLED_CONTENT_DIRECTORY, BUNDLED_SKILL_DIRECTORY, 'ppt-master') })
    expect(loaded?.content).toBe('# ppt-master')
    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('lets a same-named local skill take precedence over the bundled one', async () => {
  const root = await scaffold(['ppt-master'])
  const custom = join(root, 'custom')
  await mkdir(join(custom, 'ppt-master'), { recursive: true })
  await writeFile(join(custom, 'ppt-master', 'SKILL.md'), '---\nname: ppt-master\ndescription: Local override.\n---\n\n# local\n')
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    // Registered first, so only rank, not provider order, can let the local skill win.
    await ctx.plugin(desktopBundledSkills, { source: bundledSource(root) })
    await ctx.plugin(skillFilesystem, { providerName: 'local', includeDefaultRoots: false, customSkillDirs: [custom], watch: false })
    expect(await ctx.skills.get('ppt-master')).toMatchObject({ provider: 'local', content: '# local' })
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('starts without bundled skills when the payload carries none', async () => {
  const root = await scaffold(undefined)
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(desktopBundledSkills, { source: bundledSource(root) })
    expect(await ctx.skills.list()).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
