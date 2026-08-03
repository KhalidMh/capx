import { execa } from 'execa'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('npm package contents', () => {
  it('contains only the public installer surface', async () => {
    const { stdout } = await execa('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'])
    const [{ files }] = JSON.parse(stdout)
    const paths = files.map(({ path }) => path)

    expect(paths).toEqual(
      expect.arrayContaining([
        'CHANGELOG.md',
        'LICENSE',
        'README.md',
        'bin/capx.js',
        'package.json',
        'src/templates/README.md.tmpl',
      ]),
    )
    expect(paths).not.toContain('package-lock.json')
    expect(paths).not.toContain('database.sqlite')
    expect(paths).not.toContain('capx-plan.md')
    expect(paths).not.toContain('capx-plan-v2.md')
    expect(paths.some((path) => path.startsWith('docs/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('test/'))).toBe(false)
  })

  it('ignores the local release-audit SQLite artifact without deleting it', async () => {
    await expect(readFile('.gitignore', 'utf8')).resolves.toContain('database.sqlite')
  })
})
