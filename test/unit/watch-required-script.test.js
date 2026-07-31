import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

describe('test:watch:required', () => {
  it('fails when no CAP 10 executable is supplied', async () => {
    const result = await execa('npm', ['run', 'test:watch:required'], {
      reject: false,
      all: true,
      env: { ...process.env, CAPX_REAL_CDS_DK_10: '' },
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.all).toContain('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable.')
  })
})
