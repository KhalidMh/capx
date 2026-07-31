import { select } from '@clack/prompts'

export function promptFrontend() {
  return select({
    message: 'Frontend framework?',
    options: [
      { value: 'none', label: 'None (backend only)' },
      { value: 'vue', label: 'Vue (Vite)' },
      { value: 'react', label: 'React (Vite)' },
    ],
    initialValue: 'none',
  })
}
