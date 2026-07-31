import { describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()

vi.mock('node:fs/promises', () => ({ readFile }))

const { getInstallHint } = await import('../../src/doctor/install-hints.js')

describe('Linux install hints', () => {
  it('returns the official Debian repository setup and cf CLI v8 install commands', async () => {
    readFile.mockResolvedValueOnce('ID=debian')

    await expect(getInstallHint('cf', { platform: 'linux' })).resolves.toBe(
      'wget -q -O - https://packages.cloudfoundry.org/debian/cli.cloudfoundry.org.key | sudo gpg --dearmor -o /usr/share/keyrings/cli.cloudfoundry.org.gpg\n' +
        'echo "deb [signed-by=/usr/share/keyrings/cli.cloudfoundry.org.gpg] https://packages.cloudfoundry.org/debian stable main" | sudo tee /etc/apt/sources.list.d/cloudfoundry-cli.list\n' +
        'sudo apt-get update\n' +
        'sudo apt-get install cf8-cli',
    )
  })

  it('returns the official Fedora repository setup and cf CLI v8 install commands', async () => {
    readFile.mockResolvedValueOnce('ID=fedora')

    await expect(getInstallHint('cf', { platform: 'linux' })).resolves.toBe(
      'sudo wget -O /etc/yum.repos.d/cloudfoundry-cli.repo https://packages.cloudfoundry.org/fedora/cloudfoundry-cli.repo\n' +
        'sudo yum install cf8-cli',
    )
  })

  it('returns the vendor URL when the Linux distribution is unknown', async () => {
    readFile.mockResolvedValueOnce('ID=alpine')

    await expect(getInstallHint('cf', { platform: 'linux' })).resolves.toBe(
      'https://docs.cloudfoundry.org/cf-cli/install-go-cli.html',
    )
  })

  it('returns the cf CLI v8 winget package on Windows', async () => {
    await expect(getInstallHint('cf', { platform: 'win32' })).resolves.toBe(
      'winget install CloudFoundry.CLI.v8 (or use WSL)',
    )
  })

  it('returns the multiapps vendor URL when the Linux distribution is unknown', async () => {
    readFile.mockResolvedValueOnce('ID=alpine')

    await expect(getInstallHint('mta-cf-plugin', { platform: 'linux' })).resolves.toBe(
      'https://github.com/cloudfoundry/multiapps-cli-plugin',
    )
  })
})
