import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))
const cds = process.env.CAPX_REAL_CDS_DK_10
// Keep npm's version probe isolated while letting cds use the real npm implementation.
const npm = process.env.CAPX_REAL_NPM ?? join(process.execPath, '..', 'npm')
const required = process.env.CAPX_REQUIRE_REAL_CDS_WATCH === '1'
const suite = cds ? describe : required ? describe : describe.skip
let binDirectory
let workspace

function runNew(name = 'watch-project', language = 'js') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'new', name], {
      cwd: workspace,
      env: {
        ...process.env,
        CAPX_REAL_CDS_DK_10: cds,
        CAPX_REAL_NPM: npm,
        PATH: `${binDirectory}:${process.env.PATH}`,
      },
    })
    const prompts = [
      ['Backend language?', language === 'ts' ? '\x1b[B\r' : '\r'],
      ['Database for local development?', '\r'],
      ['Database for production?', '\r'],
      ['Authentication?', '\x1b[A\r'],
      ['Frontend framework?', '\r'],
      ['Proceed?', '\r'],
    ]
    let output = ''
    let answer = 0
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx new did not finish: ${output}`))
    }, 60000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (!output.includes(prompts[answer]?.[0])) return
      child.stdin.write(prompts[answer][1])
      answer += 1
      if (answer === prompts.length) child.stdin.end()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`capx new exited with ${code}: ${output}`))
    })
  })
}

async function watchUntilListening(project) {
  const subprocess = execa(npm, ['run', 'watch'], { cwd: project, all: true, detached: true })
  try {
    await new Promise((resolve, reject) => {
      let watchOutput = ''
      const timeout = setTimeout(
        () => reject(new Error(`cds watch did not start: ${watchOutput}`)),
        30000,
      )
      subprocess.all.on('data', (chunk) => {
        watchOutput += chunk
        if (!/server listening|listening on/i.test(watchOutput)) return
        clearTimeout(timeout)
        resolve()
      })
      subprocess.catch(reject)
    })
  } finally {
    process.kill(-subprocess.pid, 'SIGTERM')
    await subprocess.catch(() => undefined)
  }
}

suite('real CAP 10 watch', () => {
  beforeAll(async () => {
    binDirectory = await mkdtemp(join(tmpdir(), 'capx-watch-bin-'))
    workspace = await mkdtemp(join(tmpdir(), 'capx-watch-workspace-'))
    await Promise.all(
      [
        [
          'npm',
          'if [ "$1" = "--version" ]; then printf "10.0.0"; else exec "$CAPX_REAL_NPM" "$@"; fi',
        ],
        ['git', 'printf "git version 2.0.0"'],
        ['cds', 'exec "$CAPX_REAL_CDS_DK_10" "$@"'],
        ['mbt', 'printf "mbt 1.0.0"'],
        [
          'cf',
          'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
        ],
      ].map(async ([name, body]) => {
        const path = join(binDirectory, name)
        await writeFile(path, `#!/bin/sh\n${body}\n`)
        await chmod(path, 0o755)
      }),
    )
  })

  afterAll(async () => {
    await Promise.all([
      rm(binDirectory, { force: true, recursive: true }),
      rm(workspace, { force: true, recursive: true }),
    ])
  })

  it('generates a project through capx new and starts cds watch', async () => {
    const { stdout } = await execa(cds, ['--version'])
    expect(stdout).toMatch(/@sap\/cds-dk(?:\s+\([^)]*\))?\s*:?\s*10\./)

    await runNew()
    const packageJson = JSON.parse(
      await readFile(join(workspace, 'watch-project', 'package.json'), 'utf8'),
    )
    expect(packageJson.type).toBe('module')
    expect(packageJson.dependencies['@sap/cds']).toBe('^10')
    expect(packageJson.devDependencies['@sap/cds-dk']).toBe('^10')
    expect(packageJson.devDependencies['@cap-js/cds-test']).toBe('^1')
    const cdsrc = JSON.parse(
      await readFile(join(workspace, 'watch-project', '.cdsrc.json'), 'utf8'),
    )
    expect(cdsrc.requires.db['[development]']).toEqual({
      kind: 'sqlite',
      credentials: { database: 'watch-project.sqlite' },
    })
    await expect(
      readFile(join(workspace, 'watch-project', 'srv', 'cat-service.cds'), 'utf8'),
    ).resolves.toContain('service CatService')

    await execa(npm, ['install'], { cwd: join(workspace, 'watch-project') })
    await execa(npm, ['test'], { cwd: join(workspace, 'watch-project') })

    await watchUntilListening(join(workspace, 'watch-project'))
  }, 95000)

  it('generates a TypeScript project with a JavaScript smoke test and starts cds watch', async () => {
    await runNew('typescript-watch-project', 'ts')
    const project = join(workspace, 'typescript-watch-project')
    const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    const cdsrc = JSON.parse(await readFile(join(project, '.cdsrc.json'), 'utf8'))

    expect(packageJson.devDependencies.typescript).toBeDefined()
    expect(cdsrc.requires.db['[development]']).toEqual({
      kind: 'sqlite',
      credentials: { database: 'typescript-watch-project.sqlite' },
    })
    await expect(readFile(join(project, 'srv', 'cat-service.ts'), 'utf8')).resolves.toContain(
      "import cds from '@sap/cds'",
    )
    await expect(readFile(join(project, 'test', 'smoke.test.js'), 'utf8')).resolves.toContain(
      "cds.test(import.meta.dirname + '/..')",
    )

    await execa(npm, ['install'], { cwd: project })
    await execa(npm, ['test'], { cwd: project })

    await watchUntilListening(project)
  }, 95000)
})
