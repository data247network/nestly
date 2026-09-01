import { Capacitor, registerPlugin } from '@capacitor/core'
import { ENROLMENT_KEY, type Enrolment } from './sync'
import { loadJSON } from '../platform/storage'

type Command = { id:string; command:'lock'|'unlock'|'locate'|'refresh'; payload?:Record<string,unknown> }
type Ack = { id:string; status:'completed'|'failed'; result?:Record<string,unknown> }
type SafetyLockPlugin = { lock:()=>Promise<{locked?:boolean}>; unlock:()=>Promise<{unlocked?:boolean}> }
const SafetyLock = registerPlugin<SafetyLockPlugin>('NestlySafetyLock')

/** Poll and acknowledge cloud policy commands for an enrolled child device.
 * Commands are fetched through the device-secret authenticated edge function;
 * the child never needs a parent Supabase session or direct table access.
 */
export async function syncChildCommands():Promise<number>{
  if(!Capacitor.isNativePlatform()) return 0
  const enrolment=await loadJSON<Enrolment|null>(ENROLMENT_KEY,null)
  const url=import.meta.env.VITE_SUPABASE_URL as string|undefined
  if(!enrolment||!url) return 0
  const response=await fetch(`${url}/functions/v1/child-command-sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({childId:enrolment.childId,deviceSecret:enrolment.deviceSecret})})
  const body=await response.json().catch(()=>({})) as {ok?:boolean;commands?:Command[]}
  if(!response.ok||!body.ok) throw new Error('Could not synchronise device commands.')
  const commands=Array.isArray(body.commands)?body.commands:[]
  const ack:Ack[]=[]
  for(const item of commands){
    try{
      let result:Record<string,unknown>={}
      if(item.command==='lock') result={...(await SafetyLock.lock()),command:'lock'}
      else if(item.command==='unlock') result={...(await SafetyLock.unlock()),command:'unlock'}
      else if(item.command==='locate'||item.command==='refresh') result={command:item.command,accepted:true}
      else throw new Error('Unsupported command')
      ack.push({id:item.id,status:'completed',result})
    }catch(error){ack.push({id:item.id,status:'failed',result:{message:error instanceof Error?error.message:'Command failed'}})}
  }
  if(ack.length){
    await fetch(`${url}/functions/v1/child-command-sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({childId:enrolment.childId,deviceSecret:enrolment.deviceSecret,ack})})
  }
  return commands.length
}
