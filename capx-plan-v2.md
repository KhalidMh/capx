# `capx` — CAP Project Installer

**Plan v2 — revised 2026-07-31 for CAP 10.**

Implementation plan for `capx`, a CLI that scaffolds SAP CAP Node.js projects opinionatedly, in the spirit of the Laravel installer (`laravel new ...`).

This document is the single source of truth for v0.1.0. An implementing model should execute it phase by phase without inventing anything outside what's written here. Anything unspecified is out of scope; see §15.

> **What changed from v1.** CAP 10 (June 2026) moved the ground under the original plan. Node 22 is now the minimum, all CAP packages went up a major, ESM is the default module system, and — most importantly — `cds-dk` 10 absorbed the frontend and approuter scaffolding that v1 was going to build by hand. `capx` is now a smaller, thinner tool. Full change log in §19.

---

## 1. Project meta

| | |
|---|---|
| Package name | `capx` (npm) |
| License | MIT |
| Repo host | GitHub (owner: user) |
| Distribution | global npm install: `npm i -g capx` |
| Binary | `capx` |
| Installer runtime | Node 22 minimum, Node 24 LTS recommended |
| Generated projects | Node 22 minimum (CAP 10 requirement) |
| Module system | ESM, both installer and generated projects |
| MVP command | `capx new <project-name>` |
| Package manager | npm only |

---

## 2. Requirements freeze

Settled. No re-litigation during implementation.

- Node.js backend only (no Java).
- Prerequisite check runs first; auto-install for npm globals, detect-only for non-npm tools, ask when a deploy-time tool is missing.
- Dev DB: persistent SQLite **or** PostgreSQL (local Docker).
- Prod DB: SAP HANA Cloud **or** PostgreSQL on BTP.
- Mismatched dev/prod allowed (SQLite dev + HANA prod is the CAP-recommended path).
- Backend language: TypeScript **or** JavaScript. TS = `.ts` handlers, `tsconfig.json`, and standard `cds watch`; the `typescript` facet includes entity type generation.
- Frontend at `app/frontend/`, approuter at `app/router/`.
- Frontend: Vue **or** React (one only), scaffolded by `cds add vue|react --into frontend`.
- Auth: one choice (none / XSUAA / IAS) with automatic dev-mocking via CAP profiles.
- Approuter auto-added when XSUAA or IAS selected; otherwise prompted.
- `auth=none` + approuter allowed (proxy-only mode).
- XSUAA gets `xs-security.json` with sample `Admin` / `User` roles + role collections.
- IAS gets the identity service resource in `mta.yaml`.
- `mta.yaml` always generated (by `cds add mta`, then patched).
- Initial CDS content: empty service stub. No sample data.
- ESLint (via `cds add lint`) + Prettier configs included.
- Test setup via `cds add test`, with a fallback smoke test when the facet emits none.
- No `CLAUDE.md` / Copilot instructions in MVP.
- No GitHub Actions inside generated projects.
- No `--using` flag, no non-interactive flag mode.
- Approuter serves the frontend build output as static content and proxies service paths to the backend.
- Each folder fully independent — **no** npm workspaces.
- Postgres dev ships a `docker-compose.yml`.
- MTA module names: `<project>-srv`, `<project>-db`, `<project>-frontend`, `<project>-approuter`.
- Target dir exists → error; `--force` to overwrite.
- Git init + initial commit `"Initial commit - project setup"`.

---

## 3. Design principle (read this before coding)

**`capx` orchestrates `cds-dk`. It does not reimplement it.**

CAP 10's `cds add` covers far more ground than it did at CAP 8/9: React and Vue scaffolding, standalone approuter, destinations, HTML5 repo, MTA modules, linting, tests. Every one of those is a facet now.

The consequence: **any file `cds-dk` can generate, `capx` must not template.** `capx`'s job is the three things `cds-dk` deliberately doesn't do:

1. **Ask the right questions** in the right order and derive the facet list.
2. **Check prerequisites** before anything runs.
3. **Patch** the generated output for cross-cutting decisions `cds add` can't know about — dev/prod DB profiles, MTA module renaming, Docker for local Postgres, Prettier, git.

When in doubt during implementation: prefer a `cds add` facet over a template file. If a template in §11 duplicates something a facet now emits, delete the template — see §16 item 1.

```
┌──────────────────────────────────────────────────────┐
│  capx CLI (commander + @clack/prompts)               │
│                                                      │
│  1. Parse args                                       │
│  2. Doctor (prereqs)                                 │
│  3. Prompts                                          │
│  4. buildPlan(inputs) → facets + patches             │
│  5. cds init --add <facets>                          │
│  6. cds add vue|react --into frontend   (if needed)  │
│  7. Apply patches                                    │
│  8. npm install ×N                                   │
│  9. git init + commit                                │
│ 10. Print next steps                                 │
└──────────────────────────────────────────────────────┘
```

---

## 4. `capx` repo layout

