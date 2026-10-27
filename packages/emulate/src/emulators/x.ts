import { seedFromConfig, xPlugin } from '@pleaseai/emulate-x'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('x', { plugin: xPlugin, seedFromConfig: widenSeed(seedFromConfig) })
