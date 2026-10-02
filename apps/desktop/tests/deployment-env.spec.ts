import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEPLOYMENT_ENV_FILENAME, readDeploymentEnvironment, SECRETS_ENV_FILENAME } from '../src/deployment-env.ts'
import { prepareDeploymentEnvironment } from '../scripts/deployment-env.mjs'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-deployment-env-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Desktop deployment environment loading', () => {
  it('reads only allowed values from the development dotenv file', () => {
    const root = temporaryRoot()
    writeFileSync(join(root, SECRETS_ENV_FILENAME), 'FEISHU_APP_SECRET=fixture-feishu\nLONGCHEER_API_KEY=fixture-longcheer\nUNRELATED=ignored\n')
    expect(readDeploymentEnvironment({ packaged: false, repositoryRoot: root, resourcesPath: root })).toEqual({
      FEISHU_APP_SECRET: 'fixture-feishu', LONGCHEER_API_KEY: 'fixture-longcheer',
    })
  })

  it('reads the packaged JSON resource and returns no values when it is absent', () => {
    const root = temporaryRoot()
    writeFileSync(join(root, DEPLOYMENT_ENV_FILENAME), JSON.stringify({ FEISHU_APP_SECRET: 'fixture-feishu', LONGCHEER_API_KEY: 'fixture-longcheer', UNRELATED: 'ignored' }))
    expect(readDeploymentEnvironment({ packaged: true, repositoryRoot: root, resourcesPath: root })).toEqual({
      FEISHU_APP_SECRET: 'fixture-feishu', LONGCHEER_API_KEY: 'fixture-longcheer',
    })
    rmSync(join(root, DEPLOYMENT_ENV_FILENAME))
    expect(readDeploymentEnvironment({ packaged: true, repositoryRoot: root, resourcesPath: root })).toEqual({})
  })
})

describe('Desktop deployment environment packaging', () => {
  it('writes an allowed JSON resource and removes stale output when the source is absent', () => {
    const root = temporaryRoot()
    const source = join(root, SECRETS_ENV_FILENAME)
    const target = join(root, 'generated', DEPLOYMENT_ENV_FILENAME)
    writeFileSync(source, 'FEISHU_APP_SECRET=fixture-feishu\nLONGCHEER_API_KEY=fixture-longcheer\nUNRELATED=ignored\n')
    expect(prepareDeploymentEnvironment({ source, target })).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ FEISHU_APP_SECRET: 'fixture-feishu', LONGCHEER_API_KEY: 'fixture-longcheer' })

    rmSync(source)
    expect(prepareDeploymentEnvironment({ source, target })).toBe(false)
    expect(existsSync(target)).toBe(false)
  })
})
