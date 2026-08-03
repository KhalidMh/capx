import { appendFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function progressLog(projectDirectory) {
  return join(projectDirectory, '.capx-log')
}

export async function appendProgress(projectDirectory, step) {
  const log = progressLog(projectDirectory)
  await mkdir(dirname(log), { recursive: true })
  await appendFile(log, `${step}\n`)
}

export function removeProgress(projectDirectory) {
  return rm(progressLog(projectDirectory), { force: true })
}

export function rollbackProject(projectDirectory) {
  return rm(projectDirectory, { force: true, recursive: true })
}
