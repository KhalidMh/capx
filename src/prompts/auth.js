import { select } from '@clack/prompts'

export function promptAuth() {
  return select({
    message: 'Authentication?',
    options: [
      { value: 'none', label: 'None' },
      { value: 'xsuaa', label: 'XSUAA (mocked in dev)' },
      { value: 'ias', label: 'IAS (mocked in dev)' },
    ],
    initialValue: 'xsuaa',
  })
}