```
capx/
├── bin/
│   └── capx.js                  # shebang + commander entrypoint
├── src/
│   ├── commands/
│   │   └── new.js
│   ├── doctor/
│   │   ├── index.js
│   │   ├── checks/
│   │   │   ├── node.js
│   │   │   ├── npm.js
│   │   │   ├── git.js
│   │   │   ├── cds-dk.js
│   │   │   ├── cf.js
│   │   │   ├── mbt.js
│   │   │   ├── mta-cf-plugin.js
│   │   │   └── docker.js
│   │   └── install-hints.js
│   ├── prompts/
│   │   ├── project-name.js
│   │   ├── language.js
│   │   ├── dev-db.js
│   │   ├── prod-db.js
│   │   ├── auth.js
│   │   ├── frontend.js
│   │   ├── approuter.js
│   │   └── confirm.js
│   ├── steps/
│   │   ├── 01-validate-target.js
│   │   ├── 02-cds-init.js
│   │   ├── 03-cds-add-frontend.js
│   │   ├── 04-patch-cdsrc.js
│   │   ├── 05-patch-mta.js
│   │   ├── 06-write-extras.js       # prettier, editorconfig, gitignore, README
│   │   ├── 07-write-docker.js
│   │   ├── 08-write-stubs.js        # cds + handler + smoke test
│   │   ├── 09-install-deps.js
│   │   └── 10-git-init.js
│   ├── templates/                   # ONLY what cds-dk cannot generate
│   │   ├── prettierrc.json
│   │   ├── editorconfig
│   │   ├── docker-compose.yml.tmpl
│   │   ├── env.tmpl
│   │   ├── cdsrc-private.json.tmpl
│   │   ├── README.md.tmpl
│   │   ├── schema.cds.tmpl
│   │   ├── cat-service.cds.tmpl
│   │   ├── cat-service.js.tmpl
│   │   ├── cat-service.ts.tmpl
│   │   └── smoke.test.js.tmpl
│   ├── utils/
│   │   ├── exec.js                  # execa wrapper, logging + timeouts
│   │   ├── fs.js                    # atomic writes, mkdir -p
│   │   ├── json.js                  # read/merge/write JSON preserving key order
│   │   ├── yaml.js                  # read/patch/write mta.yaml via `yaml`
│   │   ├── render.js                # {{var}} / {{#if}} mustache-lite
│   │   ├── rollback.js
│   │   └── log.js
│   ├── decision-matrix.js           # buildPlan(inputs) → Plan
│   └── config.js                    # version ranges, facet names
├── test/
│   ├── unit/
│   └── e2e/
├── .editorconfig
├── eslint.config.js                 # flat config (ESLint 10)
├── .prettierrc
├── .gitignore
├── LICENSE
├── package.json
├── README.md
└── CHANGELOG.md
```

---

## 5. Tech stack

### 5.1 Installer dependencies

All verified against npm on 2026-07-31.

| Concern | Package | Range | Note |
|---|---|---|---|
| CLI parsing | `commander` | `^15` | |
| Prompts | `@clack/prompts` | `^1` | **1.x, not 0.x** — API differs from older tutorials |
| Process exec | `execa` | `^10` | ESM-only |
| Colors | `picocolors` | `^1` | |
| YAML patching | `yaml` | `^2` | for `mta.yaml` edits |
| Test runner | `vitest` | `^4` | verified at Phase 0 |
| Lint | `eslint` | `^10` | flat config |
| Format | `prettier` | `^3` | 3.9.x current |

Installer is **JavaScript, ESM** (`"type": "module"`). Not TypeScript — see §15.

### 5.2 Generated-project dependencies

CAP 10 facets install most of these themselves. The table records what *should* end up in `package.json` so the model can assert it in tests — not a list to inject manually.

| Package | Range | When | Installed by |
|---|---|---|---|
| `@sap/cds` | `^10` | always | `cds init` |
| `@sap/cds-dk` | `^10` | always (devDep) | `cds init` |
| `@cap-js/sqlite` | `^3` | SQLite dev or prod | `cds add sqlite` |
| `@cap-js/postgres` | `^3` | Postgres dev or prod | `cds add postgres` |
| `@cap-js/hana` | `^3` | HANA prod | `cds add hana` |
| `@cap-js/cds-typer` | latest | TS | `cds add typescript` |
| `@cap-js/cds-test` | `^1` | only when capx writes the fallback test (devDep) | **capx** |
| `@sap/xssec` | `^4` | XSUAA or IAS | `cds add xsuaa`/`ias` |
| `@sap/xsenv` | `^6` | XSUAA or IAS | `cds add xsuaa`/`ias` |
| `@sap/approuter` | `^22` | approuter | `cds add approuter` |
| `@sap/eslint-plugin-cds` | `^4` | always (devDep) | `cds add lint` |
| `typescript` | `^7` | TS | `cds add typescript` |
| `@types/node` | `^22` | TS | `cds add typescript` |
| `prettier` | `^3` | always (devDep) | **capx** |

**Verification duty:** before Phase 0 coding, run `npm view <pkg> version` on every row and reconcile. CAP ships monthly; these will move.

**Do not hand-write `engines`.** CAP 10's `cds add` and `cds build` generate `engines` fields using caret LTS ranges (e.g. `^24`) automatically.

---

## 6. Prompt flow (clack schema)

`@clack/prompts` is on 1.x — confirm the current API shape at Phase 1 rather than copying 0.x examples. Any `isCancel(result)` → clean exit 1 with `"Cancelled"`. No IO happens before the final confirm, so cancelling never needs rollback.

### 6.1 Project name

From the positional CLI argument; prompt if absent.

```js
text({
  message: 'Project name?',
  placeholder: 'my-cap-app',
  validate: (v) => {
    if (!v) return 'Required'
    if (v.length > 64) return 'Max 64 characters'
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(v))
      return 'Must start with alphanumeric or _, then [a-zA-Z0-9_-] only'
  },
})
```

