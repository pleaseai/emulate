/**
 * Regenerates src/content/docs/services/*.md from ../skills/<service>/SKILL.md.
 * Run from website/: bun scripts/sync-services.ts
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const SKILLS = join(ROOT, 'skills')
const OUT = join(import.meta.dir, '..', 'src', 'content', 'docs', 'services')

// Sidebar order follows default port assignment; label is the display name.
const SERVICES: Record<string, { label: string, port: number, order: number }> = {
  kakao: { label: 'Kakao', port: 4000, order: 1 },
  naver: { label: 'Naver', port: 4001, order: 2 },
  tosspayments: { label: 'Toss Payments', port: 4002, order: 3 },
  firebase: { label: 'Firebase', port: 4003, order: 4 },
  supabase: { label: 'Supabase', port: 4004, order: 5 },
  asana: { label: 'Asana', port: 4005, order: 6 },
  linear: { label: 'Linear', port: 4006, order: 7 },
  autumn: { label: 'Autumn', port: 4007, order: 8 },
  gitlab: { label: 'GitLab', port: 4008, order: 9 },
  posthog: { label: 'PostHog', port: 4009, order: 10 },
  spotify: { label: 'Spotify', port: 4010, order: 11 },
  workos: { label: 'WorkOS', port: 4011, order: 12 },
  x: { label: 'X (Twitter)', port: 4012, order: 13 },
}

function firstSentence(text: string): string {
  const normalized = text.replaceAll('\n', ' ').trim()
  const match = normalized.match(/^.*?[.!?](?:\s|$)/)
  return (match ? match[0] : normalized).trim()
}

for (const dir of await readdir(SKILLS)) {
  const meta = SERVICES[dir]
  if (!meta) {
    console.warn(`skip: no service mapping for skills/${dir}`)
    continue
  }
  const raw = await Bun.file(join(SKILLS, dir, 'SKILL.md')).text()

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/)
  if (!fmMatch) {
    throw new Error(`no frontmatter in skills/${dir}/SKILL.md`)
  }
  const descMatch = fmMatch[1].match(/^description: (.*)$/m)
  const description = firstSentence(descMatch?.[1] ?? '')

  let body = raw.slice(fmMatch[0].length).trim()
  // Drop the leading H1 — Starlight renders the frontmatter title instead.
  body = body.replace(/^# .*\n+/, '')

  // npm package names use the directory name under packages/, which differs
  // from the skill/service name for tosspayments.
  const pkg = `@pleaseai/emulate-${dir === 'tosspayments' ? 'toss-payments' : dir}`

  const page = `---
title: ${meta.label}
description: ${JSON.stringify(description)}
sidebar:
  label: ${meta.label}
  order: ${meta.order}
---

:::note
Default port **${meta.port}** · Package [\`${pkg}\`](https://www.npmjs.com/package/${pkg})
:::

${body}
`
  await Bun.write(join(OUT, `${dir}.md`), page)
  console.log(`wrote services/${dir}.md`)
}
