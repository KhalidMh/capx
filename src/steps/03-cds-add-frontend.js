import { execa } from 'execa'

export async function runCdsAddFrontend(
  projectDirectory,
  { postInitFacets },
  { exec = execa, isInterrupted = () => false } = {},
) {
  for (const facet of postInitFacets) {
    const args = facet === 'html5-repo' ? ['add', facet] : ['add', facet, '--into', 'frontend']
    await exec('cds', args, { cwd: projectDirectory, stdio: 'inherit' })
    if (isInterrupted()) throw new Error('Interrupted by SIGINT')
  }
}
