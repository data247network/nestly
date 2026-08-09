import type { ActivityEntry, Alert, Child } from './types'
import type { AppUsageEntry, SiteVisit } from '../link/protocol'

/**
 * Activity reporting and export.
 *
 * The report is built from what the parent device has actually received, not
 * from anything live — over Bluetooth the record is always a backlog. Every
 * export therefore states its coverage explicitly, including the last time each
 * child was heard from, so nobody reads a quiet week as a safe week when it was
 * really a week the phones were never near each other.
 */

export type ReportRange = { id: '7d' | '30d' | 'all'; label: string; days: number | null }

export const RANGES: ReportRange[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: 'all', label: 'Everything', days: null },
]

export type ReportSection = {
  child: Child
  lastSeenAt: number | null
  events: ActivityEntry[]
  alerts: Alert[]
  apps: AppUsageEntry[]
  sites: SiteVisit[]
  totals: {
    screenMinutes: number
    blockedCount: number
    zoneCrossings: number
    lockedSessions: number
  }
}

export type Report = {
  generatedAt: number
  range: ReportRange
  from: number | null
  sections: ReportSection[]
}

export type ReportInput = {
  children: Child[]
  activity: ActivityEntry[]
  alerts: Alert[]
  usageByChild: Record<string, { apps: AppUsageEntry[]; sites: SiteVisit[] } | undefined>
  lastSeenByChild: Record<string, number | null>
}

export function buildReport(input: ReportInput, range: ReportRange): Report {
  const from = range.days == null ? null : Date.now() - range.days * 86_400_000
  const inRange = (ts: number) => from == null || ts >= from

  const sections = input.children.map<ReportSection>((child) => {
    const events = input.activity
      .filter((e) => e.childId === child.id && inRange(e.ts))
      .sort((a, b) => b.ts - a.ts)
    const alerts = input.alerts
      .filter((a) => a.childId === child.id && inRange(a.ts))
      .sort((a, b) => b.ts - a.ts)
    const usage = input.usageByChild[child.id]
    const apps = usage?.apps ?? []
    const sites = usage?.sites ?? []

    return {
      child,
      lastSeenAt: input.lastSeenByChild[child.id] ?? null,
      events,
      alerts,
      apps,
      sites,
      totals: {
        screenMinutes: apps.reduce((n, a) => n + a.minutes, 0),
        blockedCount: sites.filter((s) => s.blocked).reduce((n, s) => n + s.count, 0),
        zoneCrossings: events.filter((e) => e.kind === 'zone-enter' || e.kind === 'zone-leave').length,
        lockedSessions: events.filter((e) => e.kind === 'lock-shown').length,
      },
    }
  })

  return { generatedAt: Date.now(), range, from, sections }
}

/* ----------------------------------------------------------------- CSV -- */

/**
 * RFC 4180 quoting. Worth doing properly: app labels and blocked domains are
 * attacker-adjacent strings, and a bare comma in one silently shifts every
 * column after it in whatever the parent opens this with.
 */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRows(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

const stamp = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19)

export function toCSV(report: Report): string {
  const rows: unknown[][] = [
    ['Nestly activity report'],
    ['Generated', stamp(report.generatedAt)],
    ['Range', report.range.label],
    [],
  ]

  for (const s of report.sections) {
    rows.push([`Child: ${s.child.name}`])
    rows.push([
      'Last heard from',
      s.lastSeenAt ? stamp(s.lastSeenAt) : 'never',
    ])
    rows.push(['Screen time (minutes)', s.totals.screenMinutes])
    rows.push(['Blocked requests', s.totals.blockedCount])
    rows.push(['Zone crossings', s.totals.zoneCrossings])
    rows.push([])

    if (s.apps.length) {
      rows.push(['App usage'])
      rows.push(['App', 'Package', 'Category', 'Minutes'])
      for (const a of s.apps) rows.push([a.label, a.pkg, a.category, a.minutes])
      rows.push([])
    }

    if (s.sites.length) {
      rows.push(['Sites'])
      rows.push(['Domain', 'Requests', 'Blocked', 'Category', 'Last seen'])
      for (const v of s.sites) {
        rows.push([v.domain, v.count, v.blocked ? 'yes' : 'no', v.cat ?? '', stamp(v.lastAt)])
      }
      rows.push([])
    }

    if (s.events.length) {
      rows.push(['Activity trail'])
      rows.push(['When', 'Event', 'Detail'])
      for (const e of s.events) rows.push([stamp(e.ts), e.kind, e.ref ?? ''])
      rows.push([])
    }
    rows.push([])
  }

  if (report.sections.length === 0) rows.push(['No paired children.'])
  return csvRows(rows)
}

