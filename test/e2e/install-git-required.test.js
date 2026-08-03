import { spawn, spawnSync } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const enabled = process.env.CAPX_REQUIRE_REAL_INSTALL_GIT === '1'
const cds = process.env.CAPX_REAL_CDS_DK_10
const directories = []

function run(command, args, cwd, env = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
}

function runCapx(directory, name, env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'bin', 'capx.js'), 'new', name, ...args],
      {
        cwd: directory,
        env,
      },
    )
    let output = ''
    const answers = [
      ['Backend language?', '\r'],
      ['Database for local development?', '\x1b[B\r'],
      ['Database for production?', '\r'],
      ['Authentication?', '\r'],
      ['Frontend framework?', '\x1b[B\r'],
      ['Proceed?', '\r'],
    ]
    let answer = 0
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx did not finish: ${output}`))
    }, 360000)
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
      resolve({ output, status })
    })
  })
}

async function writeDoctorTools(directory) {
  const bin = join(directory, 'bin')
  await Promise.all(
    [
      ['git', 'exec /usr/bin/git "$@"'],
      ['cds', 'exec "$CAPX_REAL_CDS_DK_10" "$@"'],
      ['mbt', 'printf "mbt 1.0.0"'],
      [
        'docker',
        'if [ "$1" = "--version" ]; then printf "Docker version 1.0.0"; else printf "Docker Compose version 1.0.0"; fi',
      ],
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

describe.skipIf(!enabled)('required real CAP DK 10 install and Git integration', () => {
  it('installs root, Vue, and router dependencies before committing only public project files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-install-git-'))
    directories.push(directory)
    const gitConfig = join(directory, 'gitconfig')
    await writeFile(
      gitConfig,
      '[user]\n\tname = capx integration\n\temail = capx@example.invalid\n',
    )
    await writeDoctorTools(directory)
    const env = {
      ...process.env,
      CAPX_REAL_CDS_DK_10: cds,
      GIT_CONFIG_GLOBAL: gitConfig,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
    }

    const result = await runCapx(directory, 'install-git-app', env)
    expect(result.status, result.output).toBe(0)

    const project = join(directory, 'install-git-app')
    expect(run('npm', ['test'], project, env).status).toBe(0)
    expect(run('npm', ['run', 'build'], join(project, 'app', 'frontend'), env).status).toBe(0)
    await Promise.all([
      access(join(project, 'package-lock.json')),
      access(join(project, 'node_modules')),
      access(join(project, 'app', 'frontend', 'package-lock.json')),
      access(join(project, 'app', 'frontend', 'node_modules')),
      access(join(project, 'app', 'router', 'package-lock.json')),
      access(join(project, 'app', 'router', 'node_modules')),
      access(join(project, '.env')),
      access(join(project, '.cdsrc-private.json')),
    ])
    expect(
      JSON.parse(await readFile(join(project, 'app', 'router', 'package.json'), 'utf8'))
        .dependencies,
    ).toHaveProperty('@sap/approuter')
    expect(run('git', ['log', '--oneline'], project, env).stdout).toMatch(
      /^[a-f0-9]+ Initial commit - project setup\n$/u,
    )
    expect(run('git', ['check-ignore', '.env', '.cdsrc-private.json'], project, env).status).toBe(0)
    expect(run('git', ['ls-files', '--error-unmatch', '.env'], project, env).status).toBe(1)
    expect(run('git', ['ls-files', '--error-unmatch', '.capx-log'], project, env).status).toBe(1)
    expect(
      run('git', ['ls-files', '--error-unmatch', '.cdsrc-private.json'], project, env).status,
    ).toBe(1)

    const noForce = await runCapx(directory, 'install-git-app', env)
    expect(noForce.status).toBe(1)
    expect(noForce.output).toContain('Directory exists')

    const force = await runCapx(directory, 'install-git-app', env, ['--force'])
    expect(force.status, force.output).toBe(0)
    await access(join(project, 'package.json'))
  }, 480000)
})
