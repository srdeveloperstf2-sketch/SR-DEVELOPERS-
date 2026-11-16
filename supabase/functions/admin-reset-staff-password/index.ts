import { createClient } from "npm:@supabase/supabase-js@2";

const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://srdeveloperstf2-sketch.github.io,https://localhost,capacitor://localhost,http://localhost")
  .split(",").map(v => v.trim()).filter(Boolean);

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Vary": "Origin",
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "https://srdeveloperstf2-sketch.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
function reply(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function serverKey(): string | null {
  const direct = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return typeof keys.default === "string" ? keys.default : null;
  } catch { return null; }
}
function makeTemporaryPassword(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !origins.includes(origin)) return reply(req, { error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "POST required" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const secret = serverKey();
    if (!url || !anon || !secret) return reply(req, { error: "Password reset service is not configured" }, 503);

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.match(/^Bearer\\s+(.+)$/i)?.[1];
    if (!token) return reply(req, { error: "Admin login required" }, 401);

    const caller = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { error: "Valid login required" }, 401);

    const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: adminProfile, error: adminError } = await admin.from("profiles")
      .select("role,is_active").eq("id", authData.user.id).maybeSingle();
    if (adminError || adminProfile?.role !== "admin" || adminProfile?.is_active !== true) {
      return reply(req, { error: "केवल सक्रिय Admin यह काम कर सकता है।" }, 403);
    }

    const body = await req.json().catch(() => null);
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(userId)) return reply(req, { error: "कर्मचारी ID सही नहीं है।" }, 400);

    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,full_name,employee_code,phone,is_active").eq("id", userId).maybeSingle();
    if (targetError || !target) return reply(req, { error: "कर्मचारी रिकॉर्ड नहीं मिला।" }, 404);

    const temporaryPassword = makeTemporaryPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
    if (updateError) {
      console.error("Staff password reset failed:", updateError.message);
      return reply(req, { error: "Supabase Auth Password अपडेट नहीं हुआ।" }, 500);
    }

    return reply(req, {
      success: true,
      employeeCode: target.employee_code,
      phone: target.phone,
      fullName: target.full_name,
      temporaryPassword,
      note: "यह अस्थायी Password केवल एक बार दिखाया गया है। इसे सुरक्षित रूप से कर्मचारी तक पहुँचाएँ।",
    });
  } catch (error) {
    console.error("admin-reset-staff-password failed:", error instanceof Error ? error.message : "unknown");
    return reply(req, { error: "Password Reset अभी पूरा नहीं हो पाया।" }, 500);
  }
});
