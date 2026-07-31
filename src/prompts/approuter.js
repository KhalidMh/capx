import { confirm } from '@clack/prompts'

export function promptApprouter() {
  return confirm({
    message: 'Add a standalone approuter (proxy-only, no auth)?',
    initialValue: false,
  })
}
