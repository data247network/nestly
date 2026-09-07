import { useCallback, useEffect, useState } from 'react'
import { useDevice } from '../platform/device'
import { useStore } from '../app/store'
import {
  completeChore,
  loadChildChores,
  loadChildRewardsV2,
  submitChildRequest,
  type ChildChore,
  type ChildReward,
} from '../agent/cloudV2Child'
import type { RequestKind } from '../domain/v2'
import { FamilyHub } from './hub'

function Shell({ title, subtitle, children }: { title:string; subtitle:string; children:React.ReactNode }) { const {go}=useStore(); return <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7"><button onClick={()=>go('childHome')} className="mb-5 w-fit text-xs font-bold text-brand">← Back</button><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-xs text-body">{subtitle}</p><div className="mt-6 space-y-3">{children}</div></div> }

/**
 * The child's route to Notes.
 *
 * `FamilyHub` already handles both roles correctly and is what the parent's
 * `hub` screen renders directly — but it expects the surrounding chrome
 * (`NavigationHeader`) to provide a way back, which only exists on the parent
 * branch of `App.tsx`. Every other child screen supplies its own back button
 * via `Shell`; `FamilyHub`'s own full-height chat layout does not fit inside
 * `Shell`'s padded, scrolling container, so this wraps it with the same
 * back-button convention instead of nesting one inside the other.
 */
export function ChildHubV2() {
  const { go } = useStore()
  return (
    <div className="flex h-full flex-col">
      <button onClick={() => go('childHome')} className="w-fit px-[22px] pt-6 text-xs font-bold text-brand">← Back</button>
      <div className="min-h-0 flex-1"><FamilyHub /></div>
    </div>
  )
}
export function ChildRoutinesV2(){const{agent}=useDevice();return <Shell title="My routines" subtitle="See what is happening on your device."><div className="rounded-2xl bg-tint p-4"><b className="text-sm">{agent?.activeScenario?.name??'No routine active'}</b><p className="mt-1 text-xs text-body">{agent?.activeScenario?`Ends in ${agent.unlocksInMin??0} minutes.`:'Your normal device access is available.'}</p></div><div className="rounded-2xl bg-cream p-4 text-xs text-body">When a routine is active, emergency communication should remain available.</div></Shell>}

export function ChildRequestsV2(){const[kind,setKind]=useState<RequestKind>('extra_screen_time');const[minutes,setMinutes]=useState('30');const[busy,setBusy]=useState(false);const[message,setMessage]=useState<string|null>(null);const submit=async()=>{setBusy(true);setMessage(null);try{const payload=kind==='extra_screen_time'?{minutes:Math.max(1,Math.min(240,Number(minutes)||30))}:{};const res=await submitChildRequest(kind,payload);setMessage(res.message)}finally{setBusy(false)}};return <Shell title="My requests" subtitle="Ask your parent for help or more access."><div className="rounded-2xl bg-cream p-4"><label className="text-[11px] font-bold text-body">WHAT DO YOU NEED?</label><select value={kind} onChange={e=>setKind(e.target.value as RequestKind)} className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-3 text-sm"><option value="extra_screen_time">More screen time</option><option value="app_access">Use an app</option><option value="temporary_unlock">Temporary unlock</option><option value="routine_exception">Routine exception</option></select>{kind==='extra_screen_time'&&<><label className="mt-4 block text-[11px] font-bold text-body">MINUTES</label><input value={minutes} onChange={e=>setMinutes(e.target.value)} inputMode="numeric" className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-3 text-sm" /></>}<button disabled={busy} onClick={()=>void submit()} className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy?'Sending…':'Send request'}</button></div>{message&&<div className="rounded-xl bg-tint p-3 text-xs text-tealInk">{message}</div>}<div className="rounded-2xl bg-cream p-4 text-xs text-body">Your parent can approve or decline requests from their Nestly Control Centre.</div></Shell>}

