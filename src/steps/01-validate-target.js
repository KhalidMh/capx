import { lstat, rm } from 'node:fs/promises'

export async function validateTarget(target, { force = false } = {}) {
  try {
    await lstat(target)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  if (!force) throw new Error('Directory exists. Use --force to overwrite.')
  await rm(target, { force: true, recursive: true })
}
