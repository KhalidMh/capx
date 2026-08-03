import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProjectSteps } from '../../src/commands/new.js'
import { appendProgress, removeProgress, rollbackProject } from '../../src/utils/rollback.js'

const directories = []
const inputs = { name: 'bookshop', lang: 'js' }
const fullPlan = {
  addFrontend: true,
  approuter: false,
  patchMta: true,
  writeDocker: true,
  postgresScripts: false,
  removePostgresDeployment: false,
  patchRouter: false,
  facets: [],
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function projectDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'capx-rollback-'))
  directories.push(directory)
  return join(directory, 'bookshop')
}

function createSteps(project, overrides = {}) {
  return {
    validateTarget: vi.fn(),
    runCdsInit: vi.fn(async () => {
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'package.json'), '{}')
    }),
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

describe('runProjectSteps rollback', () => {
  it.each([
    ['patch .cdsrc.json', 'patchCdsrc'],
    ['patch MTA', 'patchMta'],
    ['write stubs', 'writeStubs'],
    ['write project extras', 'writeExtras'],
    ['write Docker configuration', 'writeDocker'],
  ])('removes the project when %s fails before dependency installation', async (_, step) => {
    const project = await projectDirectory()
    const error = new Error('injected failure')
    const steps = createSteps(project, { [step]: vi.fn().mockRejectedValue(error) })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, { printError: vi.fn() }),
    ).rejects.toBe(error)

    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['patch .cdsrc.json', 'patchCdsrc'],
    ['patch MTA', 'patchMta'],
    ['write stubs', 'writeStubs'],
    ['write project extras', 'writeExtras'],
    ['write Docker configuration', 'writeDocker'],
  ])(
    'retains partial state and prints resume guidance when %s fails with --no-rollback',
    async (name, step) => {
      const project = await projectDirectory()
      const printError = vi.fn()
      const error = new Error('injected failure')
      const steps = createSteps(project, { [step]: vi.fn().mockRejectedValue(error) })

      await expect(
        runProjectSteps(project, inputs, fullPlan, { noRollback: true }, steps, { printError }),
      ).rejects.toBe(error)

      await expect(access(project)).resolves.toBeUndefined()
      expect(printError).toHaveBeenCalledWith(`Step failed: ${name}`)
      expect(printError).toHaveBeenCalledWith(
        `Partial project retained. Resume from the failed step in: ${project}`,
      )
    },
  )

  it.each(['the first frontend add', 'the deferred html5-repo add'])(
    'removes the project when %s fails even with --no-rollback',
    async (phase) => {
      const project = await projectDirectory()
      const error = new Error(`${phase} failed`)
      const printError = vi.fn()
      const steps = createSteps(project, { runCdsAddFrontend: vi.fn().mockRejectedValue(error) })

      await expect(
        runProjectSteps(project, inputs, fullPlan, { noRollback: true }, steps, { printError }),
      ).rejects.toBe(error)

      expect(printError).toHaveBeenCalledWith('Step failed: add frontend')
      expect(printError).not.toHaveBeenCalledWith(
        `Partial project retained. Resume from the failed step in: ${project}`,
      )
      await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('removes a partial cds init target by default', async () => {
    const project = await projectDirectory()
    const error = new Error('cds init failed')
    const steps = createSteps(project, {
      runCdsInit: vi.fn(async () => {
        await mkdir(project, { recursive: true })
        await writeFile(join(project, 'partial'), '')
        throw error
      }),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, { printError: vi.fn() }),
    ).rejects.toBe(error)

    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains the progress log when partial cds init fails with --no-rollback', async () => {
    const project = await projectDirectory()
    const error = new Error('cds init failed')
    const printError = vi.fn()
    const steps = createSteps(project, {
      runCdsInit: vi.fn(async () => {
        await mkdir(project, { recursive: true })
        await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('cds init')
        throw error
      }),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, { noRollback: true }, steps, {
        printError,
      }),
    ).rejects.toBe(error)

    await expect(access(project)).resolves.toBeUndefined()
    await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('cds init')
    expect(printError).toHaveBeenCalledWith('Step failed: cds init')
    expect(printError).toHaveBeenCalledWith(
      `Partial project retained. Resume from the failed step in: ${project}`,
    )
  })

  it('retains the project and progress log when installation fails', async () => {
    const project = await projectDirectory()
    const error = new Error('network unavailable')
    const printError = vi.fn()
    const steps = createSteps(project, { installDependencies: vi.fn().mockRejectedValue(error) })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, { printError }),
    ).rejects.toBe(error)

    await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('npm install')
    expect(printError).toHaveBeenCalledWith(
      `Install failed. Resume with: cd ${project} && npm install`,
    )
  })

  it('treats an injected Git failure as a warning and removes the log before Git runs', async () => {
    const project = await projectDirectory()
    const warn = vi.fn()
    const error = new Error('git unavailable')
    const steps = createSteps(project, {
      initializeGit: vi.fn(async () => {
        await expect(access(join(project, '.capx-log'))).rejects.toMatchObject({ code: 'ENOENT' })
        throw error
      }),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, { printError: vi.fn(), warn }),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(
      `Git initialization failed; project files remain available. ${error.message}`,
    )
  })

  it('writes a progress log during execution and deletes it after success', async () => {
    const project = await projectDirectory()
    const progress = {
      appendProgress: vi.fn(appendProgress),
      removeProgress: vi.fn(removeProgress),
      rollbackProject,
    }
    const steps = createSteps(project, {
      installDependencies: vi.fn(async () => {
        await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('npm install')
      }),
    })

    await runProjectSteps(project, inputs, fullPlan, {}, steps, { printError: vi.fn(), progress })

    expect(progress.appendProgress).toHaveBeenCalledWith(project, 'initialize Git')
    expect(progress.removeProgress).toHaveBeenCalledWith(project)
    await expect(access(join(project, '.capx-log'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('classifies progress-log deletion failures as their own rollback step', async () => {
    const project = await projectDirectory()
    const error = new Error('cannot remove log')
    const printError = vi.fn()
    const progress = {
      appendProgress,
      removeProgress: vi.fn().mockRejectedValue(error),
      rollbackProject,
    }

    await expect(
      runProjectSteps(project, inputs, fullPlan, { noRollback: true }, createSteps(project), {
        printError,
        progress,
      }),
    ).rejects.toBe(error)

    expect(printError).toHaveBeenCalledWith('Step failed: remove progress log')
    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prompts after a SIGINT during install and retains state when rollback is declined', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const installDependencies = vi.fn(async () => {
      signalEmitter.emit('SIGINT')
      signalEmitter.emit('SIGINT')
    })
    const steps = createSteps(project, { installDependencies })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith({ message: 'Rollback? [Y/n]', initialValue: true })
    expect(steps.initializeGit).not.toHaveBeenCalled()
    await expect(access(project)).resolves.toBeUndefined()
    await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('npm install')
  })

  it('uses the install interruption callback to enter the SIGINT prompt path', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const installDependencies = vi.fn(async (_directory, _plan, { isInterrupted }) => {
      signalEmitter.emit('SIGINT')
      if (isInterrupted()) throw new Error('Interrupted by SIGINT')
    })
    const steps = createSteps(project, { installDependencies })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(installDependencies).toHaveBeenCalledWith(
      project,
      fullPlan,
      expect.objectContaining({ isInterrupted: expect.any(Function) }),
    )
    expect(confirm).toHaveBeenCalledWith({ message: 'Rollback? [Y/n]', initialValue: true })
  })

  it('uses the SIGINT rollback decision during Git even with --no-rollback', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(true)
    const steps = createSteps(project, {
      initializeGit: vi.fn(async () => signalEmitter.emit('SIGINT')),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, { noRollback: true }, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(confirm).toHaveBeenCalledWith({ message: 'Rollback? [Y/n]', initialValue: true })
    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the Git interruption callback to enter the SIGINT prompt path', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const initializeGit = vi.fn(async (_directory, { isInterrupted }) => {
      signalEmitter.emit('SIGINT')
      if (isInterrupted()) throw new Error('Interrupted by SIGINT')
    })
    const steps = createSteps(project, { initializeGit })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(initializeGit).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ isInterrupted: expect.any(Function) }),
    )
    expect(confirm).toHaveBeenCalledWith({ message: 'Rollback? [Y/n]', initialValue: true })
  })

  it('does not start another phase after a SIGINT between atomic tasks', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const steps = createSteps(project, {
      patchCdsrc: vi.fn(async () => signalEmitter.emit('SIGINT')),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(steps.runCdsAddFrontend).not.toHaveBeenCalled()
  })

  it('does not start a task when its progress record receives SIGINT', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const steps = createSteps(project)
    const progress = {
      appendProgress: vi.fn(async (directory, step) => {
        await appendProgress(directory, step)
        if (step === 'patch .cdsrc.json') signalEmitter.emit('SIGINT')
      }),
      removeProgress,
      rollbackProject,
    }

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        progress,
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    expect(steps.patchCdsrc).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith({ message: 'Rollback? [Y/n]', initialValue: true })
  })

  it('restores the Git progress log when SIGINT during Git is retained', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const steps = createSteps(project, {
      initializeGit: vi.fn(async () => signalEmitter.emit('SIGINT')),
    })

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        confirm,
        printError: vi.fn(),
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('initialize Git')
  })

  it('restores the progress log when SIGINT interrupts its removal and rollback is declined', async () => {
    const project = await projectDirectory()
    const signalEmitter = new EventEmitter()
    const confirm = vi.fn().mockResolvedValue(false)
    const progress = {
      appendProgress,
      removeProgress: vi.fn(async (directory) => {
        await removeProgress(directory)
        signalEmitter.emit('SIGINT')
      }),
      rollbackProject,
    }

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, createSteps(project), {
        confirm,
        printError: vi.fn(),
        progress,
        signalEmitter,
      }),
    ).rejects.toThrow('Interrupted by SIGINT')

    await expect(readFile(join(project, '.capx-log'), 'utf8')).resolves.toContain('initialize Git')
  })

  it('rolls back when recording Git progress fails instead of treating it as a Git warning', async () => {
    const project = await projectDirectory()
    const error = new Error('cannot record Git progress')
    const progress = {
      appendProgress: vi.fn(async (directory, step) => {
        if (step === 'initialize Git') throw error
        await appendProgress(directory, step)
      }),
      removeProgress: vi.fn(),
      rollbackProject,
    }

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, createSteps(project), {
        printError: vi.fn(),
        progress,
        warn: vi.fn(),
      }),
    ).rejects.toBe(error)

    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back when recording npm install progress fails', async () => {
    const project = await projectDirectory()
    const error = new Error('cannot record install progress')
    const steps = createSteps(project)
    const progress = {
      appendProgress: vi.fn(async (directory, step) => {
        if (step === 'npm install') throw error
        await appendProgress(directory, step)
      }),
      removeProgress: vi.fn(),
      rollbackProject,
    }

    await expect(
      runProjectSteps(project, inputs, fullPlan, {}, steps, {
        printError: vi.fn(),
        progress,
      }),
    ).rejects.toBe(error)

    expect(steps.installDependencies).not.toHaveBeenCalled()
    await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
