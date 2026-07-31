import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))
const temporaryPaths = []

async function createBin(commands) {
  const directory = await mkdtemp(join(tmpdir(), 'capx-doctor-'))
  temporaryPaths.push(directory)
  await Promise.all(
    Object.entries(commands).map(async ([name, body]) => {
      const path = join(directory, name)
      await writeFile(path, `#!/bin/sh\n${body}\n`)
      await chmod(path, 0o755)
    }),
  )
  return directory
}

function runCli(path, answers, { nodeVersion } = {}) {
  return new Promise((resolve, reject) => {
    const args = nodeVersion
      ? [
          '--input-type=module',
          '--eval',
          `Object.defineProperty(process, 'version', { value: '${nodeVersion}' }); process.argv = [process.argv[0], ${JSON.stringify(cli)}, 'new', 'test-app']; await import('${pathToFileURL(cli).href}')`,
        ]
      : [cli, 'new', 'test-app']
    const child = spawn(process.execPath, args, {
      env: { ...process.env, PATH: path },
    })
    let output = ''
    let answerIndex = 0
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`capx did not finish: ${output}`))
    }, 3000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      const answer = answers[answerIndex]
      if (answer && output.includes(answer.prompt)) {
        child.stdin.write(answer.input)
        answerIndex += 1
        if (answer.end) child.stdin.end()
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, output })
    })
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

describe('doctor missing-tool paths', () => {
  it('stops before project prompts when Node is unsupported', async () => {
    const path = await createBin({})

    const result = await runCli(path, [], { nodeVersion: 'v21.9.0' })

    expect(result.code).toBe(1)
    expect(result.output).toContain('Node.js 22 or newer is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('stops before project prompts when npm is missing', async () => {
    const path = await createBin({})

    const result = await runCli(path, [])

    expect(result.code).toBe(1)
    expect(result.output).toContain('npm is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('stops before project prompts when git is missing', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
    })

    const result = await runCli(path, [
      { prompt: 'Retry after installing Git?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Git is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('offers to install a missing cds-dk and exits when declined', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
    })

    const result = await runCli(path, [
      { prompt: 'Install globally now?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('@sap/cds-dk 10+ is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('offers a cds-dk v10 upgrade for version 9 and exits when declined', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  9.8.1"',
    })

    const result = await runCli(path, [
      { prompt: '@sap/cds-dk 10+ is required. Install globally now?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('@sap/cds-dk 10+ is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('installs and re-detects a missing cds-dk without changing the host', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; else : > "${0%/*}/cds-installed"; fi',
      git: 'printf "git version 2.0.0"',
      cds: 'if [ -f "${0%/*}/cds-installed" ]; then printf "@sap/cds-dk (global)  10.0.6"; else exit 1; fi',
      mbt: 'printf "mbt 1.0.0"',
      cf: 'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
    })

    const result = await runCli(path, [
      { prompt: 'Install globally now?', input: '\r' },
      { prompt: 'Backend language?', input: '\u001b' },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Backend language?')
  })

  it('prints failed global-install stderr and exits', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; else printf "simulated global install failure" >&2; exit 23; fi',
      git: 'printf "git version 2.0.0"',
    })

    const result = await runCli(path, [{ prompt: 'Install globally now?', input: '\r', end: true }])

    expect(result.code).toBe(1)
    expect(result.output).toContain('simulated global install failure')
    expect(result.output).not.toContain('Backend language?')
  })

  it('exits when cds-dk remains unavailable after a successful global installation', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; fi',
      git: 'printf "git version 2.0.0"',
    })

    const result = await runCli(path, [{ prompt: 'Install globally now?', input: '\r', end: true }])

    expect(result.code).toBe(1)
    expect(result.output).toContain('@sap/cds-dk 10+ is still unavailable after installation')
    expect(result.output).not.toContain('Backend language?')
  })

  it('offers to install missing mbt and exits when declined', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  10.0.0"',
    })

    const result = await runCli(path, [
      { prompt: 'mbt is required. Install globally now?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('mbt is required')
    expect(result.output).not.toContain('Backend language?')
  })

  it('installs and re-detects missing mbt without changing the host', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; else : > "${0%/*}/mbt-installed"; fi',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk  10.0.3"',
      mbt: 'if [ -f "${0%/*}/mbt-installed" ]; then printf "mbt 1.0.0"; else exit 1; fi',
      cf: 'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
    })

    const result = await runCli(path, [
      { prompt: 'mbt is required. Install globally now?', input: '\r' },
      { prompt: 'Backend language?', input: '\u001b' },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Backend language?')
  })

  it('prints failed mbt installation stderr and exits', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; else printf "simulated mbt install failure" >&2; exit 23; fi',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk  10.0.3"',
    })

    const result = await runCli(path, [
      { prompt: 'mbt is required. Install globally now?', input: '\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('simulated mbt install failure')
    expect(result.output).not.toContain('Backend language?')
  })

  it('exits when mbt remains unavailable after a successful global installation', async () => {
    const path = await createBin({
      npm: 'if [ "$1" = "--version" ]; then printf 10.0.0; fi',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk  10.0.3"',
    })

    const result = await runCli(path, [
      { prompt: 'mbt is required. Install globally now?', input: '\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('mbt is still unavailable after installation')
    expect(result.output).not.toContain('Backend language?')
  })

  it('skips MTA plugin detection after continuing without the Cloud Foundry CLI', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  10.0.0"',
      mbt: 'printf "mbt 1.0.0"',
    })

    const result = await runCli(path, [
      { prompt: 'Continue without the Cloud Foundry CLI?', input: '\r' },
      { prompt: 'Backend language?', input: '\u001b' },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cloud Foundry CLI is not installed')
    expect(result.output).not.toContain('MTA CF plugin (multiapps) is not installed')
    expect(result.output).toContain('Backend language?')
  })

  it('continues to project prompts when the CF CLI is present but multiapps is missing', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  10.0.0"',
      mbt: 'printf "mbt 1.0.0"',
      cf: 'if [ "$1" = "plugins" ]; then exit 1; else printf "cf version 8.0.0"; fi',
    })

    const result = await runCli(path, [
      { prompt: 'Continue without the MTA CF plugin?', input: '\r' },
      { prompt: 'Backend language?', input: '\u001b' },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('MTA CF plugin (multiapps) is not installed')
    expect(result.output).toContain('Backend language?')
  })

  it('aborts when multiapps is missing and the user declines to continue', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  10.0.0"',
      mbt: 'printf "mbt 1.0.0"',
      cf: 'if [ "$1" = "plugins" ]; then exit 1; else printf "cf version 8.0.0"; fi',
    })

    const result = await runCli(path, [
      { prompt: 'Continue without the MTA CF plugin?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('MTA CF plugin (multiapps) is not installed')
    expect(result.output).not.toContain('Backend language?')
  })

  it('checks Docker only after PostgreSQL development is selected', async () => {
    const path = await createBin({
      npm: 'printf 10.0.0',
      git: 'printf "git version 2.0.0"',
      cds: 'printf "@sap/cds-dk (global)  10.0.0"',
      mbt: 'printf "mbt 1.0.0"',
      cf: 'if [ "$1" = "plugins" ]; then printf "multiapps 3.0.0"; else printf "cf version 8.0.0"; fi',
    })

    const result = await runCli(path, [
      { prompt: 'Backend language?', input: '\r' },
      { prompt: 'Database for local development?', input: '\u001b[B\r' },
      { prompt: 'Continue without Docker?', input: 'n\r', end: true },
    ])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Docker is not installed')
    expect(result.output).not.toContain('Database for production?')
  })
})
