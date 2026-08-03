import { describe, expect, it, vi } from 'vitest'
import { checkCdsDk } from '../../src/doctor/checks/cds-dk.js'
import { checkCf } from '../../src/doctor/checks/cf.js'
import { checkDocker } from '../../src/doctor/checks/docker.js'
import { checkGit } from '../../src/doctor/checks/git.js'
import { checkMbt } from '../../src/doctor/checks/mbt.js'
import { checkMtaCfPlugin } from '../../src/doctor/checks/mta-cf-plugin.js'
import { checkNode } from '../../src/doctor/checks/node.js'
import { checkNpm } from '../../src/doctor/checks/npm.js'

const success = (stdout) => vi.fn().mockResolvedValue({ stdout })
const missing = () =>
  vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

describe('doctor checks', () => {
  it('accepts Node 22 and rejects older versions without executing a command', async () => {
    const execute = vi.fn()

    await expect(checkNode({ version: 'v22.0.0', execute })).resolves.toMatchObject({ ok: true })
    await expect(checkNode({ version: 'v21.9.0', execute })).resolves.toMatchObject({ ok: false })
    expect(execute).not.toHaveBeenCalled()
  })

  it('detects npm with a three-second execa timeout', async () => {
    const execute = success('10.0.0')

    await expect(checkNpm({ execute })).resolves.toMatchObject({ ok: true, version: '10.0.0' })
    expect(execute).toHaveBeenCalledWith('npm', ['--version'], { timeout: 3000 })
  })

  it('reports a missing git executable', async () => {
    await expect(checkGit({ execute: missing() })).resolves.toMatchObject({
      ok: false,
      name: 'git',
    })
  })

  it('accepts the global cds-dk version format', async () => {
    await expect(
      checkCdsDk({ execute: success('@sap/cds-dk (global)  10.0.6') }),
    ).resolves.toMatchObject({ ok: true, major: 10 })
  })

  it('accepts the normal cds-dk version format with whitespace before the version', async () => {
    await expect(
      checkCdsDk({ execute: success('@sap/cds-dk  10.0.3\n@sap/cds  10.0.0') }),
    ).resolves.toMatchObject({
      ok: true,
      major: 10,
    })
  })

  it('accepts parenthesized global and plain cds-dk version formats', async () => {
    await expect(
      checkCdsDk({ execute: success('@sap/cds-dk (global): 10.1.0') }),
    ).resolves.toMatchObject({
      ok: true,
      major: 10,
    })
    await expect(checkCdsDk({ execute: success('@sap/cds-dk 10.1.0') })).resolves.toMatchObject({
      ok: true,
      major: 10,
    })
  })

  it('rejects an older or unparseable cds-dk version', async () => {
    await expect(
      checkCdsDk({ execute: success('@sap/cds-dk (global)  9.8.1') }),
    ).resolves.toMatchObject({ ok: false, major: 9 })
    await expect(
      checkCdsDk({ execute: success('cds version unavailable') }),
    ).resolves.toMatchObject({
      ok: false,
      major: undefined,
    })
  })

  it('detects the cf CLI', async () => {
    const execute = success('cf version 8.0.0')

    await expect(checkCf({ execute })).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledWith('cf', ['--version'], { timeout: 3000 })
  })

  it('detects mbt', async () => {
    const execute = success('mbt 1.2.0')

    await expect(checkMbt({ execute })).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledWith('mbt', ['--version'], { timeout: 3000 })
  })

  it('detects the MTA CF multiapps plugin', async () => {
    const execute = success('multiapps 3.0.0')

    await expect(checkMtaCfPlugin({ execute })).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledWith('cf', ['plugins'], { timeout: 3000 })
  })

  it('requires Docker and its Compose plugin with three-second timeouts', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'Docker version 28.0.0' })

    await expect(checkDocker({ execute })).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenNthCalledWith(1, 'docker', ['--version'], { timeout: 3000 })
    expect(execute).toHaveBeenNthCalledWith(2, 'docker', ['compose', 'version'], { timeout: 3000 })
  })

  it('reports Docker unavailable when its Compose plugin is missing', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'Docker version 28.0.0' })
      .mockRejectedValueOnce(Object.assign(new Error('missing compose'), { code: 'ENOENT' }))

    await expect(checkDocker({ execute })).resolves.toMatchObject({
      ok: false,
      name: 'docker',
      reason: 'missingCompose',
    })
  })

  it('reports a missing Docker executable', async () => {
    await expect(checkDocker({ execute: missing() })).resolves.toMatchObject({
      ok: false,
      name: 'docker',
      reason: 'missingDocker',
    })
  })
})
