import { jiraPlugin, seedFromConfig } from '@pleaseai/emulate-jira'
import { defineServiceEmulator } from '../custom-emulator.js'
import { widenSeed } from '../registry.js'

export default defineServiceEmulator('jira', { plugin: jiraPlugin, seedFromConfig: widenSeed(seedFromConfig) })
