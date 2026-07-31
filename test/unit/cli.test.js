import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))

describe('capx CLI', () => {
  it('prints parsed arguments for the new command', () => {
    const output = execFileSync(process.execPath, [cli, 'new', 'foo', '--force'], {
      encoding: 'utf8',
    })

    expect(JSON.parse(output)).toEqual({ name: 'foo', force: true })
  })
})
