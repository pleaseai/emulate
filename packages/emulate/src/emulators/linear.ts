import { linearPlugin, seedFromConfig } from '@pleaseai/emulate-linear'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('linear', { plugin: linearPlugin, seedFromConfig: widenSeed(seedFromConfig) })
