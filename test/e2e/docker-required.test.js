import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const cds = process.env.CAPX_REAL_CDS_DK_10
const enabled = process.env.CAPX_REQUIRE_REAL_DOCKER === '1'
const directories = []

async function writeDoctorTools(directory) {
  const bin = join(directory, 'bin')
  await Promise.all(
    [
      ['git', 'printf "git version 2.0.0"'],
      ['mbt', 'printf "mbt 1.0.0"'],
      [
        'cf',
        'if [ "$1" = "plugins" ]; then printf "multiapps"; else printf "cf version 8.0.0"; fi',
      ],
      ['cds', 'exec "$CAPX_REAL_CDS_DK_10" "$@"'],
    ].map(async ([name, body]) => {
      const path = join(bin, name)
      await import('node:fs/promises').then(({ mkdir }) => mkdir(bin, { recursive: true }))
      await writeFile(path, `#!/bin/sh\n${body}\n`)
      await chmod(path, 0o755)
    }),
  )
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function runCapx(directory, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'capx.js'), 'new', name], {
      cwd: directory,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
    })
    const answers = [
      ['Backend language?', '\r'],
      ['Database for local development?', '\x1b[B\r'],
      ['Database for production?', '\x1b[B\r'],
      ['Authentication?', '\x1b[B\r'],
      ['Frontend framework?', '\x1b[B\r'],
      ['Proceed?', '\r'],
    ]
    let answer = 0
    let output = ''
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

function waitForWatch(project) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'watch'], { cwd: project })
    let output = ''
    let ready = false
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`cds watch did not become ready: ${output}`))
    }, 60000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (ready || !output.includes('[cds] - server listening')) return
      ready = true
      child.kill()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      clearTimeout(timeout)
      if (ready) resolve()
      else reject(new Error(`cds watch exited ${status}: ${output}`))
    })
  })
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true })))
})

describe.skipIf(!enabled)('required real Docker Compose validation', () => {
  it('validates the full capx smoke #3 project without starting containers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-docker-compose-'))
    directories.push(directory)
    await writeDoctorTools(directory)

    const name = 'docker-smoke-three'
    const created = await runCapx(directory, name)
    expect(created.status, created.output).toBe(0)

    const project = join(directory, name)
    for (const path of [
      project,
      join(project, 'app', 'frontend'),
      join(project, 'app', 'router'),
    ]) {
      const install = run('npm', ['install'], path)
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0)
    }
    const test = run('npm', ['test'], project)
    expect(test.status, `${test.stdout}\n${test.stderr}`).toBe(0)
    const build = run('npm', ['run', '--prefix', 'app/frontend', 'build'], project)
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
    await waitForWatch(project)

    const compose = run('docker', ['compose', 'config', '--quiet'], project)
    expect(compose.status, `${compose.stdout}\n${compose.stderr}`).toBe(0)
  }, 360000)
})
