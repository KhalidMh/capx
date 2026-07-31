import { readFile } from 'node:fs/promises'

const vendorDocs = {
  cf: 'https://docs.cloudfoundry.org/cf-cli/install-go-cli.html',
  docker: 'https://docs.docker.com/engine/install/',
  git: 'https://git-scm.com/downloads',
  'mta-cf-plugin': 'https://github.com/cloudfoundry/multiapps-cli-plugin',
}

async function linuxPackageManager() {
  try {
    const release = await readFile('/etc/os-release', 'utf8')
    if (/^(ID|ID_LIKE)=.*(?:debian|ubuntu)/m.test(release)) return 'apt'
    if (/^(ID|ID_LIKE)=.*(?:fedora|rhel|centos)/m.test(release)) return 'dnf'
  } catch {
    // Fall back to the vendor documentation when the distribution is unknown.
  }
}

export async function getInstallHint(tool, { platform = process.platform } = {}) {
  if (platform === 'darwin') {
    return {
      git: 'brew install git',
      cf: 'brew install cloudfoundry/tap/cf-cli@8',
      docker: 'brew install --cask docker',
      'mta-cf-plugin': 'cf install-plugin -r CF-Community "multiapps" -f',
    }[tool]
  }

  if (platform === 'win32') {
    return {
      git: 'winget install Git.Git',
      cf: 'winget install CloudFoundry.CLI.v8 (or use WSL)',
      docker: 'winget install Docker.DockerDesktop',
      'mta-cf-plugin': 'cf install-plugin -r CF-Community "multiapps" -f',
    }[tool]
  }

  if (platform === 'linux') {
    const manager = await linuxPackageManager()
    if (manager === 'apt' && tool === 'git') return 'sudo apt install git'
    if (manager === 'dnf' && tool === 'git') return 'sudo dnf install git'
    if (manager === 'apt' && tool === 'cf') {
      return (
        'wget -q -O - https://packages.cloudfoundry.org/debian/cli.cloudfoundry.org.key | sudo gpg --dearmor -o /usr/share/keyrings/cli.cloudfoundry.org.gpg\n' +
        'echo "deb [signed-by=/usr/share/keyrings/cli.cloudfoundry.org.gpg] https://packages.cloudfoundry.org/debian stable main" | sudo tee /etc/apt/sources.list.d/cloudfoundry-cli.list\n' +
        'sudo apt-get update\n' +
        'sudo apt-get install cf8-cli'
      )
    }
    if (manager === 'dnf' && tool === 'cf') {
      return (
        'sudo wget -O /etc/yum.repos.d/cloudfoundry-cli.repo https://packages.cloudfoundry.org/fedora/cloudfoundry-cli.repo\n' +
        'sudo yum install cf8-cli'
      )
    }
    if (manager === 'apt' && tool === 'docker') return 'sudo apt install docker.io'
    if (manager === 'dnf' && tool === 'docker') return 'sudo dnf install docker'
    if (manager && tool === 'mta-cf-plugin') {
      return 'cf install-plugin -r CF-Community "multiapps" -f'
    }
  }

  return vendorDocs[tool]
}
