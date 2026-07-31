import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateTarget } from '../../src/steps/01-validate-target.js'

const targets = []

afterEach(async () => {
  await Promise.all(
    targets
      .splice(0)
      .map((target) =>
        import('node:fs/promises').then(({ rm }) => rm(target, { force: true, recursive: true })),
      ),
  )
})

describe('validateTarget', () => {
  it('allows a target directory that does not exist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'capx-target-'))
    const target = join(parent, 'new-project')
    targets.push(parent)

    await expect(validateTarget(target)).resolves.toBeUndefined()
  })

  it('rejects an existing target without force', async () => {
    const target = await mkdtemp(join(tmpdir(), 'capx-target-'))
    targets.push(target)

    await expect(validateTarget(target)).rejects.toThrow(
      'Directory exists. Use --force to overwrite.',
    )
  })

  it('rejects a dangling symbolic-link target without force', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'capx-target-'))
    const target = join(parent, 'project')
    targets.push(parent)
    await symlink(join(parent, 'missing'), target)

    await expect(validateTarget(target)).rejects.toThrow(
      'Directory exists. Use --force to overwrite.',
    )
  })

  it('removes a dangling symbolic-link target with force', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'capx-target-'))
    const target = join(parent, 'project')
    targets.push(parent)
    await symlink(join(parent, 'missing'), target)

    await expect(validateTarget(target, { force: true })).resolves.toBeUndefined()
    await expect(import('node:fs/promises').then(({ lstat }) => lstat(target))).rejects.toThrow()
  })

  it('removes an existing target with force', async () => {
    const target = await mkdtemp(join(tmpdir(), 'capx-target-'))
    await mkdir(join(target, 'nested'))
    await writeFile(join(target, 'nested', 'file.txt'), 'content')

    await expect(validateTarget(target, { force: true })).resolves.toBeUndefined()
    await expect(import('node:fs/promises').then(({ access }) => access(target))).rejects.toThrow()
  })
})
