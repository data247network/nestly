import { useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { PairChild } from './setup'

/** Cloud-enrolled children are the primary device list; Bluetooth is optional. */
export function CloudFirstDevices() {
  const { household, updatedAt } = useCloudChildren()
  const { go, dispatch } = useStore()
  const [showBluetooth, setShowBluetooth] = useState(false)

  if (showBluetooth) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <button type="button" onClick={() => setShowBluetooth(false)} className="px-[22px] pt-5 text-left text-xs font-bold text-brand">
          ← Back to cloud devices
        </button>
        <div className="min-h-0 flex-1"><PairChild /></div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <div>
        <div className="text-[20px] font-bold">Devices</div>
        <div className="mt-1 text-[11.5px] text-body">
          Cloud-enrolled phones are shown even when Bluetooth is unavailable.
          {updatedAt ? ` Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}
        </div>
      </div>

      {household?.children.length ? (
        <div className="flex flex-col gap-2.5">
          {household.children.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => {
                dispatch({ type: 'activeChild', id: child.id })
                go('screentime')
              }}
              className="rounded-2xl bg-cream px-3.5 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                  {child.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold">{child.name}</div>
                  <div className="text-[11.5px] text-body">
                    {child.lastSeenAt ? `Last seen ${new Date(child.lastSeenAt).toLocaleString()}` : 'Waiting for first report'}
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${child.lastSeenAt ? 'bg-brand' : 'bg-muted'}`} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px] text-body">
                <span className="rounded-lg bg-white px-2 py-1.5">Internet: {child.lastSeenAt ? 'connected' : 'not seen'}</span>
                <span className="rounded-lg bg-white px-2 py-1.5">Bluetooth: optional</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] text-body">
          No cloud-enrolled child devices yet. Use Family Hub to create a setup code.
        </div>
      )}

      <button type="button" onClick={() => go('household')} className="rounded-2xl bg-brand px-4 py-3.5 text-left text-white">
        <span className="block text-[13.5px] font-bold">Add child with setup code</span>
        <span className="mt-0.5 block text-[11.5px] opacity-90">Works remotely — the phones do not need to be together.</span>
      </button>

      <button type="button" onClick={() => setShowBluetooth(true)} className="rounded-2xl border border-line px-4 py-3 text-left">
        <span className="block text-[13px] font-bold">Pair nearby over Bluetooth</span>
        <span className="mt-0.5 block text-[11.5px] text-body">Optional local connection for offline use and faster nearby sync.</span>
      </button>
    </div>
  )
}
