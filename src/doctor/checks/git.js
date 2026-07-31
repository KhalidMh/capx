import { execa } from 'execa'

export async function checkGit({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('git', ['--version'], { timeout: 3000 })
    return { name: 'git', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'git', ok: false, error }
  }
}
