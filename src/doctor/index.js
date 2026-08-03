import { cancel, confirm, isCancel } from '@clack/prompts'
import { execa } from 'execa'
import { checkCdsDk } from './checks/cds-dk.js'
import { checkCf } from './checks/cf.js'
import { checkDocker } from './checks/docker.js'
import { checkGit } from './checks/git.js'
import { checkMbt } from './checks/mbt.js'
import { checkMtaCfPlugin } from './checks/mta-cf-plugin.js'
import { checkNode } from './checks/node.js'
import { checkNpm } from './checks/npm.js'
import { getInstallHint } from './install-hints.js'

function stop(message) {
  console.error(message)
  process.exitCode = 1
  return false
}

async function askToContinue(message) {
  const accepted = await confirm({ message, initialValue: true })
  if (isCancel(accepted)) {
    cancel('Cancelled')
    process.exitCode = 1
    return false
  }
  if (accepted) return true
  cancel('Cancelled')
  process.exitCode = 1
  return false
}

async function installGlobal(packageName) {
  try {
    await execa('npm', ['i', '-g', packageName], { stdio: 'inherit' })
    return true
  } catch (error) {
    return stop(error.stderr || `Failed to install ${packageName}.`)
  }
}

async function requireGlobal(check, packageName, label) {
  if ((await check()).ok) return true
  if (!(await askToContinue(`${label} is required. Install globally now?`))) return false
  if (!(await installGlobal(packageName))) return false
  return (await check()).ok || stop(`${label} is still unavailable after installation.`)
}

async function requireGit() {
  if ((await checkGit()).ok) return true
  const hint = await getInstallHint('git')
  console.error(`Git is required. Install it with: ${hint}`)
  while (await askToContinue('Retry after installing Git?')) {
    if ((await checkGit()).ok) return true
    console.error(`Git is still unavailable. Install it with: ${hint}`)
  }
  return false
}

async function allowMissing(check, tool, message) {
  if ((await check()).ok) return true
  const hint = await getInstallHint(tool)
  console.error(`${message}. Install it with: ${hint}`)
  return askToContinue(
    `Continue without the ${tool === 'cf' ? 'Cloud Foundry CLI' : 'MTA CF plugin'}?`,
  )
}

export async function runDoctor() {
  const node = await checkNode()
  if (!node.ok)
    return stop('Node.js 22 or newer is required. Install Node 24 LTS: https://nodejs.org/')
  if (!(await checkNpm()).ok)
    return stop('npm is required. Reinstall Node.js from https://nodejs.org/.')
  if (!(await requireGit())) return false
  if (!(await requireGlobal(checkCdsDk, '@sap/cds-dk@latest', '@sap/cds-dk 10+'))) return false
  if (!(await requireGlobal(checkMbt, 'mbt', 'mbt'))) return false
  const cf = await checkCf()
  if (!cf.ok) return allowMissing(async () => cf, 'cf', 'Cloud Foundry CLI is not installed')
  return allowMissing(
    checkMtaCfPlugin,
    'mta-cf-plugin',
    'MTA CF plugin (multiapps) is not installed',
  )
}

export async function runDockerCheck() {
  const docker = await checkDocker()
  if (docker.ok) return true
  const hint = await getInstallHint('docker')
  const message =
    docker.reason === 'missingCompose'
      ? 'Docker Compose plugin is unavailable'
      : 'Docker is not installed'
  console.error(`${message}. Install it with: ${hint}`)
  return askToContinue('Continue without Docker?')
}
