import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const gate = fileURLToPath(new URL('./run-required-vue-no-auth.js', import.meta.url))

describe('required Vue no-auth validation gate', () => {
  it('requires CAPX_REAL_CDS_DK_10 before starting Vitest', () => {
    const result = spawnSync(process.execPath, [gate], {
      encoding: 'utf8',
      env: { ...process.env, CAPX_REAL_CDS_DK_10: '' },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable')
  })
})
