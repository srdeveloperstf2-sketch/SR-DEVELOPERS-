import { createClient } from "npm:@supabase/supabase-js@2";

const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://srdeveloperstf2-sketch.github.io,https://localhost,capacitor://localhost,http://localhost")
  .split(",").map(v => v.trim()).filter(Boolean);
function reply(req: Request, body: Record<string, unknown>, status = 200) {
  const origin = req.headers.get("Origin") ?? "";
  return new Response(JSON.stringify(body), { status, headers: {
    "Vary": "Origin",
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "https://srdeveloperstf2-sketch.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store", "Content-Type": "application/json",
  }});
}
function serverKey(): string | null {
  const direct = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); return typeof keys.default === "string" ? keys.default : null; }
  catch { return null; }
}
function makePassword() {
  // Uniformly sample the 6-digit range using rejection sampling.
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  let value: number;
  do { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); value = bytes[0]; } while (value >= limit);
  return String(value % 1000000).padStart(6, "0");
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !origins.includes(origin)) return reply(req, { error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin ?? "", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return reply(req, { error: "POST required" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const secret = serverKey();
    if (!url || !anon || !secret) return reply(req, { error: "Server configuration incomplete" }, 503);
    const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return reply(req, { error: "Admin login required" }, 401);
    const caller = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: auth, error: authErr } = await caller.auth.getUser(token);
    if (authErr || !auth.user) return reply(req, { error: "Valid login required" }, 401);
    const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: adminProfile } = await admin.from("profiles").select("role,is_active").eq("id", auth.user.id).maybeSingle();
    if (adminProfile?.role !== "admin" || adminProfile.is_active !== true) return reply(req, { error: "केवल सक्रिय Admin यह काम कर सकता है।" }, 403);

    const confirmation = await req.json().catch(() => null);
    if (confirmation?.confirm !== "RESET_ALL_NON_ADMIN_STAFF") return reply(req, { error: "Confirmation token missing" }, 400);

    const { data: staff, error: staffErr } = await admin.from("profiles")
      .select("id,full_name,role,phone,created_at,is_active")
      .in("role", ["manager", "team_leader", "sales_executive"])
      .order("created_at", { ascending: true }).order("id", { ascending: true });
    if (staffErr) return reply(req, { error: "कर्मचारी सूची नहीं पढ़ी जा सकी।" }, 500);
    if (!staff?.length) return reply(req, { success: true, count: 0, credentials: [], message: "कोई Staff Account नहीं मिला।" });

    const prepared = [];
    for (const person of staff) {
      const { data: authUser, error: userErr } = await admin.auth.admin.getUserById(person.id);
      if (userErr || !authUser?.user?.email) {
        return reply(req, { error: "एक या अधिक Staff Profile का Auth Login नहीं मिला। कोई Password या Employee ID नहीं बदली गई।", staffName: person.full_name }, 409);
      }
      prepared.push({ ...person, password: makePassword() });
    }

    const changed: Array<{ fullName: string; role: string; phone: string | null; temporaryPassword: string; employeeCode?: string }> = [];
    for (const person of prepared) {
      const { error } = await admin.auth.admin.updateUserById(person.id, { password: person.password });
      if (error) {
        return reply(req, { success: false, partial: changed.length > 0, error: "Password Reset बीच में रुक गया। नीचे केवल सफलतापूर्वक बदले गए Login दिए हैं; बाकी अभी पुराने हैं।", credentials: changed }, 500);
      }
      changed.push({ fullName: person.full_name, role: person.role, phone: person.phone, temporaryPassword: person.password });
    }

    for (let i = 0; i < prepared.length; i++) {
      const employeeCode = "SRD" + String(i + 1).padStart(4, "0");
      const { error } = await admin.from("profiles").update({ employee_code: employeeCode }).eq("id", prepared[i].id);
      if (error) {
        return reply(req, { success: false, partial: true, error: "Password बदल गए हैं लेकिन Employee ID क्रम पूरा नहीं हुआ। नीचे नए Password दिए हैं; IDs की जाँच जरूरी है।", credentials: changed }, 500);
      }
      changed[i].employeeCode = employeeCode;
    }

    const { error: sequenceError } = await admin.rpc("set_employee_code_sequence", { p_next: prepared.length + 1 });
    if (sequenceError) {
      return reply(req, { success: false, partial: true, error: "IDs जारी हो गईं, लेकिन अगली ID की Sequence सेट नहीं हुई। Admin से SQL migration लागू करवाएँ।", credentials: changed }, 500);
    }
    return reply(req, {
      success: true, count: prepared.length, credentials: changed,
      message: "सभी गैर-Admin Staff Password Reset और Employee IDs पुनः क्रमित कर दी गई हैं। पुराने CRM Records सुरक्षित हैं।",
      note: "Passwords केवल इस बार दिखाए गए हैं। इन्हें सुरक्षित रूप से कर्मचारियों तक पहुँचाएँ।",
    });
  } catch (error) {
    console.error("admin-reset-all-staff-logins failed", error instanceof Error ? error.message : "unknown");
    return reply(req, { error: "Bulk Staff Reset पूरा नहीं हो पाया।" }, 500);
  }
});
