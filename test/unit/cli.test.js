import { describe, expect, it } from 'vitest'
import { buildPlan, buildPreliminaryPlan } from '../../src/decision-matrix.js'

describe('buildPlan', () => {
  it('derives the Docker prerequisite policy from the development database', () => {
    expect(buildPreliminaryPlan({ devDb: 'postgres' })).toMatchObject({ postgresDev: true })
    expect(buildPreliminaryPlan({ devDb: 'sqlite' })).toMatchObject({ postgresDev: false })
  })

  it('derives the minimal JavaScript SQLite and HANA plan', () => {
    expect(
      buildPlan({
        name: 'minimal-app',
        lang: 'js',
        devDb: 'sqlite',
        prodDb: 'hana',
        auth: 'none',
        frontend: 'none',
        approuter: false,
      }),
    ).toMatchObject({
      facets: ['sqlite', 'hana', 'mta', 'test', 'lint'],
      addFrontend: false,
      patchMta: true,
      patchRouter: false,
      writeDocker: false,
      postgresScripts: false,
      approuter: false,
      promptForApprouter: false,
      patches: [
        '.cdsrc.json',
        'mta.yaml',
        '.prettierrc',
        '.editorconfig',
        'README.md',
        '.gitignore',
        'package.json',
        'db/schema.cds',
        'srv/cat-service.cds',
        'srv/cat-service.js',
        'test/smoke.test.js',
      ],
    })
  })

  it('derives TypeScript, XSUAA, and automatic approuter facets', () => {
    expect(
      buildPlan({
        name: 'secure-app',
        lang: 'ts',
        devDb: 'sqlite',
        prodDb: 'hana',
        auth: 'xsuaa',
        frontend: 'none',
        approuter: true,
      }),
    ).toMatchObject({
      facets: [
        'typescript',
        'sqlite',
        'hana',
        'xsuaa',
        'approuter',
        'destination',
        'mta',
        'test',
        'lint',
      ],
      addFrontend: false,
      patchMta: true,
      patchRouter: false,
      writeDocker: false,
      postgresScripts: false,
      approuter: true,
      promptForApprouter: false,
      patches: [
        '.cdsrc.json',
        'mta.yaml',
        '.prettierrc',
        '.editorconfig',
        'README.md',
        '.gitignore',
        'package.json',
        'db/schema.cds',
        'srv/cat-service.cds',
        'srv/cat-service.ts',
        'test/smoke.test.js',
      ],
    })
  })

  it('derives Postgres, IAS, frontend, and approuter patches', () => {
    expect(
      buildPlan({
        name: 'full-app',
        lang: 'js',
        devDb: 'postgres',
        prodDb: 'postgres',
        auth: 'ias',
        frontend: 'react',
        approuter: true,
      }),
    ).toMatchObject({
      facets: ['postgres', 'ias', 'approuter', 'destination', 'mta', 'test', 'lint'],
      postInitFacets: ['react', 'html5-repo'],
      addFrontend: true,
      patchMta: true,
      patchRouter: true,
      writeDocker: true,
      postgresScripts: true,
      patches: [
        '.cdsrc.json',
        'mta.yaml',
        '.prettierrc',
        '.editorconfig',
        'README.md',
        '.gitignore',
        'package.json',
        'db/schema.cds',
        'srv/cat-service.cds',
        'srv/cat-service.js',
        'test/smoke.test.js',
        'docker-compose.yml',
        '.env',
        '.cdsrc-private.json',
      ],
      approuter: true,
      promptForApprouter: false,
    })
  })

  it('requires an approuter choice only for an unauthenticated frontend', () => {
    expect(
      buildPlan({
        lang: 'js',
        devDb: 'sqlite',
        prodDb: 'hana',
        auth: 'none',
        frontend: 'vue',
      }),
    ).toMatchObject({
      addFrontend: true,
      patchMta: true,
      patchRouter: undefined,
      writeDocker: false,
      postgresScripts: false,
      approuter: undefined,
      promptForApprouter: true,
    })
  })

  it('plans an MTA patch for backend-only production Postgres', () => {
    const plan = buildPlan({
      name: 'postgres-app',
      lang: 'js',
      devDb: 'sqlite',
      prodDb: 'postgres',
      auth: 'none',
      frontend: 'none',
    })

    expect(plan.patchMta).toBe(true)
    expect(plan.patches).toContain('mta.yaml')
  })
})
