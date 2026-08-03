import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { readJson, writeJson } from '../utils/json.js'
import { writeFileAtomic } from '../utils/fs.js'

export async function patchMta(
  projectDirectory,
  { name, removePostgresDeployment, patchRouterConfig },
) {
  const mtaPath = join(projectDirectory, 'mta.yaml')
  const document = parseDocument(await readFile(mtaPath, 'utf8'))
  if (removePostgresDeployment) removePostgresDeploymentArtifacts(document)
  else documentPostgresEntitlement(document)
  const names = renameMtaArtifacts(document, name)
  await writeFileAtomic(mtaPath, document.toString())

  if (patchRouterConfig) {
    await patchRouter(join(projectDirectory, 'app', 'router', 'xs-app.json'))
  }

  return names
}

function documentPostgresEntitlement(document) {
  const warning = 'PostgreSQL service plan depends on your BTP subaccount entitlement.'
  const resources = document.get('resources')
  for (const resource of resources?.items ?? []) {
    if (resource.get('parameters', true)?.get('service', true)?.value !== 'postgresql-db') continue
    if (resource.commentBefore?.includes(warning) || resources.commentBefore?.includes(warning))
      continue
    resource.commentBefore = resource.commentBefore
      ? `${resource.commentBefore}\n ${warning}`
      : ` ${warning}`
  }
}

function removePostgresDeploymentArtifacts(document) {
  const modules = document.get('modules')
  const resources = document.get('resources')
  const postgresNames = new Set(
    (resources?.items ?? [])
      .filter(
        (resource) =>
          resource.get('parameters', true)?.get('service', true)?.value === 'postgresql-db',
      )
      .map((resource) => resource.get('name', true)?.value),
  )

  if (postgresNames.size === 0) return
  modules.items = (modules?.items ?? []).filter((module) => {
    const path = module.get('path', true)?.value
    return path !== 'gen/pg'
  })
  resources.items = (resources?.items ?? []).filter(
    (resource) => !postgresNames.has(resource.get('name', true)?.value),
  )
  for (const module of modules.items) removeRequirements(module, postgresNames)
}

function removeRequirements(module, names) {
  const requires = module.get('requires')
  if (!requires?.items) return
  requires.items = requires.items.filter(
    (requirement) => !names.has(requirement.get('name', true)?.value),
  )
}

function renameMtaArtifacts(document, projectName) {
  const names = new Map()
  const modules = document.get('modules')?.items ?? []
  const resources = document.get('resources')?.items ?? []

  for (const module of modules) {
    const type = module.get('type', true)?.value
    const path = module.get('path', true)?.value
    const currentName = module.get('name', true)?.value
    const desiredName =
      type === 'html5' || path === 'app/frontend'
        ? `${projectName}-frontend`
        : type === 'approuter.nodejs' || path === 'app/router'
          ? `${projectName}-approuter`
          : type === 'nodejs' && path === 'gen/srv'
            ? `${projectName}-srv`
            : undefined
    if (desiredName && currentName && currentName !== desiredName) {
      names.set(currentName, desiredName)
      module.set('name', desiredName)
    }
  }

  for (const resource of resources) {
    const type = resource.get('type', true)?.value
    const currentName = resource.get('name', true)?.value
    if (type === 'com.sap.xs.hdi-container' && currentName && currentName !== `${projectName}-db`) {
      names.set(currentName, `${projectName}-db`)
      resource.set('name', `${projectName}-db`)
    }
  }

  for (const module of modules) {
    const currentName = module.get('name', true)?.value
    if (currentName?.endsWith('-db-deployer')) {
      const desiredName = `${projectName}-db-deployer`
      if (currentName !== desiredName) {
        names.set(currentName, desiredName)
        module.set('name', desiredName)
      }
    }
  }

  updateReferences(document, names)
  return names
}

function updateReferences(document, names) {
  visit(document.contents, names)
}

function visit(node, names) {
  if (!node) return
  if (node.items?.every((item) => item?.key)) {
    for (const pair of node.items) {
      if (pair.key?.value === 'name' && names.has(pair.value?.value)) {
        pair.value.value = names.get(pair.value.value)
      } else {
        visit(pair.value, names)
      }
    }
  } else if (node.items) {
    for (const item of node.items) visit(item, names)
  }
}

async function patchRouter(routerPath) {
  const router = await readJson(routerPath)
  const preservedRoutes = (router.routes ?? []).filter(
    ({ source }) => source !== '^/odata/(.*)$' && source !== '^(.*)$' && source !== '^/(.*)$',
  )
  router.routes = [
    ...preservedRoutes,
    {
      source: '^/odata/(.*)$',
      target: '/odata/$1',
      destination: 'srv-api',
      csrfProtection: false,
    },
    { source: '^(.*)$', target: '$1', service: 'html5-apps-repo-rt' },
  ]
  await writeJson(routerPath, router)
}
