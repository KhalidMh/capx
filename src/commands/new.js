import { cancel, confirm, isCancel } from '@clack/prompts'
import { buildPlan, buildPreliminaryPlan } from '../decision-matrix.js'
import { runDockerCheck, runDoctor } from '../doctor/index.js'
import { promptApprouter } from '../prompts/approuter.js'
import { promptAuth } from '../prompts/auth.js'
import { promptConfirmation } from '../prompts/confirm.js'
import { promptDevDb } from '../prompts/dev-db.js'
import { promptFrontend } from '../prompts/frontend.js'
import { promptLanguage } from '../prompts/language.js'
import { promptProdDb } from '../prompts/prod-db.js'
import { promptProjectName, validateProjectName } from '../prompts/project-name.js'
import { validateTarget } from '../steps/01-validate-target.js'
import { runCdsInit } from '../steps/02-cds-init.js'
import { runCdsAddFrontend } from '../steps/03-cds-add-frontend.js'
import { patchCdsrc } from '../steps/04-patch-cdsrc.js'
import { patchMta } from '../steps/05-patch-mta.js'
import { writeExtras } from '../steps/06-write-extras.js'
import { writeDocker } from '../steps/07-write-docker.js'
import { writeStubs } from '../steps/08-write-stubs.js'
import { installDependencies } from '../steps/09-install-deps.js'
import { initializeGit } from '../steps/10-git-init.js'
import { appendProgress, removeProgress, rollbackProject } from '../utils/rollback.js'

function exitCancelled() {
  cancel('Cancelled')
  process.exitCode = 1
}

function isCancelled(value) {
  if (!isCancel(value)) return false
  exitCancelled()
  return true
}

