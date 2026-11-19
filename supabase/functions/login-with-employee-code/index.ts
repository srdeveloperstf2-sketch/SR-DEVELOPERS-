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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !origins.includes(origin)) return reply(req, { error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "POST required" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const secret = serverKey();
    if (!url || !anon || !secret) return reply(req, { error: "Login service is not configured" }, 503);

    const body = await req.json().catch(() => null);
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() :
      typeof body?.employeeCode === "string" ? body.employeeCode.trim() : "";
    const code = identifier.toUpperCase();
    const digits = identifier.replace(/\D/g, "");
    const mobile = digits.length === 10 ? "+91" + digits :
      digits.length === 12 && digits.startsWith("91") ? "+" + digits : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const isCode = /^SRD[0-9]{4,}$/.test(code);
    if ((!isCode && !mobile) || !/^\d{6}$/.test(password)) {
      return reply(req, { error: "Employee ID / Mobile Number या Password सही नहीं है।" }, 400);
    }

    // Durable server-side throttle: 10 attempts per normalized identifier in a 15-minute window.
    // Avoid spoofable forwarded-IP headers; hash identifier before sending to the RPC.
    // Canonicalize all accepted login forms to reduce throttle-key variants.
    const normalizedRateId = isCode ? code : mobile;
    const rateKeyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedRateId));
    const rateKey = Array.from(new Uint8Array(rateKeyBytes), b => b.toString(16).padStart(2, "0")).join("");
    const rateAdmin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: rateAllowed, error: rateError } = await rateAdmin.rpc("consume_employee_login_attempt", { p_key_hash: rateKey });
    if (rateError) {
      console.error("Login rate-limit RPC unavailable", rateError.message);
      return reply(req, { error: "Login सेवा अस्थायी रूप से उपलब्ध नहीं है।" }, 503);
    }
    if (rateAllowed !== true) return reply(req, { error: "बहुत अधिक Login प्रयास हुए। 15 मिनट बाद फिर प्रयास करें।" }, 429);

    const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
    const publicClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });

    const phoneVariants = mobile ? [mobile, mobile.slice(1), mobile.slice(2), digits, digits.length === 10 ? "91" + digits : ""].filter(Boolean) : [];
    const { data: profile, error: profileError } = isCode
      ? await admin.from("profiles").select("id,is_active").ilike("employee_code", code).maybeSingle()
      : await admin.from("profiles").select("id,is_active").in("phone", phoneVariants).maybeSingle();
    if (profileError || !profile?.id || profile.is_active !== true) {
      return reply(req, { error: "Login ID / Mobile Number या Password सही नहीं है।" }, 401);
    }

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    const email = authUser?.user?.email;
    if (authUserError || !email) return reply(req, { error: "Login ID / Mobile Number या Password सही नहीं है।" }, 401);

    // Supabase Auth remains the password verifier and applies its password sign-in protections.
    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) {
      return reply(req, { error: "Login ID / Mobile Number या Password सही नहीं है।" }, 401);
    }

    return reply(req, {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      token_type: signedIn.session.token_type,
      expires_in: signedIn.session.expires_in,
      expires_at: signedIn.session.expires_at,
    });
  } catch (error) {
    console.error("employee-code-login failed", error instanceof Error ? error.message : "unknown");
    return reply(req, { error: "अभी Login नहीं हो पाया। कुछ देर बाद फिर प्रयास करें।" }, 500);
  }
});
