import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))
let binDirectory
let workspace
let cdsInvocationFile
let cdsCallsFile

beforeAll(async () => {
  binDirectory = await mkdtemp(join(tmpdir(), 'capx-bin-'))
  workspace = await mkdtemp(join(tmpdir(), 'capx-workspace-'))
  cdsInvocationFile = join(workspace, 'cds-invocation')
  cdsCallsFile = join(workspace, 'cds-calls')
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
  printf 'init %s\n' "$*" >> "$CAPX_CDS_CALLS_FILE"
  mkdir "$2"
  printf '{"name":"%s","type":"module","dependencies":{"@sap/cds":"^10.0.0"}}' "$2" > "$2/package.json"
  if printf '%s' "$5" | grep -q hana; then
    printf 'modules:\n  - name: generated-srv\n    type: nodejs\n    path: gen/srv\n    requires:\n      - name: generated-db\n  - name: generated-db-deployer\n    type: hdb\n    path: gen/db\n    requires:\n      - name: generated-db\n' > "$2/mta.yaml"
  else
    printf 'modules:\n  - name: generated-srv\n    type: nodejs\n    path: gen/srv\n' > "$2/mta.yaml"
  fi
  if printf '%s' "$5" | grep -q postgres; then
    printf '  - name: generated-postgres-deployer\n    type: nodejs\n    path: gen/pg\n    requires:\n      - name: generated-postgres\n' >> "$2/mta.yaml"
  fi
  if printf '%s' "$5" | grep -q approuter; then
    mkdir -p "$2/app/router"
    printf '  - name: generated-router\n    type: approuter.nodejs\n    path: app/router\n' >> "$2/mta.yaml"
  fi
  printf 'resources:\n' >> "$2/mta.yaml"
  if printf '%s' "$5" | grep -q hana; then
    printf '  - name: generated-db\n    type: com.sap.xs.hdi-container\n' >> "$2/mta.yaml"
  fi
  if printf '%s' "$5" | grep -q postgres; then
    printf '  - name: generated-postgres\n    type: org.cloudfoundry.managed-service\n    parameters:\n      service: postgresql-db\n' >> "$2/mta.yaml"
  fi
elif [ "$1" = "add" ] && { [ "$2" = "vue" ] || [ "$2" = "react" ]; } && [ "$3" = "--into" ] && [ "$4" = "frontend" ]; then
  printf 'add %s\n' "$*" >> "$CAPX_CDS_CALLS_FILE"
  mkdir -p app/frontend
  printf '{"scripts":{"build":"vite build"}}' > app/frontend/package.json
elif [ "$1" = "add" ] && [ "$2" = "html5-repo" ]; then
  printf 'add %s\n' "$*" >> "$CAPX_CDS_CALLS_FILE"
  mkdir -p app/router
  printf 'modules:\n  - name: generated-srv\n    type: nodejs\n    path: gen/srv\n  - name: generated-frontend\n    type: html5\n    path: app/frontend\n  - name: generated-router\n    type: approuter.nodejs\n    path: app/router\nresources: []\n' > mta.yaml
  printf '{"routes":[{"source":"^(.*)$","localDir":"resources"}]}' > app/router/xs-app.json
else
  exit 1
fi`,
      ],
      ['mbt', 'printf "mbt 1.0.0"'],
      [
        'cf',
        'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
      ],
      [
        'docker',
        'if [ "$1" = "--version" ]; then printf "Docker version 1.0.0"; elif [ "$1" = "compose" ] && [ "$2" = "version" ]; then printf "Docker Compose version 1.0.0"; else exit 1; fi',
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

function runCli(args, onOutput, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...env,
        CAPX_CDS_INVOCATION_FILE: cdsInvocationFile,
        CAPX_CDS_CALLS_FILE: cdsCallsFile,
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

  it('adds frontend before html5-repo and patches the generated MTA and approuter', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'frontend-app'],
      [
        ['Backend language?', '\r'],
        ['Database for local development?', '\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\r'],
        ['Frontend framework?', '\x1b[B\r'],
        ['Proceed?', '\r'],
      ],
    )

    expect(result.code).toBe(0)
    await expect(readFile(cdsCallsFile, 'utf8')).resolves.toMatch(
      /init frontend-app --nodejs --add sqlite,hana,xsuaa,approuter,destination,mta,test,lint\nadd add vue --into frontend\nadd add html5-repo\n$/,
    )
    const mta = await readFile(join(workspace, 'frontend-app', 'mta.yaml'), 'utf8')
    expect(mta).toContain('name: frontend-app-srv')
    expect(mta).toContain('name: frontend-app-frontend')
    expect(mta).toContain('name: frontend-app-approuter')
    const router = JSON.parse(
      await readFile(join(workspace, 'frontend-app', 'app', 'router', 'xs-app.json'), 'utf8'),
    )
    expect(router.routes).toContainEqual(
      expect.objectContaining({ source: '^/odata/(.*)$', destination: 'srv-api' }),
    )
    expect(router.routes).toContainEqual(
      expect.objectContaining({ source: '^(.*)$', service: 'html5-apps-repo-rt' }),
    )
  })

  it('patches the MTA for an approuter-only project without adding frontend facets', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'router-only-app'],
      [
        ['Backend language?', '\r'],
        ['Database for local development?', '\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\r'],
        ['Frontend framework?', '\r'],
        ['Proceed?', '\r'],
      ],
    )

    expect(result.code).toBe(0)
    const mta = await readFile(join(workspace, 'router-only-app', 'mta.yaml'), 'utf8')
    expect(mta).toContain('name: router-only-app-approuter')
    await expect(readFile(cdsCallsFile, 'utf8')).resolves.not.toMatch(
      /router-only-app.*add (vue|react|html5-repo)/,
    )
  })

  it('patches a backend-only PostgreSQL-development HANA-production MTA without reading router files', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'backend-hana-app'],
      [
        ['Backend language?', '\r'],
        ['Database for local development?', '\x1b[B\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\x1b[A\r'],
        ['Frontend framework?', '\r'],
        ['Proceed?', '\r'],
      ],
      {
        CAPX_EXPECTED_CDS_NAME: 'backend-hana-app',
        CAPX_EXPECTED_CDS_FACETS: 'postgres,hana,mta,test,lint',
      },
    )

    expect(result.code).toBe(0)
    const project = join(workspace, 'backend-hana-app')
    const mta = await readFile(join(project, 'mta.yaml'), 'utf8')
    expect(mta).toContain('name: backend-hana-app-db-deployer')
    expect(mta).toContain('name: backend-hana-app-db')
    expect(mta).not.toContain('gen/pg')
    expect(mta).not.toContain('postgresql-db')
    await expect(
      readFile(join(project, 'app', 'router', 'xs-app.json'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('patches a backend-only production PostgreSQL MTA and retains its deployment resource', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'backend-postgres-app'],
      [
        ['Backend language?', '\r'],
        ['Database for local development?', '\r'],
        ['Database for production?', '\x1b[B\r'],
        ['Authentication?', '\x1b[A\r'],
        ['Frontend framework?', '\r'],
        ['Proceed?', '\r'],
      ],
      {
        CAPX_EXPECTED_CDS_NAME: 'backend-postgres-app',
        CAPX_EXPECTED_CDS_FACETS: 'sqlite,postgres,mta,test,lint',
      },
    )

    expect(result.code).toBe(0)
    const mta = await readFile(join(workspace, 'backend-postgres-app', 'mta.yaml'), 'utf8')
    expect(mta).toContain('name: backend-postgres-app-srv')
    expect(mta).toContain('service: postgresql-db')
    expect(mta).toContain('PostgreSQL service plan depends on your BTP subaccount entitlement')
  })

  it('generates a PostgreSQL development project with valid Compose semantics', async () => {
    const result = await runPromptedNew(
      [cli, 'new', 'postgres-app'],
      [
        ['Backend language?', '\r'],
        ['Database for local development?', '\x1b[B\r'],
        ['Database for production?', '\r'],
        ['Authentication?', '\x1b[A\r'],
        ['Frontend framework?', '\r'],
        ['Proceed?', '\r'],
      ],
      {
        CAPX_EXPECTED_CDS_NAME: 'postgres-app',
        CAPX_EXPECTED_CDS_FACETS: 'postgres,hana,mta,test,lint',
      },
    )

    expect(result.code).toBe(0)
    const project = join(workspace, 'postgres-app')
    const compose = parseDocument(await readFile(join(project, 'docker-compose.yml'), 'utf8'))
    expect(compose.errors).toEqual([])
    expect(compose.toJS()).toEqual({
      services: {
        postgres: {
          image: 'postgres:17-alpine',
          container_name: 'postgres-app-postgres',
          restart: 'unless-stopped',
          environment: {
            POSTGRES_DB: '${POSTGRES_DB:-postgres-app}',
            POSTGRES_USER: '${POSTGRES_USER:-postgres}',
            POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:-postgres}',
          },
          ports: ['${POSTGRES_PORT:-5432}:5432'],
          volumes: ['pg-data:/var/lib/postgresql/data'],
        },
      },
      volumes: { 'pg-data': null },
    })
    await expect(readFile(join(project, '.env'), 'utf8')).resolves.toBe(`POSTGRES_DB=postgres-app
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
`)
    const privateCdsrc = JSON.parse(await readFile(join(project, '.cdsrc-private.json'), 'utf8'))
    expect(privateCdsrc.requires.db['[development]'].credentials).toMatchObject({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres-app',
    })
    const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    expect(packageJson.scripts).toMatchObject({
      'db:up': 'docker compose up -d',
      'db:down': 'docker compose down',
    })
  })

  it('exits 1 with Cancelled when a prompt is cancelled', async () => {
    const result = await runCli([cli, 'new', 'cancelled-app'], (child, output) => {
      if (output.includes('Backend language?')) child.stdin.write('\u001b')
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cancelled')
  })
})
