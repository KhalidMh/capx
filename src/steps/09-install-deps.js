import { execa } from 'execa'
import { join } from 'node:path'

export async function installDependencies(
  projectDirectory,
  { addFrontend, approuter },
  { exec = execa } = {},
) {
  await exec('npm', ['install'], { cwd: projectDirectory, stdio: 'inherit' })
  if (addFrontend) {
    await exec('npm', ['install'], {
      cwd: join(projectDirectory, 'app', 'frontend'),
      stdio: 'inherit',
    })
  }
  if (approuter) {
    await exec('npm', ['install'], {
      cwd: join(projectDirectory, 'app', 'router'),
      stdio: 'inherit',
    })
  }
}
