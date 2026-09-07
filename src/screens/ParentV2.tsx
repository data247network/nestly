import { useEffect, useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
import { loadRequestHistory, resolveChildRequest, useV2Dashboard } from '../cloud/v2'
import type { ChildRequest, DeviceRecord } from '../domain/v2'

/** Waits a frame so a tab switch renders before scrolling to something inside it. */
function scrollToSection(id: string) {
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

export function ParentV2() {
  const { go, dispatch } = useStore()
  const { household, loading: householdLoading, refresh: refreshHousehold } = useCloudChildren()
  const { data, loading, error, refresh } = useV2Dashboard(household?.id)
  const [tab, setTab] = useState<'overview'|'safety'|'family'|'delivery'>('overview')
  const [resolving, setResolving] = useState<string|null>(null)
  const [actionError, setActionError] = useState<string|null>(null)
  const [requestHistory, setRequestHistory] = useState<ChildRequest[]>([])
  const [requestHistoryClearedAt, setRequestHistoryClearedAt] = useState(0)
  const [deliveryClearedAt, setDeliveryClearedAt] = useState(0)
  const active = data.devices.filter(d => d.enrollmentState === 'active').length
  const choose = (id:string) => { dispatch({type:'activeChild', id}); go('screentime') }
  const refreshAll = async () => { await Promise.all([refreshHousehold(), refresh(), refreshRequestHistory()]) }

  const refreshRequestHistory = async () => {
    if (!household) return
    try { setRequestHistory(await loadRequestHistory(household.id)) } catch { /* shown via actionError elsewhere if needed */ }
  }

  useEffect(() => {
    void loadJSON<number>(KEYS.requestHistoryClearedAt, 0).then(setRequestHistoryClearedAt)
    void loadJSON<number>(KEYS.deliveryStatusClearedAt, 0).then(setDeliveryClearedAt)
  }, [])

  useEffect(() => {
    void refreshRequestHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household?.id])

  const clearRequestHistory = () => {
    const now = Date.now()
    setRequestHistoryClearedAt(now)
    void saveJSON(KEYS.requestHistoryClearedAt, now)
  }
  const clearDeliveryStatus = () => {
    const now = Date.now()
    setDeliveryClearedAt(now)
    void saveJSON(KEYS.deliveryStatusClearedAt, now)
  }

  const decide = async (r:ChildRequest, approved:boolean) => {
    setResolving(r.id)
    setActionError(null)
    try { await resolveChildRequest(r, approved); await refresh(); await refreshRequestHistory() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update the child request.') }
    finally { setResolving(null) }
  }

  // Do not render a partially initialised dashboard. Previously the v2 device
  // query could finish before the household query, producing the contradictory
  // state "3 protected / 0 children / 0 devices" visible in live testing.
  if (householdLoading && !household) {
    return <div className="flex h-full items-center justify-center px-[22px] text-center"><div><div className="text-sm font-bold">Loading your family…</div><div className="mt-1 text-xs text-body">Getting the latest children and device status.</div></div></div>
  }

  if (!household) {
    return <div className="flex h-full items-center justify-center px-[22px] text-center"><div><div className="text-sm font-bold">We could not load your family</div><div className="mt-1 text-xs text-body">Check your connection, then try again.</div><button onClick={() => void refreshAll()} className="mt-4 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-white">Try again</button></div></div>
  }

  const visibleRequestHistory = requestHistory.filter(r => new Date(r.requestedAt).getTime() > requestHistoryClearedAt)
  const visibleDeliveries = data.deliveries.filter(d => !d.createdAt || new Date(d.createdAt).getTime() > deliveryClearedAt)

  const goChildren = () => { setTab('overview'); scrollToSection('section-children') }
  const goRequests = () => { setTab('family'); scrollToSection('section-requests') }

  return <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7"><div className="flex items-start justify-between"><div><div className="text-xs text-body">NESTLY FAMILY</div><h1 className="mt-1 text-2xl font-bold">Control centre</h1><p className="mt-1 text-xs text-body">One clear view of your family's safety.</p></div><button onClick={() => void refreshAll()} className="rounded-xl border border-line px-3 py-2 text-xs font-bold">Refresh</button></div><div className="mt-5 grid grid-cols-3 gap-2"><Metric label="Children" value={String(household.children.length)} onClick={goChildren}/><Metric label="Protected" value={String(active)} onClick={goChildren}/><Metric label="Requests" value={String(data.requests.length)} onClick={goRequests}/></div><div className="mt-5 grid grid-cols-4 gap-2">{(['overview','safety','family','delivery'] as const).map(item=><button key={item} onClick={()=>setTab(item)} className={`rounded-xl px-2 py-2 text-[10px] font-bold ${tab===item?'bg-brand text-white':'bg-cream text-body'}`}>{item==='delivery'?'Status':item[0].toUpperCase()+item.slice(1)}</button>)}</div>
  {tab==='overview'&&<><Section id="section-children" title="Your children">{household.children.map(child=>{const device=data.devices.find(d=>d.childId===child.id);return <button key={child.id} onClick={()=>choose(child.id)} className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-cream p-4 text-left"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand font-bold text-white">{child.name.slice(0,1)}</div><div className="flex-1"><b className="text-sm">{child.name}</b><div className="mt-1 text-[11px] text-body">{device?.displayName??'No device connected'}</div><div className="mt-1 text-[10px] text-muted">{device?deviceStatus(device):'Set up a child device to see status'}</div></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-body">{device?.enrollmentState??'pending'}</span></button>})}</Section><Section title="Quick controls"><div className="grid grid-cols-2 gap-2"><Quick label="School mode" detail={`${data.routines.length} routines available`} onClick={()=>go('schoolModeV2')}/><Quick label="Tasks & Rewards" detail="Trade tasks for screen time" onClick={()=>go('choresV2')}/><Quick label="Devices" detail={`${data.devices.length} registered`} onClick={()=>go('pair')}/><Quick label="Safe zones" detail={`${data.safeZones.length} zones`} onClick={()=>go('map')}/><Quick label="Family hub" detail="Messages & support" onClick={()=>go('hub')}/></div></Section></>}
  {tab==='safety'&&<><Section title="Safety controls"><div className="grid grid-cols-1 gap-2"><Quick label="Screen time" detail="Limits and routines" onClick={()=>go('screentime')}/><Quick label="School mode" detail="Emergency contacts stay available" onClick={()=>go('schoolModeV2')}/><Quick label="Emergency contacts" detail="Mum, Dad and trusted adults" onClick={()=>go('contacts')}/><Quick label="Web & app activity" detail="Filtering and reports" onClick={()=>go('activity')}/></div></Section><div className="rounded-2xl bg-tint p-4 text-xs text-tealInk"><b>Safety principle</b><p className="mt-1 leading-relaxed">Emergency communication should remain available even when routines or restrictions are active.</p></div></>}
  {tab==='family'&&<><Section title="Family routines"><div className="rounded-2xl bg-cream p-4 text-sm"><b>{data.routines.length} active routines</b><p className="mt-1 text-xs text-body">Manage school, bedtime and family routines.</p><button onClick={()=>go('schoolModeV2')} className="mt-3 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white">Open School Mode</button></div></Section><Section id="section-requests" title="Child requests">{data.requests.length?data.requests.map(r=><div key={r.id} className="mb-2 rounded-2xl border border-line p-4 text-xs"><b className="capitalize">{r.kind.replace(/_/g,' ')}</b><div className="mt-1 text-body">{requestDetail(r)}</div><div className="mt-3 flex gap-2"><button disabled={resolving===r.id} onClick={()=>void decide(r,true)} className="rounded-xl bg-brand px-3 py-2 font-bold text-white disabled:opacity-50">{resolving===r.id?'Updating…':'Approve'}</button><button disabled={resolving===r.id} onClick={()=>void decide(r,false)} className="rounded-xl border border-line px-3 py-2 font-bold disabled:opacity-50">Decline</button></div></div>):<div className="rounded-xl bg-cream p-4 text-xs text-body">No requests waiting for approval.</div>}</Section>{actionError&&<div className="rounded-xl border border-line p-3 text-xs text-body">{actionError}</div>}
  <Section title="Request history">
    {visibleRequestHistory.length>0?<div className="mb-2 flex justify-end"><button onClick={clearRequestHistory} className="text-[11px] font-bold text-brand">Clear history</button></div>:null}
    {visibleRequestHistory.length?visibleRequestHistory.map(r=><div key={r.id} className="mb-2 rounded-2xl bg-cream p-4 text-xs"><div className="flex items-center justify-between gap-2"><b className="capitalize">{r.kind.replace(/_/g,' ')}</b><RequestStatusPill status={r.status}/></div><div className="mt-1 text-body">{requestDetail(r)}</div></div>):<div className="rounded-2xl bg-cream p-4 text-xs text-body">No resolved requests yet.</div>}
  </Section>
  </>}
  {tab==='delivery'&&<Section title="Policy delivery status">
    <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs text-body">Track what happened after a command was sent to a child device.</p>{visibleDeliveries.length>0?<button onClick={clearDeliveryStatus} className="shrink-0 text-[11px] font-bold text-brand">Clear</button>:null}</div>
    {visibleDeliveries.length?visibleDeliveries.map(d=><div key={d.id} className="mb-2 rounded-2xl border border-line p-3"><div className="flex items-center justify-between gap-2"><b className="text-xs capitalize">{d.command}</b><DeliveryBadge status={d.status}/></div><DeliveryProgress status={d.status}/><div className="mt-2 text-[10px] text-body">{deliveryText(d)}</div></div>):<div className="rounded-2xl bg-cream p-4 text-xs text-body">No recent device commands yet.</div>}
  </Section>}{error&&<div className="mt-4 rounded-xl border border-line p-3 text-xs text-body">{error}</div>}{loading&&<div className="mt-4 text-center text-xs text-body">Updating family data…</div>}</div>
}
/**
 * What the child actually asked for, so a parent isn't approving a bare
 * label. `extra_screen_time` carries the number of minutes; the other
 * kinds don't yet ask the child for a reason, so this says so plainly
 * rather than showing nothing and looking like a rendering bug.
 */
function requestDetail(r: ChildRequest): string {
  if (r.kind === 'extra_screen_time') {
    const minutes = Number(r.payload.minutes ?? r.payload.screenTimeMinutes ?? 0)
    return minutes > 0 ? `${minutes} extra minutes requested` : 'Awaiting your decision'
  }
  const reason = typeof r.payload.reason === 'string' ? r.payload.reason : null
  const app = typeof r.payload.app === 'string' ? r.payload.app : null
  if (app) return `App requested: ${app}`
  if (reason) return reason
  return 'Awaiting your decision — no extra details provided.'
}
function RequestStatusPill({status}:{status:string}){const tone=status==='approved'?'bg-tint text-tealInk':status==='declined'?'bg-coralBg text-coralInk':'bg-white text-body';return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${tone}`}>{status}</span>}
function deliveryText(d:{status:string;executedAt:string|null;result?:Record<string,unknown>}){if(d.status==='queued')return 'Queued and waiting for the child device.';if(d.status==='delivered')return 'Received by the child device and awaiting enforcement.';if(d.status==='applied')return 'Applied on the child device and waiting for acknowledgement.';if(d.status==='acknowledged')return d.executedAt?'Completed and acknowledged at '+new Date(d.executedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.':'Completed and acknowledged.';if(d.status==='failed')return String(d.result?.error??'The command failed. Check the device connection and try again.');return 'Policy status updated.'}
function DeliveryProgress({status}:{status:string}){const steps=['queued','delivered','applied','acknowledged'];const current=status==='failed'?-1:Math.max(0,steps.indexOf(status));return <div className="mt-3 grid grid-cols-4 gap-1">{steps.map((step,index)=><div key={step}><div className={`h-1.5 rounded ${index<=current?'bg-brand':'bg-line'}`}/><div className="mt-1 text-[8px] capitalize text-body">{step}</div></div>)}</div>}
function DeliveryBadge({status}:{status:string}){return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status==='acknowledged'?'bg-tint text-tealInk':status==='failed'?'bg-coralBg text-coralInk':status==='delivered'||status==='applied'?'bg-amberBg text-[#8A5A16]':'bg-cream text-body'}`}>{status}</span>}
function deviceStatus(device:DeviceRecord){if(device.enrollmentState!=='active')return `Device ${device.enrollmentState}`;if(!device.lastSeenAt)return 'Active · waiting for first check-in';const minutes=Math.max(0,Math.floor((Date.now()-new Date(device.lastSeenAt).getTime())/60000));return minutes<2?'Active · just seen':minutes<60?`Active · seen ${minutes}m ago`:`Active · seen ${Math.floor(minutes/60)}h ago`}
function Metric({label,value,onClick}:{label:string;value:string;onClick?:()=>void}){return <button type="button" onClick={onClick} className="rounded-2xl bg-tint p-3 text-center"><div className="text-lg font-bold">{value}</div><div className="text-[10px] text-body">{label}</div></button>};function Section({id,title,children}:{id?:string;title:string;children:React.ReactNode}){return <section id={id} className="mt-6 scroll-mt-4"><h2 className="mb-3 text-sm font-bold">{title}</h2>{children}</section>};function Quick({label,detail,onClick}:{label:string;detail:string;onClick:()=>void}){return <button onClick={onClick} className="rounded-2xl bg-cream p-4 text-left"><div className="text-sm font-bold">{label}</div><div className="mt-1 text-[11px] text-body">{detail}</div></button>}
