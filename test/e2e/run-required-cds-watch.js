import { spawnSync } from 'node:child_process'

const cds = process.env.CAPX_REAL_CDS_DK_10

if (!cds) {
  console.error('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable.')
  process.exitCode = 1
} else {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'test/e2e/cds-watch.test.js'],
    {
      env: { ...process.env, CAPX_REQUIRE_REAL_CDS_WATCH: '1' },
      stdio: 'inherit',
    },
  )
  process.exitCode = result.status ?? 1
}
