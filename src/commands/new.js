export function printNewCommandArgs(name, options) {
  console.log(JSON.stringify({ name, force: options.force }))
}
