import { join } from 'node:path'
import { writeFileAtomic } from '../utils/fs.js'
import { writeJson } from '../utils/json.js'

export async function writeDocker(projectDirectory, { name }) {
  await Promise.all([
    writeFileAtomic(
      join(projectDirectory, 'docker-compose.yml'),
      `services:
  postgres:
    image: postgres:17-alpine
    container_name: ${name}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-${name}}
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data

volumes:
  pg-data:
`,
    ),
    writeFileAtomic(
      join(projectDirectory, '.env'),
      `POSTGRES_DB=${name}
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
`,
    ),
    writeJson(join(projectDirectory, '.cdsrc-private.json'), {
      requires: {
        db: {
          '[development]': {
            kind: 'postgres',
            credentials: {
              host: 'localhost',
              port: 5432,
              user: 'postgres',
              password: 'postgres',
              database: name,
            },
          },
        },
      },
    }),
  ])
}
