import { spawnSync } from 'node:child_process'

const cds = process.env.CAPX_REAL_CDS_DK_10
const mbt = process.env.CAPX_REAL_MBT

if (!cds) {
  console.error('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable.')
  process.exitCode = 1
} else if (!mbt) {
  console.error('CAPX_REAL_MBT must point to an mbt executable.')
  process.exitCode = 1
} else if (spawnSync(mbt, ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.error('mbt must be installed to run the required Phase 6 MTA integration gate.')
  process.exitCode = 1
} else {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'test/e2e/mta-required.test.js'],
    {
      env: { ...process.env, CAPX_REAL_MBT: mbt, CAPX_REQUIRE_REAL_MTA: '1' },
      stdio: 'inherit',
    },
  )
  process.exitCode = result.status ?? 1
}
