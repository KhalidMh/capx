import { select } from '@clack/prompts'

export function promptProdDb() {
  return select({
    message: 'Database for production?',
    options: [
      { value: 'hana', label: 'SAP HANA Cloud' },
      { value: 'postgres', label: 'PostgreSQL on BTP' },
    ],
    initialValue: 'hana',
  })
}