Mirrors `cds init`'s own constraints (≤64 chars, alphanumeric or `_` start, `[a-zA-Z0-9_-]` body). Validating here surfaces the error before any shell call.

### 6.2 Backend language

```js
select({
  message: 'Backend language?',
  options: [
    { value: 'js', label: 'JavaScript (ESM)' },
    { value: 'ts', label: 'TypeScript' },
  ],
  initialValue: 'js',
})
```

### 6.3 Dev database

```js
select({
  message: 'Database for local development?',
  options: [
    { value: 'sqlite',   label: 'SQLite (persistent file)' },
    { value: 'postgres', label: 'PostgreSQL (via Docker)' },
  ],
  initialValue: 'sqlite',
})
```

### 6.4 Prod database

```js
select({
  message: 'Database for production?',
  options: [
    { value: 'hana',     label: 'SAP HANA Cloud' },
    { value: 'postgres', label: 'PostgreSQL on BTP' },
  ],
  initialValue: 'hana',
})
```

### 6.5 Authentication

```js
select({
  message: 'Authentication?',
  options: [
    { value: 'none',  label: 'None' },
    { value: 'xsuaa', label: 'XSUAA (mocked in dev)' },
    { value: 'ias',   label: 'IAS (mocked in dev)' },
  ],
  initialValue: 'xsuaa',
})
```

### 6.6 Frontend

```js
select({
  message: 'Frontend framework?',
  options: [
    { value: 'none',  label: 'None (backend only)' },
    { value: 'vue',   label: 'Vue (Vite)' },
    { value: 'react', label: 'React (Vite)' },
  ],
  initialValue: 'none',
})
```

### 6.7 Approuter

Shown **only if** `auth === 'none' && frontend !== 'none'`. Otherwise derived:

- `auth` is `xsuaa` or `ias` → approuter `true`, prompt skipped
- `auth === 'none' && frontend === 'none'` → approuter `false`, prompt skipped

```js
confirm({
  message: 'Add a standalone approuter (proxy-only, no auth)?',
  initialValue: false,
})
```

### 6.8 Final confirmation

```
You're about to create my-cap-app with:
  • Backend:     TypeScript
  • Dev DB:      PostgreSQL (Docker)
  • Prod DB:     SAP HANA Cloud
  • Auth:        XSUAA (mocked in dev)
  • Frontend:    Vue (Vite) → app/frontend
  • Approuter:   Yes (auto)
  • Deployment:  MTA → Cloud Foundry
```

```js
confirm({ message: 'Proceed?', initialValue: true })
```

---

## 7. Prerequisite check (doctor)

Runs before prompts. Detection via `execa` with a 3s timeout. No network needed.

| Tool | Detection | Required for | If missing |
|---|---|---|---|
| `node` | `process.version` ≥ **22** | always | Exit 1; print Node 24 LTS install link |
| `npm` | `npm --version` | always | Exit 1; "reinstall Node" |
| `git` | `git --version` | always | Print platform install hint; ask user to install, then retry |
| `@sap/cds-dk` | `cds --version`, assert major ≥ 10 | always | **Auto-offer** `npm i -g @sap/cds-dk`; on `Y`, run it |
| `mbt` | `mbt --version` | MTA build | **Auto-offer** `npm i -g mbt` |
| `cf` CLI | `cf --version` | CF deploy | Detect-only; **ask**: continue scaffolding or abort? |
| MTA CF plugin | `cf plugins` grep `multiapps` | CF deploy | Detect-only; same as `cf` |
| `docker` | `docker --version` | only if `devDb=postgres` | Warn + **ask** whether to continue; `docker-compose.yml` still written |

### 7.1 cds-dk major-version guard

Node 22 and cds-dk 10 are hard requirements. If a user has cds-dk 9 globally, `cds init --add` will accept some facets but not `react`/`vue`, and the resulting project will pin `@sap/cds@^9`. Parse the output of `cds --version` and if the major is below 10, offer `npm i -g @sap/cds-dk@latest`. If declined, exit 1 — do not attempt a degraded path.

### 7.2 Auto-install flow for npm globals

1. Detect missing → stop spinner → `"@sap/cds-dk is required. Install globally now? [Y/n]"`
2. `Y` → `execa('npm', ['i', '-g', '<pkg>'], { stdio: 'inherit' })`
3. Failure → print stderr, exit 1
4. Success → re-detect, continue

### 7.3 Install hints

`install-hints.js` holds platform-specific instructions per non-npm tool. Detect via `process.platform` and `/etc/os-release` on Linux.

- **macOS** → Homebrew (`brew install git`, `brew install cloudfoundry/tap/cf-cli@8`, `brew install --cask docker`)
- **Linux** → apt or dnf commands; unknown distro falls back to vendor doc URLs
- **Windows** → `winget`; for `cf` CLI note WSL is also valid

---

## 8. Generated project — maximal layout

With every option on (TS + Postgres dev + HANA prod + XSUAA + Vue + approuter). Most of this is emitted by `cds-dk`; the **bold** entries are what `capx` writes or patches.

