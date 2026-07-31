import { execa } from 'execa'

export async function checkMbt({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('mbt', ['--version'], { timeout: 3000 })
    return { name: 'mbt', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'mbt', ok: false, error }
  }
}
