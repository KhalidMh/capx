import { spawnSync } from 'node:child_process'

if (!process.env.CAPX_REAL_CDS_DK_10) {
  console.error('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable.')
  process.exitCode = 1
} else {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'test/e2e/install-git-required.test.js'],
    { env: { ...process.env, CAPX_REQUIRE_REAL_INSTALL_GIT: '1' }, stdio: 'inherit' },
  )
  process.exitCode = result.status ?? 1
}