```
my-cap-app/
├── .cdsrc.json                  ** patched: dev/prod profiles
├── .cdsrc-private.json          ** capx (postgres dev only, gitignored)
├── .editorconfig                ** capx
├── .env                         ** capx (gitignored)
├── .gitignore                   ** patched
├── .prettierrc                  ** capx
├── README.md                    ** capx
├── eslint.config.js             (cds add lint)
├── app/
│   ├── frontend/                (cds add vue --into frontend)
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── public/
│   │   ├── src/
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── router/                  (cds add approuter)
│       ├── package.json
│       └── xs-app.json
├── db/
│   ├── schema.cds               ** capx (empty stub)
│   └── data/
├── docker-compose.yml           ** capx (postgres dev only)
├── mta.yaml                     (cds add mta) ** patched: module names
├── package.json                 (cds init) ** patched: scripts, prettier
├── srv/
│   ├── cat-service.cds          ** capx (empty stub)
│   └── cat-service.ts           ** capx (empty stub)
├── test/
│   └── smoke.test.js            ** capx
├── tsconfig.json                (cds add typescript)
└── xs-security.json             (cds add xsuaa)
```

### 8.1 Notes

- `cds add vue|react --into frontend` puts the Vite app at `app/frontend/` and `cds watch` mounts it. Without `--into`, cds-dk scaffolds directly into `app/` and mounts at `/` — we always pass `--into frontend` to keep room for `app/router/`.
- The v1 concern about `cds build` choking on `app/frontend` is resolved: cds-dk owns this layout now and configures the build itself. **Still verify empirically at Phase 4.**
- `xs-security.json` comes from `cds add xsuaa`. Inspect the generated roles; only patch if it lacks `Admin`/`User` templates (see §16 item 3).

---

## 9. End-to-end execution sequence

Exact sequence after prompts and final confirm. Each numbered line is one shell call or one fs write batch. `cwd` is tracked in JS state, never via `cd`.

**Trace inputs:**

```json
{
  "name": "my-app",
  "lang": "ts",
  "devDb": "postgres",
  "prodDb": "hana",
  "auth": "xsuaa",
  "frontend": "vue",
  "approuter": true
}
```

### Phase A — validate target

```
1. exists('my-app') && !force  → throw "Directory exists. Use --force to overwrite."
   exists('my-app') &&  force  → rm -rf my-app
```

### Phase B — scaffold via cds-dk

```
2. Build the facet list:

   const facets = []
    if (lang === 'ts') facets.push('typescript') // includes @cap-js/cds-typer in DK 10.0.6
   if (devDb === 'sqlite'  || prodDb === 'sqlite')   facets.push('sqlite')
   if (devDb === 'postgres'|| prodDb === 'postgres') facets.push('postgres')
   if (prodDb === 'hana')  facets.push('hana')
   if (auth === 'xsuaa')   facets.push('xsuaa')
   if (auth === 'ias')     facets.push('ias')
   if (approuter) {
     facets.push('approuter', 'destination')
     if (frontend !== 'none') facets.push('html5-repo')
   }
   facets.push('mta', 'test', 'lint')   // always

   Pass `--nodejs` to explicitly select capx's required Node.js runtime and keep initialization deterministic. Current cds-dk 10.0.6 empirically rejects the unqualified command in this flow.
   Note: do NOT pass 'cjs'. ESM is the CAP 10 default and what we want.

3. execa('cds', ['init', 'my-app', '--nodejs', '--add', facets.join(',')],
         { stdio: 'inherit' })
```

### Phase C — frontend (if `frontend !== 'none'`)

```
4. execa('cds', ['add', frontend, '--into', 'frontend'],
         { cwd: 'my-app', stdio: 'inherit' })
```

`frontend` is literally `'vue'` or `'react'`. That single call scaffolds the Vite app at `app/frontend/`, wires the dev-server mount, and registers the MTA html5 module. No `vite.config.ts` patching, no `npm create vite`.

### Phase D — patch `.cdsrc.json` (cwd = `./my-app`)

```
5. Read .cdsrc.json (create if absent), deep-merge:

   {
     "requires": {
       "db": {
          "[development]": { "kind": "<devDbKind>" },
         "[production]":  { "kind": "<prodDbKind>" }
       },
       "auth": {
         "[development]": { "kind": "mocked" },
         "kind": "<authKind>"
       }
     }
   }

   For `devDbKind='sqlite'`, set `[development]` to
   `{ "kind": "sqlite", "credentials": { "database": "<project>.sqlite" } }`.
   For other development kinds and every production kind, set only `kind`.
   devDbKind / prodDbKind  ∈ { 'sqlite', 'postgres', 'hana' }
   authKind:  none → 'dummy' | xsuaa → 'xsuaa' | ias → 'ias'

   Merge, never overwrite: cds add sqlite/hana/xsuaa already wrote
   entries here. Preserve anything you didn't set.
```

### Phase E — patch `mta.yaml`

```
6. Parse mta.yaml with the `yaml` package (preserves comments).
   Rename the html5/frontend module to '<project>-frontend'
   (cds-dk's default name differs). Update any `requires:` references
   to the old name in the same pass.

7. If prodDb === 'postgres': confirm a postgres resource exists.
   Leave the service-plan value as cds-dk emitted it and add a
   comment noting the plan may need adjusting per subaccount
   entitlement.

   If prodDb === 'hana', remove any PostgreSQL resource, `gen/pg`
   deployer module, and references that were added for PostgreSQL development.
   The production HANA build produces `gen/db`, so retaining `gen/pg` makes
   `mbt build` reject the descriptor.

8. Write back. Do NOT regenerate the file from a template.
```

