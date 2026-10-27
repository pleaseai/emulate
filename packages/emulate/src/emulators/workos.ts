import { seedFromConfig, workosPlugin } from '@pleaseai/emulate-workos'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('workos', { plugin: workosPlugin, seedFromConfig: widenSeed(seedFromConfig) })
