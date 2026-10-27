export const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

function offsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export function isoWithOffset(ms: number, offsetMinutes: number, withMillis = false): string {
  const d = new Date(ms + offsetMinutes * 60_000)
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return `${base}${withMillis ? `.${pad(d.getUTCMilliseconds(), 3)}` : ''}${offsetSuffix(offsetMinutes)}`
}

export function kstIso(ms: number, withMillis = false): string {
  return isoWithOffset(ms, 540, withMillis)
}

export function dayIdxToDate(dayIdx: number): string {
  return new Date(dayIdx * DAY_MS).toISOString().slice(0, 10)
}

export function dateToDayIdx(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined
  }
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    return undefined
  }
  return Math.floor(ms / DAY_MS)
}

export function kstDayIdx(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS)
}

export function kstToday(now = Date.now()): string {
  return dayIdxToDate(kstDayIdx(now))
}

export function weekday(dayIdx: number): number {
  return (dayIdx + 4) % 7
}

export function isBusinessDay(dayIdx: number): boolean {
  const w = weekday(dayIdx)
  return w !== 0 && w !== 6
}

export function prevBusinessDay(dayIdx: number): number {
  let d = dayIdx - 1
  while (!isBusinessDay(d)) {
    d--
  }
  return d
}

export function nextBusinessDay(dayIdx: number): number {
  let d = dayIdx + 1
  while (!isBusinessDay(d)) {
    d++
  }
  return d
}

export function businessDayOnOrBefore(dayIdx: number): number {
  return isBusinessDay(dayIdx) ? dayIdx : prevBusinessDay(dayIdx)
}

export function addBusinessDays(dayIdx: number, n: number): number {
  let d = dayIdx
  for (let i = 0; i < n; i++) {
    d = nextBusinessDay(d)
  }
  return d
}

function nthSunday(year: number, month: number, n: number): number {
  const first = Math.floor(Date.UTC(year, month, 1) / DAY_MS)
  const firstSunday = first + ((7 - weekday(first)) % 7)
  return firstSunday + (n - 1) * 7
}

export function usIsDst(dayIdx: number): boolean {
  const year = new Date(dayIdx * DAY_MS).getUTCFullYear()
  return dayIdx >= nthSunday(year, 2, 2) && dayIdx < nthSunday(year, 10, 1)
}

export function usOffsetMinutes(dayIdx: number): number {
  return usIsDst(dayIdx) ? -240 : -300
}

export function usDayIdx(ms: number): number {
  const approx = Math.floor((ms - 300 * 60_000) / DAY_MS)
  return Math.floor((ms + usOffsetMinutes(approx) * 60_000) / DAY_MS)
}

export function localMidnightMs(dayIdx: number, offsetMinutes: number): number {
  return dayIdx * DAY_MS - offsetMinutes * 60_000
}

/** Parses an ISO 8601 date-time query value. `+` decoded as a space is restored. */
export function parseDateTime(value: string): number | undefined {
  const normalized = value.trim().replace(' ', '+')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
    return undefined
  }
  const ms = Date.parse(normalized)
  return Number.isNaN(ms) ? undefined : ms
}