### Phase F — extras

```
9.  Write .prettierrc (§11.1), .editorconfig (§11.2)
10. Append capx entries to .gitignore (§11.3)
11. Write README.md from template (§17)
12. Patch package.json:
      - devDependency: prettier ^3
       - scripts: preserve generated values and add missing watch, build, lint,
         test, and format scripts
       - if devDb=postgres: add "db:up" / "db:down"
       Do not replace any script cds-dk already wrote — see §11.7.
```

### Phase G — stubs

```
13. Write db/schema.cds        (§11.8)
14. Write srv/cat-service.cds  (§11.8)
15. Write srv/cat-service.(js|ts) — ESM (§11.8)
16. Write test/smoke.test.(js|ts) (§11.9)

If `cds add test` already generated a test file, keep it and skip 16.
```

### Phase H — Postgres dev (if `devDb === 'postgres'`)

```
17. Write docker-compose.yml (§11.4)
18. Write .env (§11.5)
19. Write .cdsrc-private.json (§11.6)
```

### Phase I — install

```
20. execa('npm', ['install'], { cwd: 'my-app', stdio: 'inherit' })
21. if frontend !== 'none':
      execa('npm', ['install'], { cwd: 'my-app/app/frontend', stdio: 'inherit' })
22. if approuter:
      execa('npm', ['install'], { cwd: 'my-app/app/router', stdio: 'inherit' })
```

### Phase J — git

```
23. execa('git', ['init'],   { cwd: 'my-app' })
24. execa('git', ['add','.'],{ cwd: 'my-app' })
25. execa('git', ['commit','-m','Initial commit - project setup'],
         { cwd: 'my-app' })

If git user.name/user.email is unset and the commit fails:
  print a warning, leave files staged, do NOT fail the run.
```

### Phase K — summary

```
26. Print:
    ✔ Project created at ./my-app

    Next steps:
      cd my-app
    [if postgres-dev]
      docker compose up -d
      npm run watch
      npm test
```

---

## 10. Decision matrix

Encoded as `src/decision-matrix.js` exporting `buildPlan(inputs): Plan`. This is the only place that branches on inputs; no other module may.

| Input | Facets | capx writes | capx patches |
|---|---|---|---|
| `lang=ts` | `typescript` (includes `@cap-js/cds-typer`) | `srv/*.ts`, `test/smoke.test.js` | — |
| `lang=js` | — | `srv/*.js`, `test/smoke.test.js` (ESM) | — |
| `devDb=sqlite` | `sqlite` | — | `.cdsrc.json` `[development]` with `credentials.database='<project>.sqlite'` |
| `devDb=postgres` | `postgres` | `docker-compose.yml`, `.env`, `.cdsrc-private.json` | `.cdsrc.json` `[development]`, `package.json` scripts |
| `prodDb=hana` | `hana` | — | `.cdsrc.json` `[production]` |
| `prodDb=postgres` | `postgres` | — | `.cdsrc.json` `[production]`, `mta.yaml` comment |
| `auth=none` | — | — | `.cdsrc.json` `auth.kind='dummy'` |
| `auth=xsuaa` | `xsuaa` | — | `.cdsrc.json` auth block |
| `auth=ias` | `ias` | — | `.cdsrc.json` auth block |
| `frontend=vue\|react` | separate `cds add <fw> --into frontend` | — | `mta.yaml` module rename |
| `approuter=true` | `approuter`, `destination` (+`html5-repo` if frontend) | — | — |
| always | `mta`, `test`, `lint` | `.prettierrc`, `.editorconfig`, `README.md`, stubs | `.gitignore`, `package.json` |

Note the column that matters: **`capx writes` is deliberately short.** If it grows during implementation, that's a signal a facet is being duplicated.

---

## 11. Templates

Under `src/templates/`. Each writing step has a private `render` helper that replaces `{{var}}` placeholders; templates do not need conditionals or a shared template-engine dependency.

Everything here is something `cds-dk` does **not** generate. If Phase 4 verification shows a facet now emits one of these, delete it from `capx`.

### 11.1 `.prettierrc`

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

Matches common CAP sample style. At Phase 4, run `npm run lint` on a generated project and reconcile any conflict with `@sap/eslint-plugin-cds@4` — Prettier wins on pure style, ESLint wins on correctness.

### 11.2 `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

### 11.3 `.gitignore` — appended to what `cds init` writes

```
.env
dist/
```

Append only missing entries. Preserve the entries generated by cds-dk, including `node_modules/`, `.cdsrc-private.json`, `gen/`, `mta_archives/`, and `*.mtar`.

### 11.4 `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: {{project}}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-{{project}}}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data

volumes:
  pg-data:
