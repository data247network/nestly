import { useMemo, useState } from 'react'
import { useStore, fmtDuration } from '../app/store'
import { RANGES, buildReport, reportFilename, toCSV, toPDF } from '../app/report'
import { shareGenerated } from '../platform/exportFile'
import { useDevice } from '../platform/device'
import { useCloudChildren } from '../app/CloudWatch'
import {
  Avatar,
  Display,
  GhostButton,
  Pill,
  PrimaryButton,
  ScreenTitle,
  SectionTitle,
} from '../ui/kit'

/** Parent report backed by cloud data, with Bluetooth as the local fallback. */
export function ActivityReport() {
  const { state, dispatch } = useStore()
  const { children: live } = useDevice()
  const { household } = useCloudChildren()
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const range = RANGES.find((r) => r.id === state.reportRange) ?? RANGES[0]

  const cloudLastSeen = useMemo(
    () =>
      new Map(
        (household?.children ?? []).map((c) => [
          c.id,
          normaliseTimestamp(c.lastSeenAt),
        ]),
      ),
    [household],
  )

  const report = useMemo(
    () =>
      buildReport(
        {
          children: state.children,
          activity: state.activity,
          alerts: state.alerts,
          usageByChild: state.usageByChild,
          lastSeenByChild: Object.fromEntries(
            state.children.map((c) => [
              c.id,
              cloudLastSeen.get(c.id) ?? live.find((l) => l.deviceId === c.id)?.lastSeenAt ?? null,
            ]),
          ),
        },
        range,
      ),
    [state.children, state.activity, state.alerts, state.usageByChild, live, cloudLastSeen, range],
  )

  const exportAs = async (kind: 'csv' | 'pdf') => {
    setBusy(kind)
    setResult(null)
    try {
      const blob = kind === 'csv' ? new Blob([toCSV(report)], { type: 'text/csv;charset=utf-8' }) : await toPDF(report)
      const where = await shareGenerated(blob, reportFilename(report, kind))
      setResult(where)
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Reports</ScreenTitle>
      <div className="no-scrollbar -mx-[22px] flex gap-2 overflow-x-auto px-[22px]">
        {RANGES.map((r) => <Pill key={r.id} active={r.id === range.id} onClick={() => dispatch({ type: 'setReportRange', range: r.id })}>{r.label}</Pill>)}
      </div>

      {report.sections.length === 0 ? (
        <div className="rounded-2xl bg-cream px-4 py-8 text-center text-[12.5px] text-body">
          No paired children yet. Pair a phone from the Device tab and their activity will collect here.
        </div>
      ) : null}

      {report.sections.map((s) => (
        <section key={s.child.id} className="rounded-2xl bg-cream p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <Avatar name={s.child.name} color={s.child.avatar} size={34} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">{s.child.name}</div>
              <div className="text-[11px] text-body">
                {s.lastSeenAt ? `Last heard from ${new Date(s.lastSeenAt).toLocaleString()}` : 'Never heard from this device'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Screen time" value={fmtDuration(s.totals.screenMinutes)} />
            <Stat label="Blocked" value={String(s.totals.blockedCount)} />
            <Stat label="Zone crossings" value={String(s.totals.zoneCrossings)} />
            <Stat label="Locked sessions" value={String(s.totals.lockedSessions)} />
          </div>
          {s.apps.length > 0 ? (
            <div className="mt-3.5">
              <SectionTitle>Top apps</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {s.apps.slice(0, 5).map((a) => <div key={a.pkg} className="flex justify-between text-[12px]"><span className="truncate">{a.label}</span><span className="shrink-0 pl-2 text-body">{fmtDuration(a.minutes)}</span></div>)}
              </div>
            </div>
          ) : null}
          {s.events.length === 0 ? <div className="mt-3 text-[11.5px] text-muted">Nothing recorded in this period.</div> : <div className="mt-3 text-[11.5px] text-muted">{s.events.length} recorded events · {s.alerts.length} alerts</div>}
        </section>
      ))}

      {result ? <div className="rounded-xl bg-tint px-3.5 py-3 text-[12px] text-tealInk">{result}</div> : null}
      <div className="flex-1" />
      <div className="flex gap-2.5">
        <GhostButton onClick={() => void exportAs('csv')}>{busy === 'csv' ? 'Exporting…' : 'Export CSV'}</GhostButton>
        <PrimaryButton onClick={() => void exportAs('pdf')}>{busy === 'pdf' ? 'Exporting…' : 'Export PDF'}</PrimaryButton>
      </div>
      <p className="text-center text-[10.5px] leading-relaxed text-muted">Exports cover only what has synced to this phone. A quiet period may mean the phones were simply apart.</p>
    </div>
  )
}

function normaliseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-white px-3 py-2.5"><Display className="text-[17px] leading-none">{value}</Display><div className="mt-1 text-[10.5px] text-body">{label}</div></div>
}
