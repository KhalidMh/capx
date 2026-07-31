import { join } from 'node:path'
import { deepMerge, readJson, writeJson } from '../utils/json.js'

const securityEntries = {
  scopes: [
    { name: '$XSAPPNAME.Admin', description: 'Administrator access' },
    { name: '$XSAPPNAME.User', description: 'User access' },
  ],
  'role-templates': [
    {
      name: 'Admin',
      description: 'Administrator',
      'scope-references': ['$XSAPPNAME.Admin'],
    },
    {
      name: 'User',
      description: 'User',
      'scope-references': ['$XSAPPNAME.User'],
    },
  ],
  'role-collections': [
    {
      name: 'Admin',
      description: 'Administrator',
      'role-template-references': ['$XSAPPNAME.Admin'],
    },
    {
      name: 'User',
      description: 'User',
      'role-template-references': ['$XSAPPNAME.User'],
    },
  ],
}

export async function patchCdsrc(projectDirectory, { name, devDb, prodDb, auth }) {
  const cdsrcPath = join(projectDirectory, '.cdsrc.json')
  const cdsrc = await readJson(cdsrcPath)
  deepMerge(cdsrc, {
    requires: {
      db: {
        '[development]':
          devDb === 'sqlite'
            ? { kind: 'sqlite', credentials: { database: `${name}.sqlite` } }
            : { kind: devDb },
        '[production]': { kind: prodDb },
      },
      auth: {
        '[development]': { kind: 'mocked' },
        kind: auth === 'none' ? 'dummy' : auth,
      },
    },
  })
  await writeJson(cdsrcPath, cdsrc)

  if (auth === 'xsuaa') await patchXsSecurity(projectDirectory)
}

async function patchXsSecurity(projectDirectory) {
  const securityPath = join(projectDirectory, 'xs-security.json')
  const security = await readJson(securityPath)
  for (const [field, entries] of Object.entries(securityEntries)) {
    security[field] ??= []
    const names = new Set(security[field].map(({ name }) => name))
    security[field].push(...entries.filter(({ name }) => !names.has(name)))
  }
  await writeJson(securityPath, security)
}
