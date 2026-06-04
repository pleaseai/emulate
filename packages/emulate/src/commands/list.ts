import pc from 'picocolors'
import { SERVICE_NAMES, SERVICE_REGISTRY } from '../registry.js'

export function listCommand(): void {
  console.log()
  console.log(pc.bold('  Available services'))
  console.log()
  for (const name of SERVICE_NAMES) {
    const entry = SERVICE_REGISTRY[name]
    console.log(`  ${pc.bold(name.padEnd(14))} ${entry.label}`)
    console.log(`    ${pc.dim(entry.endpoints)}`)
  }
  console.log()
}
