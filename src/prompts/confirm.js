import { confirm, note } from '@clack/prompts'

export function promptConfirmation(summary) {
  note(summary)
  return confirm({ message: 'Proceed?', initialValue: true })
}
