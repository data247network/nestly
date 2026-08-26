import { Home as BluetoothHome } from './parent'
import { useCloudChildren } from '../app/CloudWatch'
import { useDevice } from '../platform/device'
import { useStore } from '../app/store'

/**
 * Cloud-first parent home. Bluetooth remains available, but an enrolled child
 * must never disappear merely because the phones are not beside each other.
 */
export function CloudFirstHome() {
  const { pairing } = useDevice()
  const { go, dispatch } = useStore()
  const { household, updatedAt } = useCloudChildren()

  if (pairing || !household?.children.length) return <BluetoothHome />

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] pb-5 pt-[26px]">
      <div>
        <div className="text-[13px] text-body">Your family</div>
        <div className="text-[22px] font-bold">{household.name}</div>
        <div className="mt-1 text-[11px] text-body">
          Cloud synced{updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {household.children.map((child) => (
          <button
            key={child.id}
            type="button"
            onClick={() => {
              dispatch({ type: 'activeChild', id: child.id })
              go('screentime')
            }}
            className="rounded-[18px] bg-cream p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {child.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{child.name}</div>
                <div className="text-[11.5px] text-body">
                  {child.lastSeenAt ? `Last seen ${new Date(child.lastSeenAt).toLocaleString()}` : 'No telemetry yet'}
                </div>
              </div>
              <div className={`h-2.5 w-2.5 rounded-full ${child.lastSeenAt ? 'bg-brand' : 'bg-muted'}`} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
              <div className="rounded-xl bg-white px-3 py-2">Location {child.fix ? 'available' : 'not yet reported'}</div>
              <div className="rounded-xl bg-white px-3 py-2">Internet sync {child.lastSeenAt ? 'active' : 'waiting'}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => go('map')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Map</button>
        <button type="button" onClick={() => go('pair')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Devices</button>
        <button type="button" onClick={() => go('alerts')} className="flex-1 rounded-xl bg-cream px-3 py-3 text-xs font-bold">Alerts</button>
      </div>

      <div className="mt-auto rounded-xl bg-tint px-3.5 py-3 text-[11.5px] leading-relaxed text-tealInk">
        Your child's phone can report over the internet when it is away from you. Bluetooth is an optional local fallback, not a requirement for the dashboard.
      </div>
    </div>
  )
}
