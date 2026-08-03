import { spawnSync } from 'node:child_process'

const cds = process.env.CAPX_REAL_CDS_DK_10
const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' })

const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' })

if (docker.status !== 0) {
  console.error(
    'Docker must be installed and available to run the required Phase 7 Compose validation gate.',
  )
  process.exitCode = 1
} else if (compose.status !== 0) {
  console.error(
    'Docker Compose plugin must be installed and available to run the required Phase 7 Compose validation gate.',
  )
  process.exitCode = 1
} else if (!cds) {
  console.error('CAPX_REAL_CDS_DK_10 must point to a cds-dk 10 executable.')
  process.exitCode = 1
} else {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'test/e2e/docker-required.test.js'],
    {
      env: { ...process.env, CAPX_REAL_CDS_DK_10: cds, CAPX_REQUIRE_REAL_DOCKER: '1' },
      stdio: 'inherit',
    },
  )
  process.exitCode = result.status ?? 1
}
