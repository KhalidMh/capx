import { beforeEach, describe, expect, it, vi } from 'vitest'

const confirm = vi.fn()
const isCancel = vi.fn()
const execa = vi.fn()

vi.mock('@clack/prompts', () => ({
  cancel: vi.fn(),
  confirm,
  isCancel,
}))

vi.mock('execa', () => ({ execa }))

describe('doctor orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('stops when the Docker continue prompt is cancelled', async () => {
    execa.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const cancelled = Symbol('cancelled')
    confirm.mockResolvedValueOnce(cancelled)
    isCancel.mockReturnValueOnce(true)
    const { runDockerCheck } = await import('../../src/doctor/index.js')

    await expect(runDockerCheck()).resolves.toBe(false)
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('skips MTA plugin detection after continuing without the Cloud Foundry CLI', async () => {
    execa
      .mockResolvedValueOnce({ stdout: '10.0.0' })
      .mockResolvedValueOnce({ stdout: 'git version 2.0.0' })
      .mockResolvedValueOnce({ stdout: '@sap/cds-dk  10.0.3' })
      .mockResolvedValueOnce({ stdout: 'mbt 1.0.0' })
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    confirm.mockResolvedValueOnce(true)
    isCancel.mockReturnValue(false)
    const { runDoctor } = await import('../../src/doctor/index.js')

    await expect(runDoctor()).resolves.toBe(true)
    expect(execa).toHaveBeenCalledTimes(5)
    expect(execa).not.toHaveBeenCalledWith('cf', ['plugins'], { timeout: 3000 })
  })
})
