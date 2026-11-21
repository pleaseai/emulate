import { seedFromConfig, tossinvestPlugin } from '@pleaseai/emulate-tossinvest'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('tossinvest', { plugin: tossinvestPlugin, seedFromConfig: widenSeed(seedFromConfig) })
