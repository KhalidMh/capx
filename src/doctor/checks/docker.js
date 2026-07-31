import { execa } from 'execa'

export async function checkDocker({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('docker', ['--version'], { timeout: 3000 })
    return { name: 'docker', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'docker', ok: false, error }
  }
}
