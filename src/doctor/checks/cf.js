import { execa } from 'execa'

export async function checkCf({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('cf', ['--version'], { timeout: 3000 })
    return { name: 'cf', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'cf', ok: false, error }
  }
}
