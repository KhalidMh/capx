import { execa } from 'execa'

export async function initializeGit(
  projectDirectory,
  { exec = execa, isInterrupted = () => false, warn = console.warn } = {},
) {
  try {
    await exec('git', ['init'], { cwd: projectDirectory, stdio: 'inherit' })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
    await exec('git', ['add', '.'], { cwd: projectDirectory, stdio: 'inherit' })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
    await exec('git', ['commit', '-m', 'Initial commit - project setup'], {
      cwd: projectDirectory,
      stdio: 'inherit',
    })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
  } catch (error) {
    if (isInterrupted()) throw error
    warn(
      `Git initialization failed; project files remain available for a manual commit. ${error.message}`,
    )
  }
}
