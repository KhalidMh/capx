import { execa } from 'execa'

export async function runCdsAddFrontend(
  projectDirectory,
  { postInitFacets },
  { exec = execa } = {},
) {
  for (const facet of postInitFacets) {
    const args = facet === 'html5-repo' ? ['add', facet] : ['add', facet, '--into', 'frontend']
    await exec('cds', args, { cwd: projectDirectory, stdio: 'inherit' })
  }
}
