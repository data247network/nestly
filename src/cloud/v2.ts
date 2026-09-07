import { useCallback, useEffect, useState } from 'react'
import { hasCloud, supabase } from './client'
import { ENROLMENT_KEY, type Enrolment } from './sync'
import { loadJSON } from '../platform/storage'
import type { ChildRequest, DeviceRecord, RequestKind, Routine, SafeZone } from '../domain/v2'

export type V2Location = { childId:string; latitude:number; longitude:number; accuracyM:number|null; battery:number|null; recordedAt:string }
export type RewardTransaction = { id:string; householdId:string; childId:string; source:string; status:string; payload:Record<string,unknown>; createdAt:string|null }
export type PolicyDeliveryStatus = 'queued'|'delivered'|'applied'|'acknowledged'|'failed'
export type PolicyDelivery = { id:string; childId:string; command:string; status:PolicyDeliveryStatus; createdAt:string|null; claimedAt:string|null; executedAt:string|null; result:Record<string,unknown> }
export type V2Dashboard = { devices:DeviceRecord[]; requests:ChildRequest[]; routines:Routine[]; safeZones:SafeZone[]; locations:V2Location[]; deliveries:PolicyDelivery[] }
const empty: V2Dashboard = { devices:[], requests:[], routines:[], safeZones:[], locations:[], deliveries:[] }
function mapDevice(row: Record<string, unknown>): DeviceRecord { return { id:String(row.id), householdId:String(row.household_id), childId:row.child_id as string|null, installId:String(row.install_id), platform:String(row.platform), displayName:row.display_name as string|null, enrollmentState:row.enrollment_state as DeviceRecord['enrollmentState'], managementMode:row.management_mode as DeviceRecord['managementMode'], lastSeenAt:row.last_seen_at as string|null } }
function mapRequest(row: Record<string, unknown>): ChildRequest { return { id:String(row.id), householdId:String(row.household_id), childId:String(row.child_id), deviceId:row.device_id as string|null, kind:row.kind as ChildRequest['kind'], payload:(row.payload??{}) as Record<string,unknown>, status:row.status as ChildRequest['status'], requestedAt:String(row.requested_at) } }
function mapReward(row: Record<string, unknown>): RewardTransaction { return { id:String(row.id), householdId:String(row.household_id), childId:String(row.child_id), source:String(row.source??'family'), status:String(row.status??'approved'), payload:(row.payload??{}) as Record<string,unknown>, createdAt:row.created_at==null?null:String(row.created_at) } }
function mapDelivery(row:Record<string,unknown>):PolicyDelivery{const raw=String(row.status??'pending');const result=(row.result??{}) as Record<string,unknown>;const status:PolicyDeliveryStatus=raw==='failed'?'failed':raw==='pending'?'queued':raw==='claimed'?'delivered':raw==='applied'?'applied':raw==='completed'?(result.acknowledged===false?'applied':'acknowledged'):'queued';return{id:String(row.id),childId:String(row.child_id),command:String(row.command),status,createdAt:row.created_at==null?null:String(row.created_at),claimedAt:row.claimed_at==null?null:String(row.claimed_at),executedAt:row.executed_at==null?null:String(row.executed_at),result}}
export async function loadV2Dashboard(householdId:string):Promise<V2Dashboard>{ if(!hasCloud())return empty; const db=supabase(); const [{data:devices},{data:requests},{data:routines},{data:zones},{data:locations},{data:commands}]=await Promise.all([db.from('devices').select('*').eq('household_id',householdId).order('updated_at',{ascending:false}),db.from('child_requests').select('*').eq('household_id',householdId).eq('status','pending').order('requested_at',{ascending:false}).limit(10),db.from('routines').select('*').eq('household_id',householdId).eq('active',true).order('name'),db.from('safe_zones').select('*').eq('household_id',householdId).eq('active',true).order('name'),db.from('device_locations').select('*').order('updated_at',{ascending:false}),db.from('device_commands').select('*').order('created_at',{ascending:false}).limit(20)]); return {devices:(devices??[]).map(r=>mapDevice(r as Record<string,unknown>)),requests:(requests??[]).map(r=>mapRequest(r as Record<string,unknown>)),routines:(routines??[]).map(row=>({id:String(row.id),householdId:String(row.household_id),childId:row.child_id as string|null,name:String(row.name),timezone:String(row.timezone),schedule:(row.schedule??{}) as Record<string,unknown>,policyProfileId:row.policy_profile_id as string|null,action:(row.action??{}) as Record<string,unknown>,active:Boolean(row.active)})),safeZones:(zones??[]).map(row=>({id:String(row.id),householdId:String(row.household_id),name:String(row.name),latitude:Number(row.latitude),longitude:Number(row.longitude),radiusM:Number(row.radius_m),active:Boolean(row.active),childIds:(row.child_ids??[]) as string[]})),locations:(locations??[]).map(row=>({childId:String(row.child_id),latitude:Number(row.latitude),longitude:Number(row.longitude),accuracyM:row.accuracy_m==null?null:Number(row.accuracy_m),battery:row.battery==null?null:Number(row.battery),recordedAt:String(row.recorded_at)})),deliveries:(commands??[]).map(row=>mapDelivery(row as Record<string,unknown>))} }
export function useV2Dashboard(householdId?:string){const [data,setData]=useState<V2Dashboard>(empty);const [loading,setLoading]=useState(Boolean(householdId&&hasCloud()));const [error,setError]=useState<string|null>(null);const refresh=useCallback(async()=>{if(!householdId||!hasCloud()){setData(empty);setLoading(false);return}setLoading(true);try{setData(await loadV2Dashboard(householdId));setError(null)}catch(e){setError(e instanceof Error?e.message:'Could not refresh the family dashboard.')}finally{setLoading(false)}},[householdId]);useEffect(()=>{void refresh()},[refresh]);useEffect(()=>{if(!householdId||!hasCloud())return;let timer:number|undefined;const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void refresh(),300)};const channel=supabase().channel(`nestly-v2-${householdId}`).on('postgres_changes',{event:'*',schema:'public',table:'devices',filter:`household_id=eq.${householdId}`},schedule).on('postgres_changes',{event:'*',schema:'public',table:'child_requests',filter:`household_id=eq.${householdId}`},schedule).on('postgres_changes',{event:'*',schema:'public',table:'routines',filter:`household_id=eq.${householdId}`},schedule).on('postgres_changes',{event:'*',schema:'public',table:'safe_zones',filter:`household_id=eq.${householdId}`},schedule).on('postgres_changes',{event:'*',schema:'public',table:'device_commands'},schedule).subscribe();return()=>{window.clearTimeout(timer);void supabase().removeChannel(channel)}},[householdId,refresh]);return{data,loading,error,refresh}}
export async function loadChildRewards():Promise<RewardTransaction[]>{if(!hasCloud())return[];const enrolment=await loadJSON<Enrolment|null>(ENROLMENT_KEY,null);if(!enrolment)return[];const{data,error}=await supabase().from('reward_transactions').select('*').eq('household_id',enrolment.householdId).eq('child_id',enrolment.childId).eq('status','approved').order('created_at',{ascending:false}).limit(30);if(error)throw error;return(data??[]).map(row=>mapReward(row as Record<string,unknown>))}
export function useChildRewards(){const[rewards,setRewards]=useState<RewardTransaction[]>([]);const[loading,setLoading]=useState(false);const[error,setError]=useState<string|null>(null);const refresh=useCallback(async()=>{setLoading(true);try{setRewards(await loadChildRewards());setError(null)}catch(e){setError(e instanceof Error?e.message:'Could not load rewards.')}finally{setLoading(false)}},[]);useEffect(()=>{void refresh()},[refresh]);return{rewards,loading,error,refresh}}
export async function createChildRequest(input:{kind:RequestKind;payload:Record<string,unknown>;deviceId?:string}):Promise<void>{if(!hasCloud())throw new Error('Cloud service is not configured.');const enrolment=await loadJSON<Enrolment|null>(ENROLMENT_KEY,null);if(!enrolment)throw new Error('This device is not linked to a family yet. Enter the setup code first.');const{error}=await supabase().from('child_requests').insert({household_id:enrolment.householdId,child_id:enrolment.childId,device_id:input.deviceId??null,kind:input.kind,payload:input.payload,status:'pending',requested_at:new Date().toISOString()});if(error)throw error}
export async function resolveChildRequest(request:ChildRequest,approved:boolean):Promise<void>{if(!hasCloud())throw new Error('Cloud service is not configured.');const db=supabase();const{error}=await db.from('child_requests').update({status:approved?'approved':'declined',resolved_at:new Date().toISOString(),resolution:{approved}}).eq('id',request.id).eq('status','pending');if(error)throw error;if(approved&&request.kind==='extra_screen_time'){const minutes=Number(request.payload.minutes??request.payload.screenTimeMinutes??0);if(Number.isFinite(minutes)&&minutes>0){const{error:rewardError}=await db.from('reward_transactions').insert({household_id:request.householdId,child_id:request.childId,source:'request',status:'approved',payload:{screenTimeMinutes:Math.floor(minutes),requestId:request.id}});if(rewardError)throw rewardError}}}

