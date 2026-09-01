import { useMemo } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { useV2Dashboard } from '../cloud/v2'

export function SchoolModeV2(){
  const {go}=useStore(); const {household}=useCloudChildren(); const {data,loading,error,refresh}=useV2Dashboard(household?.id)
  const school=useMemo(()=>data.routines.filter(r=>/school|class|lesson/i.test(r.name)),[data.routines])
  return <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7">
    <button onClick={()=>go('v2control')} className="mb-5 w-fit text-xs font-bold text-brand">← Control centre</button>
    <div className="flex items-start justify-between gap-3"><div><div className="text-xs text-body">FAMILY SAFETY</div><h1 className="mt-1 text-2xl font-bold">School Mode</h1><p className="mt-1 text-xs text-body">Keep learning time focused while preserving essential communication.</p></div><button onClick={()=>void refresh()} className="rounded-xl border border-line px-3 py-2 text-xs font-bold">Refresh</button></div>
    <section className="mt-5 rounded-2xl bg-tint p-5"><div className="text-xs font-bold text-tealInk">HOW SCHOOL MODE WORKS</div><div className="mt-2 text-lg font-bold">Learning first. Family contact stays protected.</div><p className="mt-2 text-xs leading-relaxed text-body">A school routine can apply focused access rules during the scheduled period. Emergency contacts should remain available.</p></section>
    <section className="mt-6"><h2 className="mb-3 text-sm font-bold">School routines</h2>{loading?<div className="rounded-2xl bg-cream p-4 text-xs text-body">Loading routines…</div>:school.length?school.map(r=><div key={r.id} className="mb-2 rounded-2xl bg-cream p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">{r.name}</div><div className="mt-1 text-[11px] text-body">{r.active?'Active':'Inactive'} · {r.timezone}</div></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{r.active?'ON':'OFF'}</span></div><p className="mt-3 text-xs text-body">Open routine settings to review schedules and restrictions.</p><button onClick={()=>go('scenario')} className="mt-3 rounded-xl border border-line px-3 py-2 text-xs font-bold">Manage routine</button></div>):<div className="rounded-2xl bg-cream p-4 text-xs text-body">No school routine is configured yet. Create one in routine settings.</div>}</section>
    <section className="mt-6"><h2 className="mb-3 text-sm font-bold">Safety checklist</h2><div className="space-y-2">{['Emergency contacts remain available','Parent can review active device status','Restrictions are applied through the policy flow'].map(text=><div key={text} className="rounded-xl border border-line p-3 text-xs">✓ {text}</div>)}</div></section>
    <button onClick={()=>go('scenario')} className="mt-6 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white">Manage School Mode</button>
    {error&&<div className="mt-4 rounded-xl border border-line p-3 text-xs text-body">{error}</div>}
  </div>
}
