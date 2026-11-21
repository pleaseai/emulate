import { firebasePlugin, seedFromConfig } from '@pleaseai/emulate-firebase'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('firebase', { plugin: firebasePlugin, seedFromConfig: widenSeed(seedFromConfig) })