/* ------------------------------------------------------------------ chores */
//
// The parent side of chores is ordinary authenticated access — RLS already
// scopes every one of these tables to `is_household_member`, the same as the
// rest of this file. It is the *child* side that cannot go through Supabase
// directly (see `agent/cloudV2Child.ts`); a parent is signed in, so none of
// that applies here.

export type ChoreReward = { screenTimeMinutes?: number; points?: number }

export type Chore = {
  id: string
  householdId: string
  childId: string | null
  title: string
  description: string | null
  dueAt: string | null
  reward: ChoreReward
  status: 'open' | 'submitted' | 'approved' | 'declined' | 'cancelled' | 'completed'
  createdAt: string
}

export type ChoreSubmission = {
  id: string
  choreId: string
  childId: string
  note: string | null
  submittedAt: string
  chore: { title: string; reward: ChoreReward; householdId: string } | null
}

function mapChore(row: Record<string, unknown>): Chore {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    childId: (row.child_id as string) ?? null,
    title: String(row.title),
    description: (row.description as string) ?? null,
    dueAt: (row.due_at as string) ?? null,
    reward: (row.reward ?? {}) as ChoreReward,
    status: row.status as Chore['status'],
    createdAt: String(row.created_at),
  }
}

export async function loadChores(householdId: string): Promise<Chore[]> {
  if (!hasCloud()) return []
  const { data, error } = await supabase()
    .from('chores')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []).map((r) => mapChore(r as Record<string, unknown>))
}

