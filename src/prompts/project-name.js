import { text } from '@clack/prompts'

export function validateProjectName(value) {
  if (!value) return 'Required'
  if (value.length > 64) return 'Max 64 characters'
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(value)) {
    return 'Must start with alphanumeric or _, then [a-zA-Z0-9_-] only'
  }
}

export function promptProjectName() {
  return text({
    message: 'Project name?',
    placeholder: 'my-cap-app',
    validate: validateProjectName,
  })
}
