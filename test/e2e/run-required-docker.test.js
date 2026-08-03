import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const gate = fileURLToPath(new URL('./run-required-docker.js', import.meta.url))
const directories = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('required Docker validation gate', () => {
  it('fails clearly when the Docker executable is unavailable', () => {
    const result = spawnSync(process.execPath, [gate], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '/not-a-real-bin' },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Docker must be installed and available')
  })

  it('requires CAPX_REAL_CDS_DK_10 after Docker and Compose are available', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'capx-docker-gate-'))
    directories.push(bin)
    const docker = join(bin, 'docker')
    await writeFile(
      docker,
      `#!/bin/sh
if [ "$1" = "--version" ] || [ "$1" = "compose" ]; then printf "Docker version 1.0.0"; else exit 1; fi
`,
    )
    await chmod(docker, 0o755)
    const result = spawnSync(process.execPath, [gate], {
      encoding: 'utf8',
      env: { ...process.env, CAPX_REAL_CDS_DK_10: '', PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable')
  })

  it('fails before Vitest when the Compose plugin is unavailable', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'capx-docker-gate-'))
    directories.push(bin)
    const docker = join(bin, 'docker')
    await writeFile(
      docker,
      `#!/bin/sh
if [ "$1" = "--version" ]; then printf "Docker version 1.0.0"; else exit 1; fi
`,
    )
    await chmod(docker, 0o755)

    const result = spawnSync(process.execPath, [gate], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CAPX_REAL_CDS_DK_10: '/configured/cds',
        PATH: `${bin}:${process.env.PATH}`,
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Docker Compose plugin must be installed and available')
  })
})
