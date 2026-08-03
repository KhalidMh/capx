import { execa } from 'execa'
import { join } from 'node:path'

export async function installDependencies(
  projectDirectory,
  { addFrontend, approuter },
  { exec = execa, isInterrupted = () => false } = {},
) {
  await exec('npm', ['install'], { cwd: projectDirectory, stdio: 'inherit' })
  if (isInterrupted()) throw new Error('Interrupted by SIGINT')
  if (addFrontend) {
    await exec('npm', ['install'], {
      cwd: join(projectDirectory, 'app', 'frontend'),
      stdio: 'inherit',
    })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
  }
  if (approuter) {
    await exec('npm', ['install'], {
      cwd: join(projectDirectory, 'app', 'router'),
      stdio: 'inherit',
    })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
  }
}