/* ----------------------------------------------------------------- PDF -- */

const BRAND = '#147D77'
const INK = '#1E2A32'
const BODY = '#6B7680'

/**
 * Builds the PDF with jsPDF, imported dynamically so the ~350 KB library is not
 * in the main bundle — it is only needed the moment someone taps Export, and
 * this app opens on a locked child's phone where startup time matters.
 */
export async function toPDF(report: Report): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 15
  const W = 210
  let y = M

  const page = () => {
    doc.addPage()
    y = M
  }
  const room = (need: number) => {
    if (y + need > 297 - M) page()
  }

  const text = (s: string, size: number, color: string, bold = false, indent = 0) => {
    doc.setFontSize(size)
    doc.setTextColor(color)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const lines = doc.splitTextToSize(s, W - M * 2 - indent) as string[]
    for (const line of lines) {
      room(size * 0.45)
      doc.text(line, M + indent, y)
      y += size * 0.45
    }
  }

  // Header
  doc.setFillColor(BRAND)
  doc.rect(0, 0, W, 26, 'F')
  doc.setTextColor('#FFFFFF')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Nestly activity report', M, 16)
  y = 38

  text(`Generated ${stamp(report.generatedAt)}`, 10, BODY)
  text(`Range: ${report.range.label}`, 10, BODY)
  y += 4

  if (report.sections.length === 0) {
    text('No paired children.', 11, INK)
  }

  for (const s of report.sections) {
    room(30)
    y += 4
    text(s.child.name, 14, INK, true)
    text(
      s.lastSeenAt
        ? `Last heard from ${stamp(s.lastSeenAt)}`
        : 'Never heard from this device.',
      9,
      BODY,
    )
    y += 2

    const t = s.totals
    text(
      `Screen time ${Math.floor(t.screenMinutes / 60)}h ${t.screenMinutes % 60}m  ·  ` +
        `${t.blockedCount} blocked  ·  ${t.zoneCrossings} zone crossings  ·  ` +
        `${t.lockedSessions} locked sessions`,
      10,
      INK,
    )
    y += 3

    const table = (title: string, head: string[], rows: string[][], widths: number[]) => {
      if (rows.length === 0) return
      room(16)
      y += 3
      text(title, 11, INK, true)
      y += 1

      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(BODY)
      let x = M
      head.forEach((h, i) => {
        doc.text(h, x, y)
        x += widths[i]
      })
      y += 4
      doc.setDrawColor('#E7E1D6')
      doc.line(M, y - 2.5, W - M, y - 2.5)

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(INK)
      for (const r of rows) {
        room(5)
        x = M
        r.forEach((cell, i) => {
          // Trim to the column rather than letting it run into the next one.
          const max = widths[i] - 2
          let out = cell
          while (doc.getTextWidth(out) > max && out.length > 1) out = out.slice(0, -1)
          doc.text(out, x, y)
          x += widths[i]
        })
        y += 4.5
      }
    }

    table(
      'App usage',
      ['App', 'Category', 'Minutes'],
      s.apps.slice(0, 25).map((a) => [a.label, a.category, String(a.minutes)]),
      [95, 45, 40],
    )

    table(
      'Sites',
      ['Domain', 'Requests', 'Blocked', 'Category'],
      s.sites.slice(0, 30).map((v) => [v.domain, String(v.count), v.blocked ? 'yes' : 'no', v.cat ?? '—']),
      [85, 30, 30, 35],
    )

    table(
      'Activity trail',
      ['When', 'Event', 'Detail'],
      s.events.slice(0, 60).map((e) => [stamp(e.ts), e.kind, e.ref ?? '']),
      [45, 55, 80],
    )
    y += 4
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(BODY)
    doc.setFont('helvetica', 'normal')
    doc.text('Nestly — family safety, gently done.', M, 289)
    doc.text(`${i} / ${pages}`, W - M, 289, { align: 'right' })
  }

  return doc.output('blob')
}

export function reportFilename(report: Report, ext: 'csv' | 'pdf'): string {
  const d = new Date(report.generatedAt)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `nestly-activity-${day}.${ext}`
}
