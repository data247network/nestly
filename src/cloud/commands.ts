import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { hasCloud, supabase } from './client'
import { KEYS, loadJSON } from '../platform/storage'
import { NestlyLink } from '../link/ble-peripheral'

const CHILD_SYNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/child-sync`
const COMMAND_SYNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/child-command-sync`

type Enrolment = { childId?: string; deviceSecret?: string }
type Command = { id: string; command: 'lock' | 'unlock' | 'locate' | 'refresh'; payload?: Record<string, unknown> }

export async function sendParentCommand(
  childId: string,
  command: Command['command'],
  payload: Record<string, unknown> = {},
): Promise<string> {
  if (!hasCloud()) throw new Error('Cloud is not configured.')
  const { data, error } = await supabase().functions.invoke('parent-command', {
    body: { childId, command, payload },
  })
  if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? 'Command could not be queued.')
  return String(data.command.id)
}

async function childSync(body: Record<string, unknown>) {
  const res = await fetch(CHILD_SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data
}

async function claimCommands(enrolment: Enrolment, ack: unknown[] = []) {
  const res = await fetch(COMMAND_SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId: enrolment.childId, deviceSecret: enrolment.deviceSecret, ack }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return (data.commands ?? []) as Command[]
}

async function execute(command: Command, enrolment: Enrolment) {
  if (command.command === 'lock' || command.command === 'unlock') {
    if (!Capacitor.isNativePlatform()) return { ok: false, error: 'native_only' }
    await NestlyLink.setLocked({
      locked: command.command === 'lock',
      title: command.command === 'lock' ? 'Phone locked' : '',
      subtitle: command.command === 'lock' ? 'Locked by your parent.' : '',
      contacts: [],
    })
    return { ok: true, locked: command.command === 'lock' }
  }

  if (command.command === 'locate') {
    const permission = await Geolocation.checkPermissions().catch(() => null)
    if (permission && permission.location !== 'granted') await Geolocation.requestPermissions()
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 })
    await childSync({
      childId: enrolment.childId,
      deviceSecret: enrolment.deviceSecret,
      locateFix: { lat: position.coords.latitude, lng: position.coords.longitude, acc: position.coords.accuracy, ts: position.timestamp },
      telemetry: {
        ts: position.timestamp,
        fix: { lat: position.coords.latitude, lng: position.coords.longitude, acc: position.coords.accuracy },
      },
    })
    return { ok: true, lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }
  }

  return { ok: true }
}

export async function pollChildCommands(): Promise<void> {
  if (!hasCloud()) return
  const enrolment = await loadJSON<Enrolment | null>(KEYS.enrolment, null)
  if (!enrolment?.childId || !enrolment.deviceSecret) return
  const commands = await claimCommands(enrolment)
  const ack: { id: string; status: 'completed' | 'failed'; result?: Record<string, unknown> }[] = []
  for (const command of commands) {
    try {
      const result = await execute(command, enrolment)
      ack.push({ id: command.id, status: result.ok ? 'completed' : 'failed', result })
    } catch (error) {
      ack.push({ id: command.id, status: 'failed', result: { error: error instanceof Error ? error.message : 'command_failed' } })
    }
  }
  if (ack.length) await claimCommands(enrolment, ack)
}
