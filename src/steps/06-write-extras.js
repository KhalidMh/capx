import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, writeJson } from '../utils/json.js'
import { writeFileAtomic } from '../utils/fs.js'

const capxGitignoreEntries = ['.env', 'dist/']

const requiredScripts = {
  watch: 'cds watch',
  build: 'cds build',
  lint: 'cds lint',
  test: 'node --test',
  format: 'prettier --write "**/*.{js,ts,cds,json,md,yaml,yml}"',
}

export async function writeExtras(
  projectDirectory,
  { name, lang, devDb, prodDb, auth, postgresDev = false, needsCdsTest = false },
) {
  await Promise.all([
    writeFileAtomic(join(projectDirectory, '.prettierrc'), await template('prettierrc.json')),
    writeFileAtomic(join(projectDirectory, '.editorconfig'), await template('editorconfig')),
    writeFileAtomic(
      join(projectDirectory, 'README.md'),
      render(await template('README.md.tmpl'), { name, devDb, prodDb, auth }),
    ),
  ])
  await patchGitignore(projectDirectory)
  await patchPackage(projectDirectory, { lang, postgresDev, needsCdsTest })
  if (lang === 'ts') await patchTsconfig(projectDirectory)
}

async function patchGitignore(projectDirectory) {
  const path = join(projectDirectory, '.gitignore')
  let current = ''
  try {
    current = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const lines = new Set(current.split(/\r?\n/).filter(Boolean))
  const additions = capxGitignoreEntries.filter((entry) => !lines.has(entry))
  if (additions.length === 0) return
  await writeFileAtomic(path, `${current.replace(/\s*$/, '')}\n${additions.join('\n')}\n`)
}

async function patchPackage(projectDirectory, { lang, postgresDev, needsCdsTest }) {
  const path = join(projectDirectory, 'package.json')
  const packageJson = await readJson(path)
  packageJson.scripts ??= {}
  for (const [script, command] of Object.entries(requiredScripts)) {
    packageJson.scripts[script] ??= command
  }
  if (postgresDev) {
    packageJson.scripts['db:up'] ??= 'docker compose up -d'
    packageJson.scripts['db:down'] ??= 'docker compose down'
  }
  packageJson.devDependencies ??= {}
  packageJson.devDependencies.prettier ??= '^3'
  if (lang === 'ts') packageJson.devDependencies['@cap-js/cds-types'] ??= '^0.18.0'
  if (needsCdsTest) packageJson.devDependencies['@cap-js/cds-test'] ??= '^1'
  await writeJson(path, packageJson)
}

async function patchTsconfig(projectDirectory) {
  const path = join(projectDirectory, 'tsconfig.json')
  const tsconfig = await readJson(path)
  tsconfig.compilerOptions ??= {}
  tsconfig.compilerOptions.types ??= []
  if (!tsconfig.compilerOptions.types.includes('@cap-js/cds-types')) {
    tsconfig.compilerOptions.types.push('@cap-js/cds-types')
  }
  await writeJson(path, tsconfig)
}

async function template(name) {
  return readFile(new URL(`../templates/${name}`, import.meta.url), 'utf8')
}

function render(contents, values) {
  return contents.replaceAll(/{{(\w+)}}/g, (_, name) => values[name])
}
