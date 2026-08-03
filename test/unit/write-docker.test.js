import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeDocker } from '../../src/steps/07-write-docker.js'

const directories = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('writeDocker', () => {
  it('writes the PostgreSQL compose, environment, and private CAP credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capx-docker-'))
    directories.push(directory)

    await writeDocker(directory, { name: 'bookshop' })

    await expect(readFile(join(directory, 'docker-compose.yml'), 'utf8')).resolves.toBe(`services:
  postgres:
    image: postgres:17-alpine
    container_name: bookshop-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-bookshop}
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data

volumes:
  pg-data:
`)
    await expect(readFile(join(directory, '.env'), 'utf8')).resolves.toBe(`POSTGRES_DB=bookshop
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
`)
    await expect(readFile(join(directory, '.cdsrc-private.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          requires: {
            db: {
              '[development]': {
                kind: 'postgres',
                credentials: {
                  host: 'localhost',
                  port: 5432,
                  user: 'postgres',
                  password: 'postgres',
                  database: 'bookshop',
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    )
  })
})