export function ChildRewardsV2(){const[rewards,setRewards]=useState<ChildReward[]>([]);const[loading,setLoading]=useState(true);const[error,setError]=useState<string|null>(null);const refresh=useCallback(async()=>{setLoading(true);try{setRewards(await loadChildRewardsV2());setError(null)}catch{setError('Could not load rewards.')}finally{setLoading(false)}},[]);useEffect(()=>{void refresh()},[refresh]);const minutes=rewards.reduce((sum,r)=>sum+Math.max(0,Number(r.payload.screenTimeMinutes??0)),0);return <Shell title="My rewards" subtitle="Keep track of the good things you earn."><div className="rounded-2xl bg-tint p-5"><div className="text-xs text-body">APPROVED EXTRA TIME</div><div className="mt-2 text-2xl font-bold">{minutes} minutes</div><p className="mt-2 text-xs text-body">Rewards approved by your family appear here.</p></div><button onClick={()=>void refresh()} className="w-full rounded-xl border border-line px-4 py-3 text-sm font-bold">Refresh rewards</button>{loading&&<div className="text-center text-xs text-body">Updating rewards…</div>}{error&&<div className="rounded-xl border border-line p-3 text-xs text-body">{error}</div>}{!loading&&!error&&rewards.length===0&&<div className="rounded-2xl bg-cream p-4 text-xs text-body">No approved rewards yet.</div>}{rewards.map(r=>{const screenTime=Number(r.payload.screenTimeMinutes??0);const points=Number(r.payload.points??0);const message=typeof r.payload.message==='string'?r.payload.message:null;return <div key={r.id} className="rounded-2xl bg-cream p-4"><div className="text-sm font-bold">{screenTime>0?`${screenTime} extra minutes`:points>0?`${points} reward points`:'Family reward'}</div><div className="mt-1 text-xs text-body">{message??'Approved by your parent.'}</div></div>})}</Shell>}

/**
 * A chore a child can mark done, and a running note while they do.
 *
 * The note field only appears once a chore is picked, rather than sitting
 * open under every row — most chores need no explanation, and a text box
 * under each one reads as "you must justify this" for the ones that don't.
 */
export function ChildChoresV2(){
  const [chores,setChores]=useState<ChildChore[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  const [active,setActive]=useState<string|null>(null)
  const [note,setNote]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState<string|null>(null)

  const refresh=useCallback(async()=>{
    setLoading(true)
    try{ setChores(await loadChildChores()); setError(null) }
    catch{ setError('Could not load chores.') }
    finally{ setLoading(false) }
  },[])
  useEffect(()=>{ void refresh() },[refresh])

  const submit=async(choreId:string)=>{
    setBusy(true); setMessage(null)
    try{
      const res=await completeChore(choreId, note)
      setMessage(res.message)
      if(res.ok){ setActive(null); setNote(''); await refresh() }
    } finally { setBusy(false) }
  }

  const open=chores.filter(c=>c.status==='open')
  const waiting=chores.filter(c=>c.status==='submitted'&&c.mine)

  return <Shell title="My chores" subtitle="Finish a chore to earn extra time.">
    {loading?<div className="rounded-2xl bg-cream p-4 text-xs text-body">Loading…</div>:null}
    {error?<div className="rounded-xl border border-line p-3 text-xs text-body">{error}</div>:null}
    {message?<div className="rounded-xl bg-tint p-3 text-xs text-tealInk">{message}</div>:null}

    {waiting.length>0?<div>
      <div className="mb-2 text-[11px] font-bold tracking-wide text-body">WAITING FOR REVIEW</div>
      {waiting.map(c=><div key={c.id} className="mb-2 rounded-2xl bg-cream p-4">
        <b className="text-sm">{c.title}</b>
        <div className="mt-1 text-xs text-body">Sent to your parent, not yet reviewed.</div>
      </div>)}
    </div>:null}

    {!loading&&open.length===0&&waiting.length===0?
      <div className="rounded-2xl bg-cream p-4 text-xs text-body">No chores waiting right now.</div>
    :null}

    {open.map(c=>{
      const minutes=Number(c.reward.screenTimeMinutes??0)
      const points=Number(c.reward.points??0)
      const isActive=active===c.id
      return <div key={c.id} className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <b className="text-sm">{c.title}</b>
            {c.description?<p className="mt-1 text-xs text-body">{c.description}</p>:null}
          </div>
          <span className="shrink-0 rounded-full bg-tint px-2.5 py-1 text-[10px] font-bold text-tealInk">
            {minutes>0?`+${minutes}m`:points>0?`+${points}pts`:'Reward'}
          </span>
        </div>
        {isActive?<>
          <input
            value={note}
            onChange={e=>setNote(e.target.value)}
            placeholder="Anything your parent should know? (optional)"
            className="mt-3 w-full rounded-xl border border-line px-3 py-2.5 text-xs"
          />
          <div className="mt-2 flex gap-2">
            <button disabled={busy} onClick={()=>void submit(c.id)} className="flex-1 rounded-xl bg-brand px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busy?'Sending…':'Mark done'}</button>
            <button disabled={busy} onClick={()=>{setActive(null);setNote('')}} className="rounded-xl border border-line px-3 py-2.5 text-xs font-bold">Cancel</button>
          </div>
        </>:
          <button onClick={()=>{setActive(c.id);setMessage(null)}} className="mt-3 w-full rounded-xl border border-line px-3 py-2.5 text-xs font-bold text-brand">I've done this</button>
        }
      </div>
    })}
  </Shell>
}
