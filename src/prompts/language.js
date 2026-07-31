import { select } from '@clack/prompts'

export function promptLanguage() {
  return select({
    message: 'Backend language?',
    options: [
      { value: 'js', label: 'JavaScript (ESM)' },
      { value: 'ts', label: 'TypeScript' },
    ],
    initialValue: 'js',
  })
}
