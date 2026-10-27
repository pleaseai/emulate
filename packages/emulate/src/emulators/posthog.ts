import { posthogPlugin, seedFromConfig } from '@pleaseai/emulate-posthog'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('posthog', { plugin: posthogPlugin, seedFromConfig: widenSeed(seedFromConfig) })
