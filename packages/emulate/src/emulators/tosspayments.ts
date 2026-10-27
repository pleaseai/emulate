import { seedFromConfig, tossPaymentsPlugin } from '@pleaseai/emulate-toss-payments'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('tosspayments', { plugin: tossPaymentsPlugin, seedFromConfig: widenSeed(seedFromConfig) })
