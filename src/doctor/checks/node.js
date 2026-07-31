const minimumMajor = 22

export async function checkNode({ version = process.version } = {}) {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0], 10)
  return {
    name: 'node',
    ok: Number.isInteger(major) && major >= minimumMajor,
    major,
    version,
  }
}
