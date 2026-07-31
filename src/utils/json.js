import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './fs.js'

export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(target[key]) && isObject(value)) {
      deepMerge(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

export async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJson(path, value) {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
