import { naverPlugin, seedFromConfig } from '@pleaseai/emulate-naver'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('naver', { plugin: naverPlugin, seedFromConfig: widenSeed(seedFromConfig) })
