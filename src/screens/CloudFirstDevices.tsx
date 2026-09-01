import { useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { PairChild } from './setup'
import { useV2Dashboard } from '../cloud/v2'

/** Cloud-enrolled children and the v2 device registry are the primary device view. */
export function CloudFirstDevices() {
  const { household, updatedAt } = useCloudChildren()
  const { data: v2, loading, refresh } = useV2Dashboard(household?.id)
  const { go, dispatch } = useStore()
  const [showBluetooth, setShowBluetooth] = useState(false)

  if (showBluetooth) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <button type="button" onClick={() => setShowBluetooth(false)} className="px-[22px] pt-5 text-left text-xs font-bold text-brand">← Back to cloud devices</button>
        <div className="min-h-0 flex-1"><PairChild /></div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[20px] font-bold">Devices</div>
          <div className="mt-1 text-[11.5px] text-body">Cloud-enrolled phones stay visible even when Bluetooth is unavailable.</div>
          {updatedAt ? <div className="mt-1 text-[10.5px] text-body">Family sync updated {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</div> : null}
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-xl border border-line px-3 py-2 text-[11px] font-bold">{loading ? 'Updating…' : 'Refresh'}</button>
      </div>

      {household?.children.length ? (
        <div className="flex flex-col gap-2.5">
          {household.children.map((child) => {
            const device = v2.devices.find((item) => item.childId === child.id)
            return (
              <button key={child.id} type="button" onClick={() => { dispatch({ type: 'activeChild', id: child.id }); go('screentime') }} className="rounded-2xl bg-cream px-3.5 py-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{child.name.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold">{child.name}</div>
                    <div className="text-[11.5px] text-body">{device?.displayName ?? (child.lastSeenAt ? 'Cloud-connected device' : 'Waiting for device registration')}</div>
                  </div>
                  <div className={`h-2.5 w-2.5 rounded-full ${device?.enrollmentState === 'active' || child.lastSeenAt ? 'bg-brand' : 'bg-muted'}`} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-body">
                  <span className="rounded-lg bg-white px-2 py-1.5">State: <b>{device?.enrollmentState ?? 'pending'}</b></span>
                  <span className="rounded-lg bg-white px-2 py-1.5">Mode: <b>{device?.managementMode ?? 'standard'}</b></span>
                  <span className="rounded-lg bg-white px-2 py-1.5">Cloud: <b>{child.lastSeenAt ? 'connected' : 'waiting'}</b></span>
                </div>
              </button>
            )
          })}
        </div>
      ) : <div className="rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] text-body">No cloud-enrolled child devices yet. Use Family Hub to create a setup code.</div>}

      <button type="button" onClick={() => go('household')} className="rounded-2xl bg-brand px-4 py-3.5 text-left text-white"><span className="block text-[13.5px] font-bold">Add child with setup code</span><span className="mt-0.5 block text-[11.5px] opacity-90">Works remotely — the phones do not need to be together.</span></button>
      <button type="button" onClick={() => setShowBluetooth(true)} className="rounded-2xl border border-line px-4 py-3 text-left"><span className="block text-[13px] font-bold">Pair nearby over Bluetooth</span><span className="mt-0.5 block text-[11.5px] text-body">Optional local connection for offline use and faster nearby sync.</span></button>
    </div>
  )
}
