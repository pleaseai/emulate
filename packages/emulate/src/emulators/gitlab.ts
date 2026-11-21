import { gitlabPlugin, seedFromConfig } from '@pleaseai/emulate-gitlab'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('gitlab', { plugin: gitlabPlugin, seedFromConfig: widenSeed(seedFromConfig) })
