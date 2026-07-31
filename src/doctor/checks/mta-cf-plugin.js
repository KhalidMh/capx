import { execa } from 'execa'

export async function checkMtaCfPlugin({ execute = execa } = {}) {
  try {
    const { stdout } = await execute('cf', ['plugins'], { timeout: 3000 })
    return {
      name: 'mta-cf-plugin',
      ok: /(^|\n)\s*multiapps\b/im.test(stdout),
      version: stdout.trim(),
    }
  } catch (error) {
    return { name: 'mta-cf-plugin', ok: false, error }
  }
}
