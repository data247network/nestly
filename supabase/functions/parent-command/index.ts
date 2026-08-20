import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

type Body = {
  childId?: string
  command?: "lock" | "unlock" | "locate" | "refresh"
  payload?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)

  const auth = req.headers.get("Authorization")
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Not authorised." }, 401)

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  )
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return json({ ok: false, error: "Not authorised." }, 401)

  let body: Body
  try { body = await req.json() as Body } catch { return json({ ok: false, error: "Expected JSON." }, 400) }
  if (!body.childId || !body.command) return json({ ok: false, error: "childId and command are required." }, 400)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { data: child } = await admin
    .from("children")
    .select("id, household_id")
    .eq("id", body.childId)
    .maybeSingle()
  if (!child) return json({ ok: false, error: "Child not found." }, 404)

  const { data: membership } = await admin
    .from("household_members")
    .select("household_id")
    .eq("household_id", child.household_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return json({ ok: false, error: "Not authorised for this child." }, 403)

  const { data: command, error } = await admin
    .from("device_commands")
    .insert({
      child_id: body.childId,
      command: body.command,
      payload: body.payload ?? {},
      requested_by: user.id,
      status: "pending",
    })
    .select("id, child_id, command, status, created_at")
    .single()

  if (error) {
    console.error("parent-command: insert failed", error)
    return json({ ok: false, error: "command_create_failed" }, 500)
  }

  return json({ ok: true, command })
})
