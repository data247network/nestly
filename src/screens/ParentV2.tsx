import { useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { resolveChildRequest, useV2Dashboard } from '../cloud/v2'
import type { ChildRequest } from '../domain/v2'

export function ParentV2() {
  const { go, dispatch } = useStore()
  const { household } = useCloudChildren()
  const { data, loading, error, refresh } = useV2Dashboard(household?.id)
  const [tab, setTab] = useState<'overview' | 'safety' | 'family'>('overview')
  const [resolving, setResolving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const active = data.devices.filter((d) => d.enrollmentState === 'active').length
  const choose = (id: string) => { dispatch({ type: 'activeChild', id }); go('screentime') }
  const decide = async (request: ChildRequest, approved: boolean) => {
    setResolving(request.id); setActionError(null)
    try { await resolveChildRequest(request, approved); await refresh() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update the child request.') }
    finally { setResolving(null) }
  }
  return <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7">
    <div className="flex items-start justify-between"><div><div className="text-xs text-body">NESTLY FAMILY</div><h1 className="mt-1 text-2xl font-bold">Control centre</h1><p className="mt-1 text-xs text-body">One clear view of your family's safety.</p></div><button onClick={() => void refresh()} className="rounded-xl border border-line px-3 py-2 text-xs font-bold">Refresh</button></div>
    <div className="mt-5 grid grid-cols-3 gap-2"><Metric label="Children" value={String(household?.children.length ?? 0)} /><Metric label="Protected" value={String(active)} /><Metric label="Requests" value={String(data.requests.length)} /></div>
    <div className="mt-5 flex gap-2">{(['overview','safety','family'] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold ${tab===item?'bg-brand text-white':'bg-cream text-body'}`}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div>
    {tab==='overview' && <><Section title="Your children">{(household?.children ?? []).map((child) => { const device=data.devices.find((d)=>d.childId===child.id); return <button key={child.id} onClick={() => choose(child.id)} className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-cream p-4 text-left"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand font-bold text-white">{child.name.slice(0,1)}</div><div className="flex-1"><b className="text-sm">{child.name}</b><div className="mt-1 text-[11px] text-body">{device?.displayName ?? 'No device connected'}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${device?.enrollmentState==='active'?'bg-tint text-tealInk':'bg-white text-body'}`}>{device?.enrollmentState ?? 'pending'}</span></button>})}</Section><Section title="Quick controls"><div className="grid grid-cols-2 gap-2"><Quick label="School mode" detail="Schedules & safe access" onClick={()=>go('scenario')} /><Quick label="Devices" detail={`${data.devices.length} registered`} onClick={()=>go('pair')} /><Quick label="Safe zones" detail={`${data.safeZones.length} zones`} onClick={()=>go('map')} /><Quick label="Family hub" detail="Messages & support" onClick={()=>go('hub')} /></div></Section></>}
    {tab==='safety' && <><Section title="Safety controls"><div className="grid grid-cols-1 gap-2"><Quick label="Screen time" detail="Limits and routines" onClick={()=>go('screentime')} /><Quick label="School mode" detail="Emergency contacts stay available" onClick={()=>go('scenario')} /><Quick label="Emergency contacts" detail="Mum, Dad and trusted adults" onClick={()=>go('contacts')} /><Quick label="Web & app activity" detail="Filtering and reports" onClick={()=>go('activity')} /></div></Section><div className="rounded-2xl bg-tint p-4 text-xs text-tealInk"><b>Safety principle</b><p className="mt-1 leading-relaxed">Emergency communication should remain available even when routines or restrictions are active.</p></div></>}
    {tab==='family' && <><Section title="Family routines"><div className="rounded-2xl bg-cream p-4 text-sm"><b>{data.routines.length} active routines</b><p className="mt-1 text-xs text-body">Manage school, bedtime and family routines.</p><button onClick={()=>go('scenario')} className="mt-3 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white">Manage routines</button></div></Section><Section title="Child requests">{data.requests.length ? data.requests.map((r)=><div key={r.id} className="mb-2 rounded-2xl border border-line p-4 text-xs"><b className="capitalize">{r.kind.replaceAll('_',' ')}</b><div className="mt-1 text-body">Awaiting your decision</div>{r.kind==='extra_screen_time' && <div className="mt-1 text-body">Requested: {Number(r.payload.minutes ?? r.payload.screenTimeMinutes ?? 0)} minutes</div>}<div className="mt-3 flex gap-2"><button disabled={resolving===r.id} onClick={()=>void decide(r,true)} className="rounded-xl bg-brand px-3 py-2 font-bold text-white disabled:opacity-50">{resolving===r.id?'Updating…':'Approve'}</button><button disabled={resolving===r.id} onClick={()=>void decide(r,false)} className="rounded-xl border border-line px-3 py-2 font-bold disabled:opacity-50">Decline</button></div></div>) : <div className="rounded-xl bg-cream p-4 text-xs text-body">No requests waiting for approval.</div>}</Section>{actionError && <div className="rounded-xl border border-line p-3 text-xs text-body">{actionError}</div>}</>}
    {error && <div className="mt-4 rounded-xl border border-line p-3 text-xs text-body">{error}</div>}
    {loading && <div className="mt-4 text-center text-xs text-body">Updating family data…</div>}
  </div>
}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded-2xl bg-tint p-3 text-center"><div className="text-lg font-bold">{value}</div><div className="text-[10px] text-body">{label}</div></div>}
function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="mt-6"><h2 className="mb-3 text-sm font-bold">{title}</h2>{children}</section>}
function Quick({label,detail,onClick}:{label:string;detail:string;onClick:()=>void}){return <button onClick={onClick} className="rounded-2xl bg-cream p-4 text-left"><div className="text-sm font-bold">{label}</div><div className="mt-1 text-[11px] text-body">{detail}</div></button>}
