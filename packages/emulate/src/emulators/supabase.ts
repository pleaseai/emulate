import { seedFromConfig, supabasePlugin } from '@pleaseai/emulate-supabase'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('supabase', { plugin: supabasePlugin, seedFromConfig: widenSeed(seedFromConfig) })
