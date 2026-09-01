import { useDevice } from '../platform/device'
import { useStore } from '../app/store'

export function ChildV2Home() {
  const { agent, name } = useDevice()
  const { go } = useStore()
  const locked = Boolean(agent?.locked)
  return <div className="flex h-full flex-col overflow-y-auto bg-parchment px-[22px] pb-8 pt-7">
    <div className="flex items-start justify-between"><div><div className="text-xs font-bold tracking-[0.14em] text-body">MY NESTLY</div><h1 className="mt-1 text-2xl font-bold">Hi, {name}</h1><p className="mt-1 text-xs text-body">Your routines, requests and rewards in one place.</p></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${locked?'bg-cream text-body':'bg-tint text-tealInk'}`}>{locked?'ROUTINE ACTIVE':'READY'}</span></div>
    <div className="mt-5 rounded-3xl bg-white p-5 shadow-sm"><div className="text-[10px] font-bold tracking-wide text-body">RIGHT NOW</div><div className="mt-2 text-lg font-bold">{agent?.activeScenario?.name ?? (locked ? 'A family routine is active' : 'Your device is available')}</div><p className="mt-1 text-xs leading-relaxed text-body">{agent?.activeScenario ? `This routine has ${agent.unlocksInMin ?? 0} minutes remaining.` : 'Your parent can set routines and limits to help with school, sleep and family time.'}</p></div>
    <div className="mt-5 grid gap-3"><ChildAction title="My routines" detail="See the routines affecting your device." onClick={()=>go('childRoutines')} /><ChildAction title="My requests" detail="Ask for time, access or a temporary exception." onClick={()=>go('childRequests')} /><ChildAction title="My rewards" detail="See approved rewards and extra time." onClick={()=>go('childRewards')} /></div>
    <div className="mt-5 rounded-2xl bg-tint p-4 text-xs text-tealInk"><b>Stay connected</b><p className="mt-1 leading-relaxed">Family routines should not remove access to emergency communication with your approved contacts.</p></div>
    <div className="mt-3 grid grid-cols-2 gap-3"><Mini label="Battery" value={agent?.battery != null ? `${agent.battery}%` : '—'} /><Mini label="Location" value={agent?.lastFix ? 'Shared' : 'Waiting'} /></div>
    <button onClick={()=>go('childNotice')} className="mt-5 text-left text-xs font-bold text-brand">What Nestly shares with my family →</button>
  </div>
}
function ChildAction({title,detail,onClick}:{title:string;detail:string;onClick:()=>void}){return <button onClick={onClick} className="flex items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm"><div><div className="text-sm font-bold">{title}</div><div className="mt-1 text-[11px] text-body">{detail}</div></div><span className="text-brand">→</span></button>}
function Mini({label,value}:{label:string;value:string}){return <div className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[10px] font-bold tracking-wide text-body">{label.toUpperCase()}</div><div className="mt-1 text-sm font-bold">{value}</div></div>}