```

### 11.5 `.env`

```
POSTGRES_DB={{project}}
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
```

### 11.6 `.cdsrc-private.json`

```json
{
  "requires": {
    "db": {
      "[development]": {
        "kind": "postgres",
        "credentials": {
          "host": "localhost",
          "port": 5432,
          "user": "postgres",
          "password": "postgres",
          "database": "{{project}}"
        }
      }
    }
  }
}
```

### 11.7 `package.json` scripts

`cds init` in CAP DK 10.0.6 writes only `start`; it creates no `.cdsrc.json`, model folders, or tests when the project has no model. `cds add lint` creates `eslint.config.mjs` but no script. `capx` preserves existing generated scripts and supplies missing `watch: cds watch`, `build: cds build`, `lint: cds lint`, and `test: node --test`, then adds:

```json
{
  "scripts": {
    "format": "prettier --write \"**/*.{js,ts,cds,json,md,yaml,yml}\"",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down"
  }
}
```

`db:up` / `db:down` only when `devDb=postgres`.

**TypeScript watch:** capx uses the same `watch: cds watch` script for JavaScript and TypeScript projects. It does not add a `cds-tsx` script.

### 11.8 CDS + handler stubs

`db/schema.cds`:

```cds
namespace {{project}};

// Define your entities here.
// entity Books {
//   key ID : UUID;
//   title  : String(111);
// }
```

`srv/cat-service.cds`:

```cds
// using { {{project}} as db } from '../db/schema';

service CatService {
  // Expose your entities here.
}
```

`srv/cat-service.js` — **ESM, not CommonJS**:

```js
import cds from '@sap/cds'

export default (srv) => {
  // Add custom handlers here.
  // srv.on('READ', 'Books', (req) => { ... })
}
```

`srv/cat-service.ts`:

```ts
import cds from '@sap/cds'

export default (srv: cds.Service) => {
  // Add custom handlers here.
}
```

CAP 10 creates ESM projects by default; `require`/`module.exports` will fail. If you ever need CJS, that's `cds init --add cjs` — out of scope here.

### 11.9 Smoke test

`@cap-js/cds-test` is required for the `cds.test` compatibility API used by the fallback. When capx writes that fallback, it adds `@cap-js/cds-test: ^1` as a dev dependency unless a generated test exists or a version is already configured.

**CAP DK 10.0.6's `cds add test` creates no test in an initially model-free project.** Keep an emitted test if present; otherwise write this JavaScript `node --test` fallback with explicit `node:test` imports, regardless of backend language. It imports only Node and CAP runtime APIs, so it remains compatible with every supported Node 22 release; the TypeScript handler remains `srv/cat-service.ts`.

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import cds from '@sap/cds'

cds.test(import.meta.dirname + '/..')

test('service smoke test', () => {
  assert.ok(cds.server)
})
```

**Verification result (Phase 4):** use `cds.test(import.meta.dirname + '/..')`; the fallback runs with Node's built-in `node --test` runner and imports `node:test` and `node:assert/strict` explicitly. Do not make a broad Vitest assertion for this fallback.

---

## 12. Error handling & rollback

| Failure | Recovery |
|---|---|
| Prereq missing, user declines install | Exit 1, clear message, no IO done |
| cds-dk major < 10, user declines upgrade | Exit 1. No degraded path |
| `cds init` non-zero | Nothing to clean; print stderr, exit 1 |
| `cds add <frontend>` fails | Rollback whole dir (project is half-built and not useful) |
| Any patch step fails | Default: `rm -rf <project>`, name the failed step, exit 1. `--no-rollback` leaves state + prints resume instructions |
| `npm install` fails | **No rollback** — usually transient network. Print `cd <project> && npm install`, exit 1 |
| Git init/commit fails | Warn, skip, finish successfully |
| Ctrl-C during prompts | Exit 1, no IO done |
| Ctrl-C during execution | Trap SIGINT, finish the current atomic step, ask `"Rollback? [Y/n]"` |

Progress is appended to `<project>/.capx-log` during the run and deleted on success. A future `--debug` flag will retain it.

---

## 13. Implementation phases

Commit after each phase passes its acceptance test.

### Phase 0 — skeleton + version audit

- Init the `capx` package: ESM, Node ≥ 22, `bin/capx.js` with commander
- **Run `npm view <pkg> version` on every row of §5.1 and §5.2**; write results into `src/config.js` and correct this document where it drifted
- ESLint 10 flat config + Prettier per §11.1
- Vitest configured

**Done when:** `npm link && capx new foo --force` prints the parsed args and exits 0, and `src/config.js` reflects live versions.

### Phase 1 — prompts, no execution

- All prompts from §6 against the **@clack/prompts 1.x** API
- Compose in `src/commands/new.js`
- After final confirm, print the derived facet list and planned patches; execute nothing

**Done when:** an E2E test feeds answers on stdin and asserts the printed facet list matches expectations for 3 different input combinations.

### Phase 2 — doctor

- Each check in `src/doctor/checks/`, including the cds-dk major ≥ 10 guard (§7.1)
- Unit tests with mocked `execa`; E2E tests for the missing-tool paths

**Done when:** all 8 checks have green unit + E2E coverage.

### Phase 3 — `cds init` orchestration

- `src/steps/02-cds-init.js` + `src/decision-matrix.js`
- E2E: `capx new test-minimal` with `{js, sqlite, hana, none, none, false}` and assert:
   - the directory exists
   - `package.json` has `@sap/cds` at major 10
   - `package.json` has `"type": "module"` (ESM default)

`cds init` emits no model, so `cds watch` cannot boot until the empty service
stub exists. Phase 4 writes stubs before the required server-listening E2E;
that E2E uses capx's generated stubs and must not inject a test-only service.

**Done when:** the generated-project shape assertions pass; smoke test #1 (§14)
is completed in Phase 4 after stubs are written.

### Phase 4 — verification sweep + patches

The most important phase. Everything in §16 gets resolved here.

