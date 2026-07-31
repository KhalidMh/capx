import { cancel, isCancel } from '@clack/prompts'
import { buildPlan } from '../decision-matrix.js'
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
import { patchCdsrc } from '../steps/04-patch-cdsrc.js'
import { writeExtras } from '../steps/06-write-extras.js'
import { writeStubs } from '../steps/08-write-stubs.js'

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
  if (devDb === 'postgres' && !(await runDockerCheck())) return
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
    await validateTarget(projectName, options)
    await runCdsInit({ name: projectName, facets: plan.facets })
    await patchCdsrc(projectName, { ...inputs, name: projectName })
    const needsCdsTest = await writeStubs(projectName, { ...inputs, name: projectName })
    await writeExtras(projectName, { ...inputs, name: projectName, needsCdsTest })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
