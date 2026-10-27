import { autumnPlugin, seedFromConfig } from '@pleaseai/emulate-autumn'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('autumn', { plugin: autumnPlugin, seedFromConfig: widenSeed(seedFromConfig) })
