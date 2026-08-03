import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const cds = process.env.CAPX_REAL_CDS_DK_10
const mbt = process.env.CAPX_REAL_MBT
const enabled = process.env.CAPX_REQUIRE_REAL_MTA === '1'
const directories = []

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function watch(project) {
  const child = spawn('npm', ['run', 'watch'], {
    cwd: project,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`cds watch did not start: ${output}`)), 30000)
    const onData = (chunk) => {
      output += chunk
      const match = output.match(/server listening on \{ url: '([^']+)'/)
      if (!match) return
      clearTimeout(timeout)
      resolve({ child, output, url: match[1] })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
  })
}

async function expectWatch(project) {
  const running = await watch(project)
  try {
    const response = await fetch(`${running.url}/odata/v4/cat`)
    expect(response.status).toBe(200)
  } finally {
    process.kill(-running.child.pid, 'SIGTERM')
  }
}

function runCapx(directory, name, { lang, devDb, prodDb, auth, frontend }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'capx.js'), 'new', name], {
      cwd: directory,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
    })
    let output = ''
    const answers = [
      ['Backend language?', lang === 'ts' ? '\x1b[B\r' : '\r'],
      ['Database for local development?', devDb === 'postgres' ? '\x1b[B\r' : '\r'],
      ['Database for production?', prodDb === 'postgres' ? '\x1b[B\r' : '\r'],
      ['Authentication?', auth === 'ias' ? '\x1b[B\r' : '\r'],
      [
        'Frontend framework?',
        frontend === 'react' ? '\x1b[B\x1b[B\r' : frontend === 'vue' ? '\x1b[B\r' : '\r',
      ],
      ['Proceed?', '\r'],
    ]
    let answer = 0
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx did not finish: ${output}`))
    }, 120000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (!output.includes(answers[answer]?.[0])) return
      child.stdin.write(answers[answer++][1])
      if (answer === answers.length) child.stdin.end()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      clearTimeout(timeout)
      resolve({ status, output })
    })
  })
}

async function writeDoctorTools(directory) {
  const bin = join(directory, 'bin')
  await Promise.all(
    [
      ['git', 'printf "git version 2.0.0"'],
      ['cds', 'exec "$CAPX_REAL_CDS_DK_10" "$@"'],
      ['mbt', 'printf "mbt 1.0.0"'],
      ['docker', 'printf "Docker version 1.0.0"'],
      [
        'cf',
        'if [ "$1" = "plugins" ]; then printf "multiapps"; else printf "cf version 8.0.0"; fi',
      ],
    ].map(async ([name, body]) => {
      const path = join(bin, name)
      await import('node:fs/promises').then(({ mkdir }) => mkdir(bin, { recursive: true }))
      await writeFile(path, `#!/bin/sh\n${body}\n`)
      await chmod(path, 0o755)
    }),
  )
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe.skipIf(!enabled)('required real CAP DK 10 MTA integration', () => {
  it('builds the TypeScript SQLite HANA XSUAA approuter fixture with the expected MTA names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-mta-smoke-2-'))
    directories.push(directory)
    await writeDoctorTools(directory)

    const name = 'mta-smoke-two'
    const result = await runCapx(directory, name, {
      lang: 'ts',
      devDb: 'sqlite',
      prodDb: 'hana',
      auth: 'xsuaa',
      frontend: 'none',
    })
    expect(result.status, result.output).toBe(0)
    const project = join(directory, name)

    const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    expect(packageJson.devDependencies['@cap-js/cds-types']).toBe('^0.18.0')
    expect(run('npm', ['install'], project).status).toBe(0)
    expect(run('npm', ['test'], project).status).toBe(0)
    await expectWatch(project)
    expect(run('npm', ['ls', '@cap-js/cds-types'], project).status).toBe(0)
    const typecheck = run('npx', ['tsc', '--noEmit'], project)
    expect(typecheck.status, `${typecheck.stdout}\n${typecheck.stderr}`).toBe(0)
    expect(run('npm', ['install'], join(project, 'app', 'router')).status).toBe(0)

    const mta = parseDocument(await readFile(join(project, 'mta.yaml'), 'utf8')).toJS()
    const moduleNames = mta.modules.map((module) => module.name)
    const resourceNames = mta.resources.map((resource) => resource.name)
    expect(moduleNames).toContain(`${name}-srv`)
    expect(moduleNames).toContain(`${name}-approuter`)
    expect(moduleNames).toContain(`${name}-db-deployer`)
    expect(resourceNames).toContain(`${name}-db`)
    expect(moduleNames).not.toContain(`${name}-db`)
    expect(moduleNames).not.toContain(`${name}-frontend`)
    expect(
      mta.modules.find((module) => module.type === 'nodejs' && module.path === 'gen/srv').name,
    ).toBe(`${name}-srv`)
    expect(
      mta.modules.find(
        (module) => module.type === 'approuter.nodejs' && module.path === 'app/router',
      ).name,
    ).toBe(`${name}-approuter`)
    expect(
      mta.modules.find((module) => module.type === 'hdb' && module.path === 'gen/db').name,
    ).toBe(`${name}-db-deployer`)
    expect(
      mta.resources.find((resource) => resource.type === 'com.sap.xs.hdi-container').name,
    ).toBe(`${name}-db`)
    await expect(readFile(join(project, 'xs-security.json'), 'utf8')).resolves.toContain(
      '$XSAPPNAME',
    )

    const build = run(mbt, ['build'], project)
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  }, 360000)

  it('builds the JavaScript PostgreSQL IAS Vue approuter fixture with the expected MTA names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-mta-smoke-3-'))
    directories.push(directory)
    await writeDoctorTools(directory)

    const name = 'mta-smoke-three'
    const result = await runCapx(directory, name, {
      lang: 'js',
      devDb: 'postgres',
      prodDb: 'postgres',
      auth: 'ias',
      frontend: 'vue',
    })
    expect(result.status, result.output).toBe(0)
    const project = join(directory, name)

    expect(run('npm', ['install'], project).status).toBe(0)
    expect(run('npm', ['test'], project).status).toBe(0)
    await expectWatch(project)
    expect(run('npm', ['install'], join(project, 'app', 'frontend')).status).toBe(0)
    expect(run('npm', ['install'], join(project, 'app', 'router')).status).toBe(0)

    const mta = parseDocument(await readFile(join(project, 'mta.yaml'), 'utf8')).toJS()
    expect(
      mta.modules.find((module) => module.type === 'nodejs' && module.path === 'gen/srv').name,
    ).toBe(`${name}-srv`)
    expect(
      mta.modules.find((module) => module.type === 'html5' && module.path === 'app/frontend').name,
    ).toBe(`${name}-frontend`)
    expect(
      mta.modules.find(
        (module) => module.type === 'approuter.nodejs' && module.path === 'app/router',
      ).name,
    ).toBe(`${name}-approuter`)
    expect(
      mta.modules.find((module) => module.type === 'nodejs' && module.path === 'gen/pg').name,
    ).toBe(`${name}-postgres-deployer`)
    expect(
      mta.resources.find((resource) => resource.parameters?.service === 'postgresql-db').name,
    ).toBe(`${name}-postgres`)
    expect(mta.resources.find((resource) => resource.parameters?.service === 'identity').name).toBe(
      `${name}-ias`,
    )

    const build = run(mbt, ['build'], project)
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  }, 360000)

  it('builds the TypeScript PostgreSQL HANA XSUAA React approuter fixture with the expected MTA names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-mta-smoke-4-'))
    directories.push(directory)
    await writeDoctorTools(directory)

    const name = 'mta-smoke-four'
    const result = await runCapx(directory, name, {
      lang: 'ts',
      devDb: 'postgres',
      prodDb: 'hana',
      auth: 'xsuaa',
      frontend: 'react',
    })
    expect(result.status, result.output).toBe(0)
    const project = join(directory, name)

    expect(run('npm', ['install'], project).status).toBe(0)
    expect(run('npm', ['test'], project).status).toBe(0)
    await expectWatch(project)
    expect(run('npm', ['install'], join(project, 'app', 'frontend')).status).toBe(0)
    expect(run('npm', ['install'], join(project, 'app', 'router')).status).toBe(0)
    expect(run('npm', ['run', '--prefix', 'app/frontend', 'build'], project).status).toBe(0)

    const mta = parseDocument(await readFile(join(project, 'mta.yaml'), 'utf8')).toJS()
    expect(
      mta.modules.find((module) => module.type === 'nodejs' && module.path === 'gen/srv').name,
    ).toBe(`${name}-srv`)
    expect(
      mta.modules.find((module) => module.type === 'html5' && module.path === 'app/frontend').name,
    ).toBe(`${name}-frontend`)
    expect(
      mta.modules.find(
        (module) => module.type === 'approuter.nodejs' && module.path === 'app/router',
      ).name,
    ).toBe(`${name}-approuter`)
    expect(
      mta.modules.find((module) => module.type === 'hdb' && module.path === 'gen/db').name,
    ).toBe(`${name}-db-deployer`)
    expect(
      mta.resources.find((resource) => resource.type === 'com.sap.xs.hdi-container').name,
    ).toBe(`${name}-db`)
    expect(mta.resources.some((resource) => resource.parameters?.service === 'postgresql-db')).toBe(
      false,
    )
    expect(mta.resources.find((resource) => resource.parameters?.service === 'xsuaa').name).toBe(
      `${name}-auth`,
    )
    await expect(readFile(join(project, 'xs-security.json'), 'utf8')).resolves.toContain(
      '$XSAPPNAME',
    )

    const build = run(mbt, ['build'], project)
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  }, 360000)
})
