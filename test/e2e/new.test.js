import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/capx.js', import.meta.url))

function runCli(args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args)
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('capx did not finish'))
    }, 1000)
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      onOutput(child, output, chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code, output })
    })
  })
}

function runNew(name, answers, options = {}) {
  const args = [cli, 'new']
  if (name) args.push(name)
  if (options.force) args.push('--force')
  let unreadOutput = ''
  let answerIndex = 0

  return runCli(args, (child, output, chunk) => {
    unreadOutput += chunk
    while (true) {
      const prompt = answers[answerIndex]?.prompt
      if (!prompt || !unreadOutput.includes(prompt)) break
      child.stdin.write(answers[answerIndex].input)
      answerIndex += 1
      unreadOutput = ''
      if (answerIndex === answers.length) child.stdin.end()
    }
  }).then(({ code, output }) => {
    if (code !== 0) throw new Error(`capx exited with ${code}: ${output}`)
    const result = output.match(/\{[^\n]*\}/)?.[0]
    if (!result) throw new Error(`capx did not return JSON: ${output}`)
    return { result: JSON.parse(result), transcript: output }
  })
}

function runCancelledNew(name) {
  return runCli([cli, 'new', name], (child, output) => {
    if (output.includes('Backend language?')) child.stdin.write('\u001b')
  })
}

function runInvalidNew(name) {
  return runCli([cli, 'new', name], (child, output) => {
    if (output.includes('Backend language?')) child.stdin.write('\u001b')
  })
}

describe('capx new', () => {
  it('rejects an invalid positional project name before prompting', async () => {
    const result = await runInvalidNew('../invalid')

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Must start with alphanumeric or _')
    expect(result.output).not.toContain('Backend language?')
  })

  it('prompts for a missing project name', async () => {
    const result = await runNew(undefined, [
      { prompt: 'Project name?', input: 'prompted-app\r' },
      { prompt: 'Backend language?', input: '\r' },
      { prompt: 'Database for local development?', input: '\r' },
      { prompt: 'Database for production?', input: '\r' },
      { prompt: 'Authentication?', input: '\x1b[A\r' },
      { prompt: 'Frontend framework?', input: '\r' },
      { prompt: 'Proceed?', input: '\r' },
    ])

    expect(result.result.name).toBe('prompted-app')
  })

  it('prints the minimal JavaScript SQLite and HANA facet list', async () => {
    const result = await runNew('minimal-app', [
      { prompt: 'Backend language?', input: '\r' },
      { prompt: 'Database for local development?', input: '\r' },
      { prompt: 'Database for production?', input: '\r' },
      { prompt: 'Authentication?', input: '\x1b[A\r' },
      { prompt: 'Frontend framework?', input: '\r' },
      { prompt: 'Proceed?', input: '\r' },
    ])

    expect(result.result.facets).toEqual(['sqlite', 'hana', 'mta', 'test', 'lint'])
  })

  it('preserves --force in the dry-run output', async () => {
    const result = await runNew(
      'force-app',
      [
        { prompt: 'Backend language?', input: '\r' },
        { prompt: 'Database for local development?', input: '\r' },
        { prompt: 'Database for production?', input: '\r' },
        { prompt: 'Authentication?', input: '\x1b[A\r' },
        { prompt: 'Frontend framework?', input: '\r' },
        { prompt: 'Proceed?', input: '\r' },
      ],
      { force: true },
    )

    expect(result.result.force).toBe(true)
  })

  it('prints the TypeScript and XSUAA facet list', async () => {
    const result = await runNew('secure-app', [
      { prompt: 'Backend language?', input: '\x1b[B\r' },
      { prompt: 'Database for local development?', input: '\r' },
      { prompt: 'Database for production?', input: '\r' },
      { prompt: 'Authentication?', input: '\r' },
      { prompt: 'Frontend framework?', input: '\r' },
      { prompt: 'Proceed?', input: '\r' },
    ])

    expect(result.result.facets).toEqual([
      'typescript',
      'typer',
      'sqlite',
      'hana',
      'xsuaa',
      'approuter',
      'destination',
      'mta',
      'test',
      'lint',
    ])
  })

  it('prints the Postgres, IAS, React, and approuter facet list', async () => {
    const result = await runNew('full-app', [
      { prompt: 'Backend language?', input: '\r' },
      { prompt: 'Database for local development?', input: '\x1b[B\r' },
      { prompt: 'Database for production?', input: '\x1b[B\r' },
      { prompt: 'Authentication?', input: '\x1b[B\r' },
      { prompt: 'Frontend framework?', input: '\x1b[B\x1b[B\r' },
      { prompt: 'Proceed?', input: '\r' },
    ])

    expect(result.result.facets).toEqual([
      'postgres',
      'ias',
      'approuter',
      'destination',
      'html5-repo',
      'mta',
      'test',
      'lint',
    ])
  })

  it('shows the selected configuration summary before Proceed', async () => {
    const result = await runNew('summary-app', [
      { prompt: 'Backend language?', input: '\x1b[B\r' },
      { prompt: 'Database for local development?', input: '\x1b[B\r' },
      { prompt: 'Database for production?', input: '\r' },
      { prompt: 'Authentication?', input: '\r' },
      { prompt: 'Frontend framework?', input: '\x1b[B\r' },
      { prompt: 'Proceed?', input: '\r' },
    ])

    expect(result.transcript).toContain('• Backend:     TypeScript')
    expect(result.transcript).toContain('• Dev DB:      PostgreSQL (Docker)')
    expect(result.transcript).toContain('• Prod DB:     SAP HANA Cloud')
    expect(result.transcript).toContain('• Auth:        XSUAA (mocked in dev)')
    expect(result.transcript).toContain('• Frontend:    Vue (Vite) → app/frontend')
    expect(result.transcript).toContain('• Approuter:   Yes (auto)')
    expect(result.transcript).toContain('• Deployment:  MTA → Cloud Foundry')
    expect(result.transcript.indexOf('• Backend:')).toBeLessThan(
      result.transcript.indexOf('Proceed?'),
    )
  })

  it('exits 1 with Cancelled when a prompt is cancelled', async () => {
    const result = await runCancelledNew('cancelled-app')

    expect(result.code).toBe(1)
    expect(result.output).toContain('Cancelled')
  })
})
