import { useDevice } from '../platform/device'
import { useStore } from '../app/store'

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const { go } = useStore()
  return <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7">
    <button onClick={() => go('childHome')} className="mb-5 w-fit text-xs font-bold text-brand">← Back</button>
    <h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-xs text-body">{subtitle}</p>
    <div className="mt-6 space-y-3">{children}</div>
  </div>
}

export function ChildRoutinesV2() {
  const { agent } = useDevice()
  return <Shell title="My routines" subtitle="See what is happening on your device.">
    <div className="rounded-2xl bg-tint p-4"><b className="text-sm">{agent?.activeScenario?.name ?? 'No routine active'}</b><p className="mt-1 text-xs text-body">{agent?.activeScenario ? `Ends in ${agent.unlocksInMin ?? 0} minutes.` : 'Your normal device access is available.'}</p></div>
    <div className="rounded-2xl bg-cream p-4 text-xs text-body">When a routine is active, emergency communication should remain available.</div>
  </Shell>
}

export function ChildRequestsV2() {
  return <Shell title="My requests" subtitle="Ask your parent for help or more access.">
    <Request label="Request more time" detail="Ask for extra device time." />
    <Request label="Ask to use an app" detail="Request access to an app that is currently limited." />
    <Request label="Send a message" detail="Contact your parent through the Family Hub." />
  </Shell>
}

export function ChildRewardsV2() {
  return <Shell title="My rewards" subtitle="Keep track of the good things you earn.">
    <div className="rounded-2xl bg-tint p-5"><div className="text-xs text-body">CURRENT REWARDS</div><div className="mt-2 text-2xl font-bold">Coming from your family plan</div><p className="mt-2 text-xs text-body">Rewards will appear here when your parent creates them.</p></div>
  </Shell>
}

function Request({ label, detail }: { label: string; detail: string }) { return <button className="w-full rounded-2xl bg-cream p-4 text-left"><div className="text-sm font-bold">{label}</div><div className="mt-1 text-xs text-body">{detail}</div></button> }
