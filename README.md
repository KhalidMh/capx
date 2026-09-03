# capx

A Laravel-style installer for SAP CAP Node.js projects.

## What It Does

`capx` guides you through a small set of project choices and builds a ready-to-run CAP
application around them. It runs `cds init`, adds the selected CAP facets, then applies
the project configuration and starter files that make those choices work together.

It is deliberately an opinionated wrapper around `@sap/cds-dk`, not a replacement for
the CAP tooling. Once the project exists, use the normal `cds`, npm, MTA, Cloud Foundry,
and Docker commands you already use for CAP development and deployment.

## Requirements

- Node.js 22 or later. Node.js 24 LTS is recommended.
- npm and Git. Git is required because capx initializes the generated project repository.
- `@sap/cds-dk` 10+ and `mbt`. Doctor checks for both and offers to install them globally.
- The Cloud Foundry CLI and the MTA CF plugin are detected but optional. Doctor shows
  installation guidance and lets you decide whether to continue without them.
- Docker with the Compose plugin is checked when you choose PostgreSQL for local
  development. You can continue without it, but the generated PostgreSQL development
  configuration requires Docker before it can run.

Doctor runs as the first step of `capx new`; there is no standalone `capx doctor` command.

## Install

```sh
npm install --global @khalidmh/capx
```

The package is published as `@khalidmh/capx`; the installed command is `capx`.

## Quickstart

```sh
capx new my-app
cd my-app
npm run watch
```

The generated project is a standard CAP project. Run `npm test`, `npm run lint`, and
`npm run build` from its root as needed.

## Configuration Choices

`capx new` asks for the following choices:

| Choice | Effect |
| --- | --- |
| Project name | Creates the target directory and names generated artifacts. |
| Backend language | Selects JavaScript (ESM) or TypeScript. |
| Development database | Uses a persistent SQLite file or PostgreSQL through Docker. |
| Production database | Configures SAP HANA Cloud or PostgreSQL on BTP in the MTA. |
| Authentication | Selects none, XSUAA, or IAS. XSUAA and IAS are mocked in development. |
| Frontend framework | Adds no frontend, Vue, or React through Vite at `app/frontend`. |
| Approuter | Is selected automatically for authentication; an unauthenticated frontend asks whether to add a proxy-only approuter. |

For PostgreSQL on BTP, capx preserves the generated `development` service plan. PostgreSQL
entitlements and available plans vary between BTP subaccounts and regions, so adjust that
plan in `mta.yaml` to one available in your landscape before deployment.

## What You Get

The exact layout depends on your choices. A fully featured project contains these areas:

```text
my-app/
├── app/
│   ├── frontend/       # Optional Vite React or Vue application
│   └── router/         # Optional approuter
├── db/
│   └── schema.cds      # Sample domain model
├── srv/
│   └── cat-service.*   # Sample CAP service
├── test/
│   └── smoke.test.*    # Service smoke test
├── .cdsrc.json         # CAP configuration
├── docker-compose.yml  # Present for PostgreSQL development
├── mta.yaml            # Cloud Foundry deployment descriptor
└── package.json
```

CAP facets may add their own files, including authentication descriptors and deployment
modules. The generated project also has scripts for watch, build, lint, test, and, when
PostgreSQL development is selected, starting and stopping its database container.

## Upgrading A Generated Project

Use the CAP tooling to upgrade the generated application. With current `@sap/cds-dk`, run
`cds upgrade` from the generated project directory to inspect dependencies and migration
guidance, then review and test the proposed changes. capx does not maintain a parallel
upgrade path.

## Non-Goals

Version 0.1.0 does not provide Java backends, Fiori Elements scaffolding, CommonJS
projects, non-interactive flags, `capx add`, standalone doctor, self-updates, generated
project CI, multitenancy, Kyma or Helm deployment, Event Mesh, AI, attachments,
audit logging, npm workspaces, or pnpm, Yarn, and Bun workflows.

## Roadmap

Future work will be considered from user feedback and CAP platform changes; the non-goals
above describe the current v0.1.0 boundary, not release commitments.

## Contributing

Run the local checks before opening a change:

```sh
npm ci
npm run lint
npm test
npm run format:check
```

## License

[MIT](LICENSE)