- Generate one project per smoke-matrix row and **inspect the actual output** before writing any patch code
- For each §11 template, check whether a facet already emits it; delete the redundant ones from `capx`
- Then implement steps 04–08 in §9 against what's really there
- Confirm `cds build` handles `app/frontend` and `app/router` cleanly

**Done when:** §16 has zero open items and smoke tests #1 and #2 pass.

### Phase 5 — frontend + approuter

Much smaller than in v1 — this is now two `cds add` calls plus an MTA module rename.
CAP DK 10.0.6 already uses the intended service and db deployer module names; this phase handles only deferred frontend/approuter naming work.

- `src/steps/03-cds-add-frontend.js`
- `src/steps/05-patch-mta.js` using the `yaml` package
- Verify `--into frontend` lands the app at `app/frontend/`

**Done when:** smoke tests #3, #4, #5 pass.

### Phase 6 — MTA build integration

- `mbt build` on generated projects
- Verify module names came out as `<project>-srv` / `-db` / `-frontend` / `-approuter`; for HANA projects, `<project>-db` is the HDI resource and the generated deployer remains `<project>-db-deployer`.

**Done when:** `mbt build` exits 0 on smoke tests #2, #3, #4. This is the big integration gate.

### Phase 7 — Postgres dev

- `src/steps/07-write-docker.js`
- Validate with `docker compose config` on a generated project

**Done when:** smoke test #3 passes including compose validation.

### Phase 8 — install + git

- Steps 09, 10

**Done when:** smoke test #1 ends with a passing `npm test` and one commit in `git log --oneline`.

### Phase 9 — error handling

- Inject failures per §12 into every step
- Assert clean state with rollback on, partial state preserved with `--no-rollback`

**Done when:** smoke tests #6, #7 pass.

### Phase 10 — docs + publish

- README per §17, CHANGELOG (Keep a Changelog), LICENSE (MIT)
- GitHub Actions for the `capx` repo: lint + test on PRs, **Node 22 and Node 24 matrix**
- `npm pack` check, `npm publish --dry-run` clean, tag v0.1.0

**Done when:** the package installs from a fresh global dir and completes smoke test #1.

---

## 14. Smoke matrix

All 7 run in CI before tagging v0.1.0. Commands run inside the generated project.

| # | Inputs | Pass criteria |
|---|---|---|
| 1 | `js, sqlite, hana, none, none, no-approuter` | `cds watch` boots; `npm test` exits 0; `package.json` has `"type":"module"` |
| 2 | `ts, sqlite, hana, xsuaa, none, auto-approuter` | #1 criteria + `mbt build` exits 0 + `xs-security.json` exists |
| 3 | `js, postgres, postgres, ias, vue, auto-approuter` | #1 criteria + `docker compose config` valid + `npm run --prefix app/frontend build` exits 0 |
| 4 | `ts, postgres, hana, xsuaa, react, auto-approuter` | #2 criteria + frontend builds + MTA modules named per §2 |
| 5 | `js, sqlite, hana, none, vue, no-approuter` | `cds watch` serves both API and the mounted Vite app (HTTP 200 on `/odata/v4/` and `/`) |
| 6 | Rerun #1 in an existing dir, no `--force` | Exits 1, "Directory exists" |
| 7 | Rerun #1 with `--force` | Succeeds, dir overwritten |

CI runs the matrix on Node 22 and Node 24.

---

## 15. Non-goals (v0.1.0)

- Java backend
- Fiori Elements scaffolding
- CommonJS projects (`cds init --add cjs`)
- `--using` flag for community starter kits
- Non-interactive flag mode (`--db=hana --auth=xsuaa ...`)
- `capx add` subcommand
- Standalone `capx doctor` (doctor runs only as part of `new`)
- Self-update
- GitHub Actions inside generated projects
- `CLAUDE.md` / Copilot instructions inside generated projects
- Kyma / Helm deployment
- Multitenancy
- Event Mesh, AI (`cds add ai`), attachments, audit-logging facets
- npm workspaces mode
- pnpm / yarn / bun
- TypeScript for the installer itself

---

## 16. Phase 4 findings

These findings are based only on the Phase 4 empirical checks. Items deferred to later phases remain deferred.

1. **Templates.** Retain all Phase 4 templates. The only redundant `.gitignore` entries are the generated entries; capx appends only `.env` and `dist/` when absent.

2. **TypeScript facet.** Use only the `typescript` facet; do not add a separate `typer` facet.

3. **XSUAA roles.** `cds add xsuaa` requires a minimal patch for the `Admin` and `User` scopes, role templates, and role collections. Preserve all unknown generated fields and add only missing entries.

4. **Approuter routes.** The generated router default needs only the service route. The static frontend catch-all belongs to Phase 5, when the frontend layout exists.

5. **MTA module names.** Generated module names are `srv` as `<project>-srv`, `db` as `<project>-db-deployer`, and router as `<project>`. The frontend facet creates no MTA module. Phase 5 must create or patch the frontend MTA strategy; do not patch these names in Phase 4.

6. **`cds-tsx` wiring.** `cds add typescript` does not add a `cds-tsx` script automatically. Phase 4 retains the standard `watch: cds watch` fallback; no separate `cds-tsx` script is emitted.

