import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchCdsrc } from '../../src/steps/04-patch-cdsrc.js'
import { writeExtras } from '../../src/steps/06-write-extras.js'
import { writeStubs } from '../../src/steps/08-write-stubs.js'

const directories = []

async function project() {
  const directory = await mkdtemp(join(tmpdir(), 'capx-phase4-'))
  directories.push(directory)
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'bookshop', scripts: { start: 'cds-serve' }, keep: true }, null, 2),
  )
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) =>
        import('node:fs/promises').then(({ rm }) =>
          rm(directory, { recursive: true, force: true }),
        ),
      ),
  )
})

describe('Phase 4 patches', () => {
  it('deep-merges required profiles while preserving generated CDS configuration', async () => {
    const directory = await project()
    await writeFile(
      join(directory, '.cdsrc.json'),
      JSON.stringify(
        {
          requires: { db: { kind: 'sqlite', model: ['db'] }, audit: { kind: 'audit-log' } },
          feature: true,
        },
        null,
        2,
      ),
    )

    await patchCdsrc(directory, {
      devDb: 'postgres',
      prodDb: 'hana',
      auth: 'xsuaa',
      name: 'bookshop',
    })

    await expect(readFile(join(directory, '.cdsrc.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          requires: {
            db: {
              kind: 'sqlite',
              model: ['db'],
              '[development]': { kind: 'postgres' },
              '[production]': { kind: 'hana' },
            },
            audit: { kind: 'audit-log' },
            auth: { '[development]': { kind: 'mocked' }, kind: 'xsuaa' },
          },
          feature: true,
          '[development]': { requires: { queue: false } },
        },
        null,
        2,
      )}\n`,
    )
  })

  it('configures a persistent SQLite development database using the literal project name', async () => {
    const directory = await project()

    await patchCdsrc(directory, {
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      name: 'watch-project',
    })

    const cdsrc = JSON.parse(await readFile(join(directory, '.cdsrc.json'), 'utf8'))
    expect(cdsrc.requires.db['[development]']).toEqual({
      kind: 'sqlite',
      credentials: { database: 'watch-project.sqlite' },
    })
    expect(cdsrc.requires.db['[production]']).toEqual({ kind: 'hana' })
  })

  it('disables CAP event queues only for development', async () => {
    const directory = await project()

    await patchCdsrc(directory, {
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      name: 'watch-project',
    })

    const cdsrc = JSON.parse(await readFile(join(directory, '.cdsrc.json'), 'utf8'))
    expect(cdsrc['[development]'].requires.queue).toBe(false)
    expect(cdsrc['[production]']).toBeUndefined()
  })

  it('adds only missing Admin and User XSUAA declarations', async () => {
    const directory = await project()
    await writeFile(
      join(directory, 'xs-security.json'),
      JSON.stringify(
        { xsappname: 'existing', scopes: [{ name: '$XSAPPNAME.Existing' }], custom: true },
        null,
        2,
      ),
    )

    await patchCdsrc(directory, {
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'xsuaa',
      name: 'bookshop',
    })
    await patchCdsrc(directory, {
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'xsuaa',
      name: 'bookshop',
    })

    const security = JSON.parse(await readFile(join(directory, 'xs-security.json'), 'utf8'))
    expect(security.custom).toBe(true)
    expect(security.scopes.map(({ name }) => name)).toEqual([
      '$XSAPPNAME.Existing',
      '$XSAPPNAME.Admin',
      '$XSAPPNAME.User',
    ])
    expect(security['role-templates'].map(({ name }) => name)).toEqual(['Admin', 'User'])
    expect(security['role-collections'].map(({ name }) => name)).toEqual(['Admin', 'User'])
  })

  it('writes missing CAP scripts, Prettier, and only nonredundant capx ignore entries', async () => {
    const directory = await project()
    await writeFile(
      join(directory, '.gitignore'),
      'node_modules/\ngen/\nmta_archives/\n*.mtar\n.cdsrc-private.json\n.env\n',
    )

    await writeExtras(directory, {
      name: 'bookshop',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.keep).toBe(true)
    expect(packageJson.scripts).toMatchObject({
      start: 'cds-serve',
      watch: 'cds watch',
      build: 'cds build',
      lint: 'cds lint',
      test: 'node --test',
      format: 'prettier --write "**/*.{js,ts,cds,json,md,yaml,yml}"',
    })
    expect(packageJson.devDependencies.prettier).toBe('^3')
    const gitignore = await readFile(join(directory, '.gitignore'), 'utf8')
    expect(gitignore.match(/^\.env$/gm)).toHaveLength(1)
    expect(gitignore).toContain('dist/')
    expect(gitignore.match(/^\.cdsrc-private\.json$/gm)).toHaveLength(1)
    expect(gitignore).toContain('gen/')
    expect(gitignore).toContain('mta_archives/')
    expect(gitignore).toContain('*.mtar')
    expect(gitignore).not.toContain('# capx')
    expect(gitignore).not.toContain('.DS_Store')
    await expect(readFile(join(directory, '.prettierrc'), 'utf8')).resolves.toContain(
      '"printWidth": 100',
    )
    await expect(readFile(join(directory, '.editorconfig'), 'utf8')).resolves.toContain(
      'root = true',
    )
    await expect(readFile(join(directory, 'README.md'), 'utf8')).resolves.toContain('# bookshop')
  })

  it('adds PostgreSQL scripts only when explicitly requested by the execution plan', async () => {
    const directory = await project()

    await writeExtras(directory, {
      name: 'bookshop',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      postgresDev: true,
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.scripts).toMatchObject({
      'db:up': 'docker compose up -d',
      'db:down': 'docker compose down',
    })
    await expect(readFile(join(directory, 'docker-compose.yml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('writes an ESM service and Node test fallback only when CDS generated no test', async () => {
    const directory = await project()

    await writeStubs(directory, { name: 'bookshop', lang: 'js' })

    await expect(readFile(join(directory, 'db', 'schema.cds'), 'utf8')).resolves.toContain(
      'namespace bookshop;',
    )
    await expect(readFile(join(directory, 'srv', 'cat-service.js'), 'utf8')).resolves.toContain(
      "import cds from '@sap/cds'",
    )
    await expect(readFile(join(directory, 'test', 'smoke.test.js'), 'utf8')).resolves.toContain(
      "cds.test(import.meta.dirname + '/..')",
    )
    await expect(readFile(join(directory, 'test', 'smoke.test.js'), 'utf8')).resolves.toContain(
      'assert.ok(cds.server)',
    )
    await writeFile(join(directory, 'test', 'generated.test.js'), 'test generated')
    await writeStubs(directory, { name: 'bookshop', lang: 'ts' })
    await expect(readFile(join(directory, 'test', 'smoke.test.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('uses a JavaScript fallback smoke test for a TypeScript handler', async () => {
    const directory = await project()

    await writeStubs(directory, { name: 'bookshop', lang: 'ts' })

    await expect(readFile(join(directory, 'srv', 'cat-service.ts'), 'utf8')).resolves.toContain(
      "import cds from '@sap/cds'",
    )
    await expect(readFile(join(directory, 'test', 'smoke.test.js'), 'utf8')).resolves.toContain(
      "cds.test(import.meta.dirname + '/..')",
    )
    await expect(readFile(join(directory, 'test', 'smoke.test.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('adds CAP type declarations for a TypeScript project', async () => {
    const directory = await project()
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, types: ['node'] } }, null, 2),
    )

    await writeExtras(directory, {
      name: 'bookshop',
      lang: 'ts',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'xsuaa',
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies['@cap-js/cds-types']).toBe('^0.18.0')
    const tsconfig = JSON.parse(await readFile(join(directory, 'tsconfig.json'), 'utf8'))
    expect(tsconfig.compilerOptions).toMatchObject({ strict: true })
    expect(tsconfig.compilerOptions.types).toEqual(['node', '@cap-js/cds-types'])
  })

  it('adds cds-test for the fallback smoke test', async () => {
    const directory = await project()

    const needsCdsTest = await writeStubs(directory, { name: 'bookshop', lang: 'js' })
    await writeExtras(directory, {
      name: 'bookshop',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      needsCdsTest,
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies['@cap-js/cds-test']).toBe('^1')
  })

  it('preserves a configured cds-test version for the fallback smoke test', async () => {
    const directory = await project()
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ devDependencies: { '@cap-js/cds-test': '^9' } }, null, 2),
    )

    const needsCdsTest = await writeStubs(directory, { name: 'bookshop', lang: 'js' })
    await writeExtras(directory, {
      name: 'bookshop',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      needsCdsTest,
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies['@cap-js/cds-test']).toBe('^9')
  })

  it('does not add cds-test when CDS generated a test', async () => {
    const directory = await project()
    await mkdir(join(directory, 'test'))
    await writeFile(join(directory, 'test', 'generated.test.js'), 'test generated')

    const needsCdsTest = await writeStubs(directory, { name: 'bookshop', lang: 'js' })
    await writeExtras(directory, {
      name: 'bookshop',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'none',
      needsCdsTest,
    })

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies?.['@cap-js/cds-test']).toBeUndefined()
  })

  it('normalizes a permitted hyphenated project name for the CDS namespace', async () => {
    const directory = await project()

    await writeStubs(directory, { name: 'watch-project', lang: 'js' })

    await expect(readFile(join(directory, 'db', 'schema.cds'), 'utf8')).resolves.toContain(
      'namespace watch_project;',
    )
  })
})