/**
 * Submissions waiting on a decision, each carrying the chore it answers.
 *
 * Joined rather than fetched separately and matched client-side: the review
 * screen's whole job is "what does this submission refer to", and two
 * round trips that could disagree about which chore still exists is a bug
 * waiting to happen for no benefit here.
 */
export async function loadPendingChoreSubmissions(householdId: string): Promise<ChoreSubmission[]> {
  if (!hasCloud()) return []
  const { data, error } = await supabase()
    .from('chore_submissions')
    .select('id, chore_id, child_id, note, submitted_at, chores!inner(title, reward, household_id)')
    .eq('status', 'pending')
    .eq('chores.household_id', householdId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    const chore = (Array.isArray(r.chores) ? r.chores[0] : r.chores) as
      | { title?: string; reward?: ChoreReward; household_id?: string }
      | null
      | undefined
    return {
      id: String(r.id),
      choreId: String(r.chore_id),
      childId: String(r.child_id),
      note: (r.note as string) ?? null,
      submittedAt: String(r.submitted_at),
      chore: chore
        ? { title: String(chore.title ?? ''), reward: chore.reward ?? {}, householdId: String(chore.household_id) }
        : null,
    }
  })
}

export async function createChore(
  householdId: string,
  input: { title: string; description?: string; dueAt?: string; childId?: string | null; rewardMinutes: number },
): Promise<void> {
  if (!hasCloud()) throw new Error('Cloud service is not configured.')
  const { data: session } = await supabase().auth.getSession()
  const { error } = await supabase().from('chores').insert({
    household_id: householdId,
    child_id: input.childId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    due_at: input.dueAt ?? null,
    reward: { screenTimeMinutes: Math.max(1, Math.floor(input.rewardMinutes)) },
    status: 'open',
    created_by: session.session?.user.id ?? null,
  })
  if (error) throw error
}

export async function cancelChore(choreId: string): Promise<void> {
  if (!hasCloud()) return
  const { error } = await supabase()
    .from('chores')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', choreId)
  if (error) throw error
}

/**
 * Verifies or declines a submitted chore.
 *
 * The update that flips `chore_submissions.status` is the claim — conditioned
 * on it still being `pending`, exactly like `push-notify` claiming events —
 * so a second parent deciding the same submission a moment later, or a
 * double-tap on the button, cannot grant the reward twice. Only the parent
 * who wins that update goes on to touch `chores` or insert the reward.
 */
export async function reviewChoreSubmission(submission: ChoreSubmission, approved: boolean): Promise<void> {
  if (!hasCloud()) throw new Error('Cloud service is not configured.')
  const db = supabase()
  const { data: session } = await db.auth.getSession()
  const userId = session.session?.user.id ?? null

  const { data: claimed, error: claimError } = await db
    .from('chore_submissions')
    .update({
      status: approved ? 'approved' : 'declined',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', submission.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) throw new Error('Someone already reviewed that submission.')

  if (approved) {
    const { error } = await db
      .from('chores')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', submission.choreId)
    if (error) throw error

    const { error: rewardError } = await db.from('reward_transactions').insert({
      household_id: submission.chore?.householdId,
      child_id: submission.childId,
      source: 'chore',
      status: 'approved',
      payload: submission.chore?.reward ?? {},
      approved_by: userId,
    })
    if (rewardError) throw rewardError
  } else {
    // Reopened rather than left `declined` for good — a child should be able
    // to redo it properly. Left assigned to whoever attempted it: an
    // originally open chore that a child claimed and then had declined does
    // not go back into a sibling's pool mid-disagreement, and a chore that
    // was assigned to a specific child at creation was never anyone else's
    // to begin with.
    const { error } = await db
      .from('chores')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', submission.choreId)
    if (error) throw error
  }
}
