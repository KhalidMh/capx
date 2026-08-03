import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { execa } from 'execa'

const cds = process.env.CAPX_REAL_CDS_DK_10
const enabled = process.env.CAPX_REQUIRE_REAL_VUE_NO_AUTH === '1'
const directories = []

function runCapx(directory, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'capx.js'), 'new', name], {
      cwd: directory,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
    })
    const answers = [
      ['Backend language?', '\r'],
      ['Database for local development?', '\r'],
      ['Database for production?', '\r'],
      ['Authentication?', '\x1b[A\r'],
      ['Frontend framework?', '\x1b[B\r'],
      ['Add a standalone approuter (proxy-only, no auth)?', '\x1b[B\r'],
      ['Proceed?', '\r'],
    ]
    let answer = 0
    let output = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx did not finish: ${output}`))
    }, 180000)
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

function start(command, args, cwd, env = {}) {
  const subprocess = execa(command, args, {
    all: true,
    cwd,
    detached: true,
    env: { ...process.env, ...env },
  })
  let output = ''
  subprocess.all.on('data', (chunk) => {
    output += chunk
  })
  return { output: () => output, subprocess }
}

async function waitForUrl(output, expression, label) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const match = output().match(expression)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label} did not report a listening URL: ${output()}`)
}

async function waitForHttp200(url, output) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Expected HTTP 200 from ${url}: ${output()}`)
}

async function stop({ subprocess }) {
  if (subprocess.pid) process.kill(-subprocess.pid, 'SIGTERM')
  await subprocess.catch(() => undefined)
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true })))
})

describe.skipIf(!enabled)('required real CAP DK 10 Vue no-auth integration', () => {
  it('runs CAP and Vite for smoke #5 without an approuter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-vue-no-auth-'))
    directories.push(directory)
    await writeDoctorTools(directory)

    const created = await runCapx(directory, 'vue-no-auth')
    expect(created.status, created.output).toBe(0)
    const project = join(directory, 'vue-no-auth')

    await execa('npm', ['install'], { cwd: project })
    await execa('npm', ['install'], { cwd: join(project, 'app', 'frontend') })
    const cap = start('npm', ['run', 'watch'], project, { PORT: '4004' })
    const vite = start(
      'npm',
      ['run', 'dev', '--', '--host', '127.0.0.1'],
      join(project, 'app', 'frontend'),
    )
    try {
      const capUrl = await waitForUrl(cap.output, /server listening on \{ url: '([^']+)'/, 'CAP')
      const viteUrl = await waitForUrl(vite.output, /Local:\s+(http:\/\/[^\s]+)/, 'Vite')
      await waitForHttp200(`${capUrl}/odata/v4/cat`, cap.output)
      await waitForHttp200(viteUrl, vite.output)
      await waitForHttp200(new URL('/odata/v4/cat', viteUrl).href, vite.output)
    } finally {
      await Promise.all([stop(vite), stop(cap)])
    }
  }, 360000)
})
