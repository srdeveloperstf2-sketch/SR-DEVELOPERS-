import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) return json({ error: "Server secret is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: "Admin login required" }, 401);

  const admin = createClient(url, service);
  const { data: profile } = await admin.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.is_active) return json({ error: "Only active Admin can create partner login" }, 403);

  const body = await req.json().catch(() => ({}));
  const partnerId = String(body.partnerId || "");
  const email = String(body.email || "").trim().toLowerCase();
  if (!partnerId || !email || !email.includes("@")) return json({ error: "Partner ID and valid email are required" }, 400);

  const { data: partner, error: partnerError } = await admin.from("channel_partners")
    .select("id,partner_code,full_name,status,auth_user_id").eq("id", partnerId).maybeSingle();
  if (partnerError || !partner) return json({ error: "Partner record not found" }, 404);
  if (partner.auth_user_id) return json({ error: "This partner already has a login" }, 409);

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const random = new Uint32Array(16);
  crypto.getRandomValues(random);
  const temporaryPassword = Array.from(random, n => alphabet[n % alphabet.length]).join("");
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password: temporaryPassword, email_confirm: true,
    user_metadata: { partner_id: partner.id, partner_code: partner.partner_code, account_type: "channel_partner" },
  });
  if (createError || !created.user) return json({ error: createError?.message || "Could not create login" }, 400);

  const { error: updateError } = await admin.from("channel_partners")
    .update({ auth_user_id: created.user.id, status: "active" }).eq("id", partner.id);
  if (updateError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Login created but partner linking failed; account rolled back" }, 500);
  }
  return json({
    partnerCode: partner.partner_code,
    email,
    temporaryPassword,
    message: "Share this temporary password securely. Ask the partner to change it after first sign-in.",
  });
});