export async function runNewCommand(name, options = {}) {
  const nameError = name && validateProjectName(name)
  if (nameError) {
    console.error(nameError)
    process.exitCode = 1
    return
  }

  if (!(await runDoctor())) return

  const projectName = name ?? (await promptProjectName())
  if (isCancelled(projectName)) return

  const lang = await promptLanguage()
  if (isCancelled(lang)) return
  const devDb = await promptDevDb()
  if (isCancelled(devDb)) return
  const preliminaryPlan = buildPreliminaryPlan({ devDb })
  if (preliminaryPlan.postgresDev && !(await runDockerCheck())) return
  const prodDb = await promptProdDb()
  if (isCancelled(prodDb)) return
  const auth = await promptAuth()
  if (isCancelled(auth)) return
  const frontend = await promptFrontend()
  if (isCancelled(frontend)) return

  const inputs = { name: projectName, lang, devDb, prodDb, auth, frontend }
  let plan = buildPlan(inputs)
  if (plan.promptForApprouter) {
    inputs.approuter = await promptApprouter()
    if (isCancelled(inputs.approuter)) return
    plan = buildPlan(inputs)
  }

  const confirmed = await promptConfirmation(plan.summary)
  if (isCancelled(confirmed)) return
  if (!confirmed) {
    exitCancelled()
    return
  }

  try {
    await runProjectSteps(projectName, inputs, plan, options)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

const defaultProjectSteps = {
  validateTarget,
  runCdsInit,
  patchCdsrc,
  runCdsAddFrontend,
  patchMta,
  writeStubs,
  writeExtras,
  writeDocker,
  installDependencies,
  initializeGit,
}

export async function runProjectSteps(
  projectName,
  inputs,
  plan,
  options,
  steps = defaultProjectSteps,
  {
    confirm: promptRollback = confirm,
    printError = console.error,
    progress = { appendProgress, removeProgress, rollbackProject },
    signalEmitter = process,
    warn = console.warn,
  } = {},
) {
  let currentStep = 'validate target'
  let currentPolicy = 'validate'
  let projectMayExist = false
  let progressStarted = false
  let progressRemovedBeforeGit = false
  let interrupted = false
  const interruptError = new Error('Interrupted by SIGINT')

  const onSigint = () => {
    if (interrupted) return
    interrupted = { step: currentStep }
  }
  signalEmitter.on('SIGINT', onSigint)

  async function runStep(name, task, { log = true, policy = 'scaffold' } = {}) {
    currentStep = name
    currentPolicy = policy
    try {
      if (log && progressStarted) {
        currentPolicy = 'cleanup'
        await progress.appendProgress(projectName, name)
        currentPolicy = policy
        if (interrupted) throw interruptError
      }
      await task()
    } catch (error) {
      if (interrupted) throw interruptError
      throw error
    }
    if (interrupted) throw interruptError
  }

  async function handleInterrupt() {
    const rollback = await promptRollback({ message: 'Rollback? [Y/n]', initialValue: true })
    if (rollback === true || isCancel(rollback)) await progress.rollbackProject(projectName)
    else if (progressRemovedBeforeGit) await progress.appendProgress(projectName, 'initialize Git')
    throw interruptError
  }

  try {
    await runStep('validate target', () => steps.validateTarget(projectName, options), {
      log: false,
      policy: 'validate',
    })
    progressStarted = true
    projectMayExist = true
    await runStep('cds init', () => steps.runCdsInit({ name: projectName, facets: plan.facets }))
    await runStep('patch .cdsrc.json', () =>
      steps.patchCdsrc(projectName, { ...inputs, name: projectName }),
    )
    if (plan.addFrontend) {
      await runStep(
        'add frontend',
        () =>
          steps.runCdsAddFrontend(projectName, plan, { isInterrupted: () => Boolean(interrupted) }),
        { policy: 'frontend' },
      )
    }
    if (plan.patchMta) {
      await runStep('patch MTA', () =>
        steps.patchMta(projectName, {
          name: projectName,
          removePostgresDeployment: plan.removePostgresDeployment,
          patchRouterConfig: plan.patchRouter,
        }),
      )
    }
    let needsCdsTest
    await runStep('write stubs', async () => {
      needsCdsTest = await steps.writeStubs(projectName, { ...inputs, name: projectName })
    })
    await runStep('write project extras', () =>
      steps.writeExtras(projectName, {
        ...inputs,
        name: projectName,
        lang: inputs.lang,
        postgresDev: plan.postgresScripts,
        needsCdsTest,
      }),
    )
    if (plan.writeDocker) {
      await runStep('write Docker configuration', () =>
        steps.writeDocker(projectName, { name: projectName }),
      )
    }
    await runStep(
      'npm install',
      () =>
        steps.installDependencies(projectName, plan, { isInterrupted: () => Boolean(interrupted) }),
      { policy: 'install' },
    )

    // Record Git progress before removing the transient log so git add . cannot commit it.
    await runStep(
      'record Git progress',
      () => progress.appendProgress(projectName, 'initialize Git'),
      {
        log: false,
        policy: 'cleanup',
      },
    )
    progressRemovedBeforeGit = true
    await runStep('remove progress log', () => progress.removeProgress(projectName), {
      log: false,
      policy: 'cleanup',
    })
    progressStarted = false
    await runStep(
      'initialize Git',
      () => steps.initializeGit(projectName, { isInterrupted: () => Boolean(interrupted) }),
      { log: false, policy: 'git' },
    )
  } catch (error) {
    if (error === interruptError) await handleInterrupt()
    if (currentPolicy === 'validate') throw error
    if (currentPolicy === 'install') {
      printError(`Install failed. Resume with: cd ${projectName} && npm install`)
      throw error
    }
    if (currentPolicy === 'git') {
      warn(`Git initialization failed; project files remain available. ${error.message}`)
      return
    }

    printError(`Step failed: ${currentStep}`)
    if (currentPolicy === 'scaffold' && (options.noRollback || options.rollback === false)) {
      printError(`Partial project retained. Resume from the failed step in: ${projectName}`)
    } else if (projectMayExist) {
      await progress.rollbackProject(projectName)
    }
    throw error
  } finally {
    signalEmitter.removeListener('SIGINT', onSigint)
  }
}
