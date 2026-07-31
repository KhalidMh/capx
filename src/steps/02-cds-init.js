import { execa } from 'execa'

export async function runCdsInit({ name, facets }, { exec = execa } = {}) {
  await exec('cds', ['init', name, '--nodejs', '--add', facets.join(',')], { stdio: 'inherit' })
}