7. **`@cap-js/cds-test` fallback.** `cds.test` supports Node's built-in test globals. The JavaScript fallback imports `node:test` and `node:assert/strict` explicitly and uses `cds.test(import.meta.dirname + '/..')`, regardless of backend language, because unflagged Node test discovery only includes TypeScript files from Node 22.18. When capx writes that fallback, it conditionally adds `@cap-js/cds-test`; a real generated-project E2E runs `npm install` as test setup and then `npm test` successfully.

8. **Frontend `--into`.** `cds add vue --into frontend` creates `app/frontend`, configures Vite with base `/frontend`, `cds watch` serves it, and the frontend build succeeds. This remains Phase 5 work.

9. **Postgres service plan.** The generated plan is `development`, but entitlement availability varies by landscape. Phase 10 README documentation must tell users to adjust it when needed. Do not hardcode a plan in Phase 4 or move the Phase 7 Postgres Docker work forward.

10. **SQLite driver.** CAP provides SQLite without a manually added low-level driver dependency. For persistent development data, capx configures `[development]` with `kind: 'sqlite'` and `credentials.database: '<project>.sqlite'` at the project root; hyphens in a valid project name remain literal in that filename.

---

## 17. README structure (Phase 10 deliverable)

```
# capx
"A Laravel-style installer for SAP CAP Node.js projects."

## What it does
Two paragraphs. Emphasize: opinionated wrapper over cds-dk, not a replacement.

## Requirements
- Node 22+ (24 LTS recommended)
- npm
- git
- auto-installed: @sap/cds-dk (v10+), mbt
- detect-only: cf CLI, MTA CF plugin, Docker (Postgres dev only)

## Install
npm i -g capx

## Quickstart
capx new my-app
cd my-app
npm run watch

## What you get
The maximal project layout, annotated.

## Configuration choices
The 7 prompts and what each affects.

## Upgrading a generated project
Point at `cds upgrade` (new in cds-dk 10) rather than reinventing it.

## Roadmap
Link to non-goals.

## Contributing / License (MIT)
```

---

## 18. Definition of done for v0.1.0

- [ ] All 11 phases complete with acceptance tests green
- [ ] §16 has zero open items
- [ ] Smoke matrix (§14) all 7 rows pass on Node 22 and Node 24
- [ ] README + CHANGELOG + LICENSE present
- [ ] `npm publish --dry-run` clean
- [ ] Tagged `v0.1.0` on GitHub
- [ ] Published to npm as `capx`

---

## 19. Changes from plan v1

Recorded so the delta is auditable. All version claims verified against the npm registry on 2026-07-31; all behavior claims against the capire CAP 10 release notes and changelog.

**Breaking**

| Item | v1 | v2 |
|---|---|---|
| Node minimum | 20 LTS | **22** (24 recommended) |
| `@sap/cds` | `^9` | `^10` |
| `@sap/cds-dk` | `^9` | `^10` |
| `@cap-js/sqlite` / `postgres` / `hana` | `^2` | `^3` |
| `@sap/eslint-plugin-cds` | `^3` | `^4` |
| `@sap/xsenv` | `^5` | `^6` |
| Module system | CJS handlers | **ESM** (CAP 10 default) |
| `commander` | `^12` | `^15` |
| `@clack/prompts` | `^0.7` | `^1` |
| `execa` | `^8` | `^10` |
| `eslint` | `^9` | `^10` |
| `typescript` | `^5` | `^7` |

`@sap/approuter` `^22` and `prettier` `^3` were the only v1 pins that held.

**Removed work**

- **Vite scaffolding.** v1 shelled out to `npm create vite@latest` and patched `vite.config.ts` with a dev proxy. CAP 10 added `cds add react|vue`, which scaffolds the Vite app into `app/` and has `cds watch` mount it. One `cds add` call replaces three steps and a whole phase.
- **Approuter templates.** `approuter`, `destination`, and `html5-repo` are all built-in facets now. v1's hand-written `app/router/package.json` and `xs-app.json` templates are gone.
- **`mta.yaml` template.** v1 carried a ~120-line conditional MTA template. `cds add mta` plus the auth/db/approuter facets generate it. v2 patches module names instead of generating the file — far less to keep in sync.
- **`eslint.config.js` template.** `cds add lint` handles it.
- **§16 items on Vite CLI flags and `cds build` ignoring `app/frontend`.** Both moot.

**Added**

- cds-dk major-version guard in the doctor (§7.1) — cds-dk 9 silently produces a CAP 9 project without `react`/`vue` support.
- Conditional `@cap-js/cds-test` support for capx's fallback smoke test; no direct Chai dependencies are added.
- `yaml` as an installer dependency for `mta.yaml` patching.
- `cds add lint` facet.
- Phase 4 restructured into an explicit verification sweep before any patch code is written.
- §3 design principle: prefer facets over templates, always.
- README section pointing at `cds upgrade` for maintaining generated projects.

**Noted, no action required**

- CAP 10 switched its test framework to Vitest; Jest is on the way out.
- Native `node:sqlite` is the default SQLite driver; `better-sqlite3` / `sql.js` need explicit deps.
- `cds add hana` no longer generates `db/undeploy.json`.
- `cds add` and `cds build` now emit `engines` with caret LTS ranges — don't hand-write them.
- `cds add xsuaa --plan` exists for service-plan overrides.
- New facets out of scope for v0.1.0: `ai`, `event-mesh`, `event-mesh-shared`, `containerize`, `portal`, `attachments`, `audit-logging`, `notifications`.
