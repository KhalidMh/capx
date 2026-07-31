import { describe, expect, it, vi } from 'vitest'
import { runCdsInit } from '../../src/steps/02-cds-init.js'

describe('runCdsInit', () => {
  it('initializes the project with the plan facets and inherited output', async () => {
    const exec = vi.fn().mockResolvedValue({})

    await runCdsInit(
      { name: 'minimal-app', facets: ['sqlite', 'hana', 'mta', 'test', 'lint'] },
      { exec },
    )

    expect(exec).toHaveBeenCalledWith(
      'cds',
      ['init', 'minimal-app', '--nodejs', '--add', 'sqlite,hana,mta,test,lint'],
      { stdio: 'inherit' },
    )
  })
})
