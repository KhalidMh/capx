import { execa } from 'execa'

export async function checkNpm({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('npm', ['--version'], { timeout: 3000 })
    return { name: 'npm', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'npm', ok: false, error }
  }
}
