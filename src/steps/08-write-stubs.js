import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../utils/fs.js'

export async function writeStubs(projectDirectory, { name, lang }) {
  const cdsName = name.replaceAll('-', '_')
  await Promise.all([
    writeTemplate(projectDirectory, 'db/schema.cds', 'schema.cds.tmpl', { name: cdsName }),
    writeTemplate(projectDirectory, 'srv/cat-service.cds', 'cat-service.cds.tmpl', {
      name: cdsName,
    }),
    writeTemplate(projectDirectory, `srv/cat-service.${lang}`, `cat-service.${lang}.tmpl`, {
      name,
    }),
  ])
  if (!(await hasGeneratedTest(join(projectDirectory, 'test')))) {
    await writeTemplate(projectDirectory, 'test/smoke.test.js', 'smoke.test.js.tmpl', { name })
    return true
  }
  return false
}

async function hasGeneratedTest(testDirectory) {
  try {
    const files = await readdir(testDirectory, { recursive: true })
    return files.some((file) => /(?:test|spec)\.(?:[cm]?[jt]s)$/u.test(file))
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function writeTemplate(projectDirectory, destination, template, values) {
  const contents = await templateFile(template)
  await writeFileAtomic(join(projectDirectory, destination), render(contents, values))
}

async function templateFile(name) {
  const { readFile } = await import('node:fs/promises')
  return readFile(new URL(`../templates/${name}`, import.meta.url), 'utf8')
}

function render(contents, values) {
  return contents.replaceAll(/{{(\w+)}}/g, (_, name) => values[name])
}
