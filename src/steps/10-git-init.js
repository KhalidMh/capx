import { execa } from 'execa'

export async function initializeGit(projectDirectory, { exec = execa, warn = console.warn } = {}) {
  try {
    await exec('git', ['init'], { cwd: projectDirectory, stdio: 'inherit' })
    await exec('git', ['add', '.'], { cwd: projectDirectory, stdio: 'inherit' })
    await exec('git', ['commit', '-m', 'Initial commit - project setup'], {
      cwd: projectDirectory,
      stdio: 'inherit',
    })
  } catch (error) {
    warn(
      `Git initialization failed; project files remain available for a manual commit. ${error.message}`,
    )
  }
}
