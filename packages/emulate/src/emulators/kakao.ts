import { kakaoPlugin, seedFromConfig } from '@pleaseai/emulate-kakao'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('kakao', { plugin: kakaoPlugin, seedFromConfig: widenSeed(seedFromConfig) })
