import { useState } from 'react'
import { Home as BluetoothHome } from './parent'
import { useCloudChildren } from '../app/CloudWatch'
import { useDevice } from '../platform/device'
import { useStore } from '../app/store'
import { resolveChildRequest, useV2Dashboard } from '../cloud/v2'
import type { ChildRequest } from '../domain/v2'

/**
 * Architecture v2 parent dashboard. The existing cloud roster remains the
 * source for children, while v2 adds devices, requests, routines and safety
 * status around the same household.
 */
export function CloudFirstHome() {
  const { pairing } = useDevice()
  const { go, dispatch } = useStore()
  const { household, updatedAt } = useCloudChildren()
  const { data: v2, loading, error, refresh } = useV2Dashboard(household?.id)
  const [busy, setBusy] = useState<string | null>(null)

  if (pairing || !household?.children.length) return <BluetoothHome />

  const nameFor = (childId: string) => household.children.find((child) => child.id === childId)?.name ?? 'Child'
  const deviceFor = (childId: string) => v2.devices.find((device) => device.childId === childId)
  const locationFor = (childId: string) => v2.locations.find((location) => location.childId === childId)

  const resolve = async (request: ChildRequest, approved: boolean) => {
    setBusy(request.id)
    try { await resolveChildRequest(request, approved); await refresh() }
    catch { /* keep the request visible so the parent can retry */ }
    finally { setBusy(null) }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] pb-5 pt-[26px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-body">Your family</div>
          <div className="text-[22px] font-bold">{household.name}</div>
          <div className="mt-1 text-[11px] text-body">
            Cloud synced{updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-xl border border-line px-3 py-2 text-[11px] font-bold">
          Refresh
        </button>
      </div>

      <section className="grid grid-cols-3 gap-2 text-center">
        <Stat value={String(household.children.length)} label="Children" />
        <Stat value={String(v2.devices.filter((d) => d.enrollmentState === 'active').length)} label="Active devices" />
        <Stat value={String(v2.requests.length)} label="Requests" />
      </section>

      <div className="flex flex-col gap-3">
        {household.children.map((child) => {
          const device = deviceFor(child.id)
          const location = locationFor(child.id)
          return (
            <div key={child.id} className="rounded-[18px] bg-cream p-4 text-left">
              <button
                type="button"
                onClick={() => { dispatch({ type: 'activeChild', id: child.id }); go('screentime') }}
                className="w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {child.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">{child.name}</div>
                    <div className="text-[11.5px] text-body">
                      {device?.displayName ?? (child.lastSeenAt ? 'Cloud-connected child device' : 'Waiting for first device report')}
                    </div>
                  </div>
                  <div className={`h-2.5 w-2.5 rounded-full ${device?.enrollmentState === 'active' || child.lastSeenAt ? 'bg-brand' : 'bg-muted'}`} />
                </div>
              </button>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10.5px]">
                <div className="rounded-xl bg-white px-2 py-2">Device<br /><b>{device?.enrollmentState ?? 'pending'}</b></div>
                <div className="rounded-xl bg-white px-2 py-2">Location<br /><b>{location || child.fix ? 'available' : 'waiting'}</b></div>
                <div className="rounded-xl bg-white px-2 py-2">Battery<br /><b>{location?.battery != null ? `${location.battery}%` : '—'}</b></div>
              </div>
            </div>
          )
        })}
      </div>

      {v2.requests.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-bold">Waiting for approval</h2><span className="text-[11px] text-body">{v2.requests.length}</span></div>
          <div className="flex flex-col gap-3">
            {v2.requests.map((request) => (
              <div key={request.id} className="rounded-xl bg-cream p-3">
                <div className="text-[12px] font-bold">{nameFor(request.childId)} · {requestLabel(request)}</div>
                <div className="mt-1 text-[11px] text-body">Requested {new Date(request.requestedAt).toLocaleString()}</div>
                <div className="mt-2 flex gap-2">
                  <button disabled={busy === request.id} type="button" onClick={() => void resolve(request, false)} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[11px] font-bold disabled:opacity-50">Decline</button>
                  <button disabled={busy === request.id} type="button" onClick={() => void resolve(request, true)} className="flex-1 rounded-lg bg-brand px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">Approve</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center justify-between"><h2 className="text-[14px] font-bold">Family safety</h2><span className="text-[11px] text-body">{loading ? 'Updating…' : 'Architecture v2'}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <button type="button" onClick={() => go('map')} className="rounded-xl bg-cream px-3 py-3 text-left"><b>Safe zones</b><br /><span className="text-body">{v2.safeZones.length} active</span></button>
          <button type="button" onClick={() => go('screentime')} className="rounded-xl bg-cream px-3 py-3 text-left"><b>Screen time</b><br /><span className="text-body">Manage rules</span></button>
          <button type="button" onClick={() => go('scenario')} className="rounded-xl bg-cream px-3 py-3 text-left"><b>Routines</b><br /><span className="text-body">{v2.routines.length} active</span></button>
          <button type="button" onClick={() => go('pair')} className="rounded-xl bg-cream px-3 py-3 text-left"><b>Devices</b><br /><span className="text-body">{v2.devices.length} registered</span></button>
        </div>
        {error ? <div className="mt-3 text-[11px] text-body">Some v2 data could not refresh. Existing family controls remain available.</div> : null}
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={() => go('map')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Map</button>
        <button type="button" onClick={() => go('pair')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Devices</button>
        <button type="button" onClick={() => go('alerts')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Alerts</button>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="rounded-xl bg-tint px-2 py-3"><div className="text-[17px] font-bold">{value}</div><div className="text-[10px] text-body">{label}</div></div>
}

function requestLabel(request: ChildRequest): string {
  if (request.kind === 'extra_screen_time') {
    const minutes = request.payload.minutes ?? request.payload.screenTimeMinutes
    return minutes ? `Requests ${minutes} extra minutes` : 'Requests extra screen time'
  }
  if (request.kind === 'temporary_unlock') return 'Requests a temporary unlock'
  if (request.kind === 'app_access') return 'Requests app access'
  if (request.kind === 'routine_exception') return 'Requests a routine exception'
  return 'Has a family request'
}
