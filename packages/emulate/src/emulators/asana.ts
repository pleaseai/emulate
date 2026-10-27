import { asanaPlugin, seedFromConfig } from '@pleaseai/emulate-asana'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('asana', { plugin: asanaPlugin, seedFromConfig: widenSeed(seedFromConfig) })
