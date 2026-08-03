import { execa } from 'execa'

export async function checkDocker({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('docker', ['--version'], { timeout: 3000 })
    try {
      await execute('docker', ['compose', 'version'], { timeout: 3000 })
    } catch (error) {
      return { name: 'docker', ok: false, reason: 'missingCompose', error }
    }
    return { name: 'docker', ok: true, version: stdout.trim() }
  } catch (error) {
    return { name: 'docker', ok: false, reason: 'missingDocker', error }
  }
}
