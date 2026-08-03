import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const enabled = process.env.CAPX_REQUIRE_REAL_FRONTEND === '1'
const cds = process.env.CAPX_REAL_CDS_DK_10
const hasMbt = spawnSync('mbt', ['--version'], { encoding: 'utf8' }).status === 0
const directories = []

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function runCapx(directory, name, frontend) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'capx.js'), 'new', name], {
      cwd: directory,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
    })
    let output = ''
    const answers = [
      ['Backend language?', '\r'],
      ['Database for local development?', '\r'],
      ['Database for production?', '\r'],
      ['Authentication?', '\r'],
      ['Frontend framework?', frontend === 'vue' ? '\x1b[B\r' : '\x1b[B\x1b[B\r'],
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
      ['cds', 'if [ "$1" = "build" ]; then exit 37; fi\nexec "$CAPX_REAL_CDS_DK_10" "$@"'],
      ['mbt', 'printf "mbt 1.0.0"'],
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

async function createProject(frontend) {
  const directory = await mkdtemp(join(tmpdir(), `capx-${frontend}-`))
  directories.push(directory)
  const name = `${frontend}-frontend`
  await writeDoctorTools(directory)
  const result = await runCapx(directory, name, frontend)
  expect(result.status, result.stderr).toBe(0)
  return join(directory, name)
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe.skipIf(!enabled)('required real CAP DK 10 frontend integration', () => {
  for (const frontend of ['vue', 'react']) {
    it(`${frontend} builds under app/frontend with cds build --production`, async () => {
      const project = await createProject(frontend)
      expect(run('npm', ['install'], project).status).toBe(0)
      expect(run('npm', ['install'], join(project, 'app', 'frontend')).status).toBe(0)
      expect(run('npm', ['run', '--prefix', 'app/frontend', 'build'], project).status).toBe(0)
      expect(run(cds, ['build', '--production'], project).status).toBe(0)
      if (hasMbt) expect(run('mbt', ['build'], project).status).toBe(0)
      const { readFile } = await import('node:fs/promises')
      const mta = parseDocument(await readFile(join(project, 'mta.yaml'), 'utf8')).toJS()
      const moduleNames = mta.modules.map((module) => module.name)
      const resourceNames = mta.resources.map((resource) => resource.name)
      expect(moduleNames).toContain(`${frontend}-frontend-srv`)
      expect(moduleNames).toContain(`${frontend}-frontend-frontend`)
      expect(moduleNames).toContain(`${frontend}-frontend-approuter`)
      expect(moduleNames).toContain(`${frontend}-frontend-db-deployer`)
      expect(resourceNames).toContain(`${frontend}-frontend-db`)
      expect(
        mta.modules.find((module) => module.type === 'nodejs' && module.path === 'gen/srv').name,
      ).toBe(`${frontend}-frontend-srv`)
      expect(
        mta.modules.find((module) => module.type === 'html5' && module.path === 'app/frontend')
          .name,
      ).toBe(`${frontend}-frontend-frontend`)
      expect(
        mta.modules.find(
          (module) => module.type === 'approuter.nodejs' && module.path === 'app/router',
        ).name,
      ).toBe(`${frontend}-frontend-approuter`)
      expect(
        mta.modules.find((module) => module.type === 'hdb' && module.path === 'gen/db').name,
      ).toBe(`${frontend}-frontend-db-deployer`)
      expect(
        mta.resources.find((resource) => resource.type === 'com.sap.xs.hdi-container').name,
      ).toBe(`${frontend}-frontend-db`)
      const router = JSON.parse(
        await readFile(join(project, 'app', 'router', 'xs-app.json'), 'utf8'),
      )
      expect(router.routes).toContainEqual(
        expect.objectContaining({ source: '^/odata/(.*)$', destination: 'srv-api' }),
      )
      expect(router.routes).toContainEqual(
        expect.objectContaining({ source: '^(.*)$', service: 'html5-apps-repo-rt' }),
      )
    }, 360000)
  }
})
