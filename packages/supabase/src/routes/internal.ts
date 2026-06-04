import type { RouteContext } from '@emulators/core'
import { getSupabaseStore } from '../store.js'

/** Inspection endpoints (not part of the real Supabase API). */
export function internalRoutes(ctx: RouteContext): void {
  const { app, store } = ctx
  const ss = () => getSupabaseStore(store)

  app.get('/internal/recoveries', (c) => {
    const recoveries = ss().recoveries.all().map(r => ({
      email: r.email,
      created_at: r.created_at,
    }))
    return c.json({ recoveries })
  })
}
