export function buildPlan({ name, lang, devDb, prodDb, auth, frontend, approuter }) {
  const facets = []
  const postInitFacets = []
  const patches = ['.cdsrc.json']
  const promptForApprouter = auth === 'none' && frontend !== 'none'
  const resolvedApprouter = promptForApprouter ? approuter : auth !== 'none'

  if (lang === 'ts') {
    facets.push('typescript')
  }

  if (devDb === 'sqlite' || prodDb === 'sqlite') {
    facets.push('sqlite')
  }
  if (devDb === 'postgres' || prodDb === 'postgres') {
    facets.push('postgres')
  }
  if (prodDb === 'hana') {
    facets.push('hana')
  }
  if (auth === 'xsuaa') {
    facets.push('xsuaa')
  }
  if (auth === 'ias') {
    facets.push('ias')
  }
  if (resolvedApprouter) {
    facets.push('approuter', 'destination')
  }
  if (frontend !== 'none') postInitFacets.push(frontend)
  if (frontend !== 'none' && resolvedApprouter) postInitFacets.push('html5-repo')
  if (frontend !== 'none' || prodDb === 'postgres') {
    patches.push('mta.yaml')
  }

  facets.push('mta', 'test', 'lint')
  patches.push(
    '.prettierrc',
    '.editorconfig',
    'README.md',
    '.gitignore',
    'package.json',
    'db/schema.cds',
    'srv/cat-service.cds',
    `srv/cat-service.${lang}`,
    'test/smoke.test.js',
  )

  const labels = {
    lang: { js: 'JavaScript (ESM)', ts: 'TypeScript' },
    devDb: { sqlite: 'SQLite (persistent file)', postgres: 'PostgreSQL (Docker)' },
    prodDb: { hana: 'SAP HANA Cloud', postgres: 'PostgreSQL on BTP' },
    auth: { none: 'None', xsuaa: 'XSUAA (mocked in dev)', ias: 'IAS (mocked in dev)' },
    frontend: { none: 'None (backend only)', vue: 'Vue (Vite)', react: 'React (Vite)' },
  }
  const frontendLabel = labels.frontend[frontend]
  const approuterLabel = resolvedApprouter ? `Yes${promptForApprouter ? '' : ' (auto)'}` : 'No'
  const summary = [
    `• Backend:     ${labels.lang[lang]}`,
    `• Dev DB:      ${labels.devDb[devDb]}`,
    `• Prod DB:     ${labels.prodDb[prodDb]}`,
    `• Auth:        ${labels.auth[auth]}`,
    `• Frontend:    ${frontend === 'none' ? frontendLabel : `${frontendLabel} → app/frontend`}`,
    `• Approuter:   ${approuterLabel}`,
    '• Deployment:  MTA → Cloud Foundry',
  ].join('\n')

  return {
    facets,
    postInitFacets,
    patches,
    approuter: resolvedApprouter,
    promptForApprouter,
    summary: `You're about to create ${name} with:\n${summary}`,
  }
}
