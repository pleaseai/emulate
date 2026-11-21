import { seedFromConfig, spotifyPlugin } from '@pleaseai/emulate-spotify'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('spotify', { plugin: spotifyPlugin, seedFromConfig: widenSeed(seedFromConfig) })
