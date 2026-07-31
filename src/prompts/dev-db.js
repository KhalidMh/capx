import { select } from '@clack/prompts'

export function promptDevDb() {
  return select({
    message: 'Database for local development?',
    options: [
      { value: 'sqlite', label: 'SQLite (persistent file)' },
      { value: 'postgres', label: 'PostgreSQL (via Docker)' },
    ],
    initialValue: 'sqlite',
  })
}
