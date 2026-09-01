import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } })
function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0 }
type AckStatus = "applied" | "completed" | "failed"
type Body = { childId?: string; deviceSecret?: string; ack?: { id: string; status: AckStatus; result?: Record<string, unknown> }[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  let body: Body; try { body = await req.json() as Body } catch { return json({ ok: false, error: "Expected JSON." }, 400) }
  const childId = String(body.childId ?? ""), secret = String(body.deviceSecret ?? "")
  if (!childId || !secret) return json({ ok: false, error: "Not authorised." }, 401)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data: child } = await admin.from("children").select("id, device_secret").eq("id", childId).maybeSingle()
  if (!child?.device_secret || !safeEqual(String(child.device_secret), secret)) return json({ ok: false, error: "Not authorised." }, 401)
  const now = new Date().toISOString()
  if (Array.isArray(body.ack)) for (const item of body.ack.slice(0, 50)) {
    if (!item?.id || !["applied", "completed", "failed"].includes(item.status)) continue
    const patch = item.status === "applied"
      ? { status: "applied", applied_at: now, result: item.result ?? {} }
      : { status: item.status, executed_at: now, result: item.result ?? {} }
    const allowed = item.status === "applied" ? ["claimed"] : item.status === "completed" ? ["applied", "claimed"] : ["claimed", "applied", "pending"]
    await admin.from("device_commands").update(patch).eq("id", String(item.id)).eq("child_id", childId).in("status", allowed)
  }
  await admin.from("device_commands").update({ status: "expired" }).eq("child_id", childId).eq("status", "claimed").lt("claimed_at", new Date(Date.now() - 2 * 60_000).toISOString())
  const { data: pending, error } = await admin.from("device_commands").select("id, command, payload, created_at").eq("child_id", childId).eq("status", "pending").order("created_at", { ascending: true }).limit(10)
  if (error) return json({ ok: false, error: "command_read_failed" }, 500)
  const commands = []
  for (const item of pending ?? []) { const { data: claimed } = await admin.from("device_commands").update({ status: "claimed", claimed_at: now }).eq("id", item.id).eq("status", "pending").select("id, command, payload, created_at").maybeSingle(); if (claimed) commands.push(claimed) }
  return json({ ok: true, commands })
})
