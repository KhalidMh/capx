import { execa } from 'execa'

export async function checkCdsDk({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('cds', ['--version'], { timeout: 3000 })
    const match = stdout.match(/@sap\/cds-dk(?:\s*:\s*|\s+(?:\([^)]*\)\s+)?)(\d+)/i)
    const major = match ? Number.parseInt(match[1], 10) : undefined
    return { name: 'cds-dk', ok: major >= 10, major, version: stdout.trim() }
  } catch (error) {
    return { name: 'cds-dk', ok: false, error }
  }
}
