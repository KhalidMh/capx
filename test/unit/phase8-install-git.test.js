import { describe, expect, it, vi } from 'vitest'
import { runProjectSteps } from '../../src/commands/new.js'
import { initializeGit } from '../../src/steps/10-git-init.js'
import { installDependencies } from '../../src/steps/09-install-deps.js'

describe('installDependencies', () => {
  it('installs root, frontend, and router dependencies in sequence with inherited output', async () => {
    const exec = vi.fn().mockResolvedValue({})

    await installDependencies('/tmp/bookshop', { addFrontend: true, approuter: true }, { exec })

    expect(exec.mock.calls).toEqual([
      ['npm', ['install'], { cwd: '/tmp/bookshop', stdio: 'inherit' }],
      ['npm', ['install'], { cwd: '/tmp/bookshop/app/frontend', stdio: 'inherit' }],
      ['npm', ['install'], { cwd: '/tmp/bookshop/app/router', stdio: 'inherit' }],
    ])
  })

  it('installs only root dependencies when no frontend or router is selected', async () => {
    const exec = vi.fn().mockResolvedValue({})

    await installDependencies('/tmp/bookshop', { addFrontend: false, approuter: false }, { exec })

    expect(exec.mock.calls).toEqual([
      ['npm', ['install'], { cwd: '/tmp/bookshop', stdio: 'inherit' }],
    ])
  })

  it('propagates an install failure without attempting later installations', async () => {
    const failure = new Error('npm install failed')
    const exec = vi.fn().mockRejectedValue(failure)

    await expect(
      installDependencies('/tmp/bookshop', { addFrontend: true, approuter: true }, { exec }),
    ).rejects.toBe(failure)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('stops after root installation when interrupted before frontend installation', async () => {
    let interrupted = false
    const exec = vi.fn(async () => {
      interrupted = true
    })

    await expect(
      installDependencies(
        '/tmp/bookshop',
        { addFrontend: true, approuter: true },
        {
          exec,
          isInterrupted: () => interrupted,
        },
      ),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(exec.mock.calls).toEqual([
      ['npm', ['install'], { cwd: '/tmp/bookshop', stdio: 'inherit' }],
    ])
  })
})

describe('initializeGit', () => {
  it('initializes, stages, and commits the generated project', async () => {
    const exec = vi.fn().mockResolvedValue({})
    const warn = vi.fn()

    await initializeGit('/tmp/bookshop', { exec, warn })

    expect(exec.mock.calls).toEqual([
      ['git', ['init'], { cwd: '/tmp/bookshop', stdio: 'inherit' }],
      ['git', ['add', '.'], { cwd: '/tmp/bookshop', stdio: 'inherit' }],
      [
        'git',
        ['commit', '-m', 'Initial commit - project setup'],
        { cwd: '/tmp/bookshop', stdio: 'inherit' },
      ],
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and preserves the successful command result when Git fails', async () => {
    const error = new Error('Author identity unknown')
    const exec = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(error)
    const warn = vi.fn()

    await expect(initializeGit('/tmp/bookshop', { exec, warn })).resolves.toBeUndefined()

    expect(exec).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(
      'Git initialization failed; project files remain available for a manual commit. Author identity unknown',
    )
  })

  it('stops after git init when interrupted before staging or committing', async () => {
    let interrupted = false
    const exec = vi.fn(async () => {
      interrupted = true
    })
    const warn = vi.fn()

    await expect(
      initializeGit('/tmp/bookshop', { exec, isInterrupted: () => interrupted, warn }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(exec.mock.calls).toEqual([['git', ['init'], { cwd: '/tmp/bookshop', stdio: 'inherit' }]])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('runProjectSteps', () => {
  const inputs = { name: 'bookshop', lang: 'js' }
  const plan = { addFrontend: false, approuter: false, patchMta: false, writeDocker: false }

  function steps(overrides = {}) {
    return {
      validateTarget: vi.fn(),
      runCdsInit: vi.fn(),
      patchCdsrc: vi.fn(),
      runCdsAddFrontend: vi.fn(),
      patchMta: vi.fn(),
      writeStubs: vi.fn().mockResolvedValue(false),
      writeExtras: vi.fn(),
      writeDocker: vi.fn(),
      installDependencies: vi.fn(),
      initializeGit: vi.fn(),
      ...overrides,
    }
  }

  it('runs installation then Git after Phase H', async () => {
    const projectSteps = steps()

    await runProjectSteps('bookshop', inputs, plan, {}, projectSteps)

    expect(projectSteps.installDependencies).toHaveBeenCalledWith(
      'bookshop',
      plan,
      expect.objectContaining({ isInterrupted: expect.any(Function) }),
    )
    expect(projectSteps.initializeGit).toHaveBeenCalledWith(
      'bookshop',
      expect.objectContaining({ isInterrupted: expect.any(Function) }),
    )
    expect(projectSteps.installDependencies.mock.invocationCallOrder[0]).toBeGreaterThan(
      projectSteps.writeExtras.mock.invocationCallOrder[0],
    )
    expect(projectSteps.initializeGit.mock.invocationCallOrder[0]).toBeGreaterThan(
      projectSteps.installDependencies.mock.invocationCallOrder[0],
    )
  })

  it('prints a root install resume command and propagates the failure', async () => {
    const error = new Error('network unavailable')
    const projectSteps = steps({ installDependencies: vi.fn().mockRejectedValue(error) })
    const printError = vi.fn()

    await expect(
      runProjectSteps('bookshop', inputs, plan, {}, projectSteps, { printError }),
    ).rejects.toBe(error)

    expect(printError).toHaveBeenCalledWith(
      'Install failed. Resume with: cd bookshop && npm install',
    )
    expect(projectSteps.initializeGit).not.toHaveBeenCalled()
  })
})
