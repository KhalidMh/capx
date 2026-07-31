import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))
let binDirectory
let workspace
let cdsInvocationFile

beforeAll(async () => {
  binDirectory = await mkdtemp(join(tmpdir(), 'capx-bin-'))
  workspace = await mkdtemp(join(tmpdir(), 'capx-workspace-'))
  cdsInvocationFile = join(workspace, 'cds-invocation')
  await Promise.all(
    [
      ['npm', 'printf 10.0.0'],
      ['git', 'printf "git version 2.0.0"'],
      [
        'cds',
        `if [ "$1" = "--version" ]; then
  printf "@sap/cds-dk: 10.0.0"
elif [ "$1" = "init" ]; then
  if [ -n "$CAPX_EXPECTED_CDS_NAME" ] && { [ "$#" -ne 5 ] || [ "$2" != "$CAPX_EXPECTED_CDS_NAME" ] || [ "$3" != "--nodejs" ] || [ "$4" != "--add" ] || [ "$5" != "$CAPX_EXPECTED_CDS_FACETS" ]; }; then
    exit 1
  fi
  printf '%s\n' "$@" > "$CAPX_CDS_INVOCATION_FILE"
  mkdir "$2"
  printf '{"name":"%s","type":"module","dependencies":{"@sap/cds":"^10.0.0"}}' "$2" > "$2/package.json"
else
  exit 1
fi`,
      ],
      ['mbt', 'printf "mbt 1.0.0"'],
      [
        'cf',
        'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
      ],
      ['docker', 'printf "Docker version 1.0.0"'],
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

function runCli(args, onOutput, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...env,
        CAPX_CDS_INVOCATION_FILE: cdsInvocationFile,
        PATH: `${binDirectory}:${process.env.PATH}`,
      },
    })
    let output = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx did not finish: ${output}`))
    }, 3000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      onOutput(child, output)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, output })
    })
  })
}

function runNew(name, { force = false, validateCds = false } = {}) {
  const args = [cli, 'new', name]
  if (force) args.push('--force')
  return runPromptedNew(
    args,
    [
      ['Backend language?', '\r'],
      ['Database for local development?', '\r'],
      ['Database for production?', '\r'],
      ['Authentication?', '\x1b[A\r'],
      ['Frontend framework?', '\r'],
      ['Proceed?', '\r'],
    ],
    validateCds
      ? { CAPX_EXPECTED_CDS_NAME: name, CAPX_EXPECTED_CDS_FACETS: 'sqlite,hana,mta,test,lint' }
      : {},
  )
}

function runPromptedNew(args, answers, env = {}) {
  let answer = 0
  return runCli(
    args,
    (child, output) => {
      if (!output.includes(answers[answer]?.[0])) return
      child.stdin.write(answers[answer][1])
      answer += 1
      if (answer === answers.length) child.stdin.end()
    },
    env,
  )
}

describe('capx new Phase 3', () => {
  it('rejects an invalid positional project name before prompting', async () => {
    const result = await runCli([cli, 'new', '../invalid'], () => {})

    expect(result.code).toBe(1)
    expect(result.output).toContain('Must start with alphanumeric or _')
    expect(result.output).not.toContain('Backend language?')
  })

  it('prompts for a missing project name', async () => {
    const result = await runPromptedNew(
      [cli, 'new'],
      [
        ['Project name?', 'prompted-app\r'],
        ['Backend language?', '\r'],
        ['Database for local development?', '\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\x1b[A\r'],
        ['Frontend framework?', '\r'],
        ['Proceed?', '\r'],
      ],
    )

    expect(result.code).toBe(0)
    await expect(
      readFile(join(workspace, 'prompted-app', 'package.json'), 'utf8'),
    ).resolves.toContain('"type": "module"')
  })

  it('initializes a minimal CAP 10 ESM project through cds', async () => {
    const result = await runNew('test-minimal', { validateCds: true })

    expect(result.code).toBe(0)
    const packageJson = JSON.parse(
      await readFile(join(workspace, 'test-minimal', 'package.json'), 'utf8'),
    )
    expect(packageJson.dependencies['@sap/cds']).toMatch(/^\^10\./)
    expect(packageJson.type).toBe('module')
    expect(packageJson.scripts).toMatchObject({
      watch: 'cds watch',
      build: 'cds build',
      lint: 'cds lint',
      test: 'node --test',
    })
    await expect(
      readFile(join(workspace, 'test-minimal', '.cdsrc.json'), 'utf8'),
    ).resolves.toContain('"[development]"')
    await expect(
      readFile(join(workspace, 'test-minimal', 'db', 'schema.cds'), 'utf8'),
    ).resolves.toContain('namespace test_minimal;')
    await expect(
      readFile(join(workspace, 'test-minimal', 'srv', 'cat-service.cds'), 'utf8'),
    ).resolves.toContain('service CatService')
    await expect(readFile(cdsInvocationFile, 'utf8')).resolves.toBe(
      'init\ntest-minimal\n--nodejs\n--add\nsqlite,hana,mta,test,lint\n',
    )
  })

  it('refuses to overwrite an existing target without --force', async () => {
    const result = await runNew('test-minimal')

    expect(result.code).toBe(1)
    expect(result.output).toContain('Directory exists. Use --force to overwrite.')
  })

  it('replaces an existing target with --force', async () => {
    const result = await runNew('test-minimal', { force: true })

    expect(result.code).toBe(0)
    await expect(
      readFile(join(workspace, 'test-minimal', 'package.json'), 'utf8'),
    ).resolves.toContain('"type": "module"')
  })

  it('shows the selected configuration summary before Proceed', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'summary-app'],
      [
        ['Backend language?', '\x1b[B\r'],
        ['Database for local development?', '\x1b[B\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\r'],
        ['Frontend framework?', '\x1b[B\r'],
        ['Proceed?', '\r'],
      ],
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain('• Backend:     TypeScript')
    expect(result.output).toContain('• Dev DB:      PostgreSQL (Docker)')
    expect(result.output).toContain('• Prod DB:     SAP HANA Cloud')
    expect(result.output).toContain('• Auth:        XSUAA (mocked in dev)')
    expect(result.output).toContain('• Frontend:    Vue (Vite) → app/frontend')
    expect(result.output).toContain('• Approuter:   Yes (auto)')
    expect(result.output).toContain('• Deployment:  MTA → Cloud Foundry')
    expect(result.output.indexOf('• Backend:')).toBeLessThan(result.output.indexOf('Proceed?'))
  })

  it('exits 1 with Cancelled when a prompt is cancelled', async () => {
    const result = await runCli([cli, 'new', 'cancelled-app'], (child, output) => {
      if (output.includes('Backend language?')) child.stdin.write('\u001b')
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cancelled')
  })
})
