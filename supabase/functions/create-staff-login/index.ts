import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function getServerSecret(): string | null {
  // Keep privileged credentials server-side only.
  const customSecret = Deno.env.get("SERVICE_ROLE_KEY");
  if (customSecret) return customSecret;

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  // Newer Supabase projects may expose named server-side keys in this JSON map.
  const keyMapRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keyMapRaw) return null;
  try {
    const keyMap = JSON.parse(keyMapRaw) as Record<string, unknown>;
    const value = keyMap.default;
    return typeof value === "string" && value.length > 20 ? value : null;
  } catch {
    return null;
  }
}

function temporaryPassword(length = 28): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const output: string[] = [];
  while (output.length < length) {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      output.push(alphabet[byte % alphabet.length]);
      if (output.length === length) break;
    }
  }
  return output.join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = ["manager", "team_leader", "sales_executive"] as const;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return json(req, { error: "Origin not allowed" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  let createdUserId: string | null = null;
  let profileCreated = false;

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serverSecret = getServerSecret();
    if (!url || !anon || !serverSecret) {
      console.error("Required Supabase server environment is missing", {
        hasUrl: !!url, hasAnon: !!anon, hasServerSecret: !!serverSecret,
      });
      return json(req, { error: "Server configuration is incomplete" }, 500);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json(req, { error: "Admin login required" }, 401);

    const caller = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return json(req, { error: "Valid login required" }, 401);

    const admin = createClient(url, serverSecret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileLookupError } = await admin
      .from("profiles").select("role,is_active").eq("id", authData.user.id).maybeSingle();

    if (profileLookupError) {
      console.error("Admin profile lookup failed", profileLookupError.message);
      return json(req, { error: "Could not verify Admin access" }, 500);
    }
    if (!profile || profile.role !== "admin" || profile.is_active !== true) {
      return json(req, { error: "Only an active Admin can approve staff requests" }, 403);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Valid JSON body required" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(req, { error: "Invalid request body" }, 400);
    }
    const input = body as Record<string, unknown>;
    const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
    const role = typeof input.role === "string" ? input.role : "";
    const managerId = input.managerId === null || input.managerId === "" || input.managerId === undefined
      ? null
      : typeof input.managerId === "string" ? input.managerId.trim() : "invalid";

    if (!UUID.test(requestId)) return json(req, { error: "Valid requestId is required" }, 400);
    if (!ROLES.includes(role as typeof ROLES[number])) {
      return json(req, { error: "Role must be manager, team_leader, or sales_executive" }, 400);
    }
    if (managerId !== null && !UUID.test(managerId)) return json(req, { error: "Invalid managerId" }, 400);

    const { data: requestRow, error: requestError } = await admin
      .from("staff_signup_requests")
      .select("id,full_name,email,phone,requested_role,status")
      .eq("id", requestId).eq("status", "pending").maybeSingle();

    if (requestError) {
      console.error("Signup request lookup failed", requestError.message);
      return json(req, { error: "Could not read signup request" }, 500);
    }
    if (!requestRow) return json(req, { error: "Pending signup request not found or already handled" }, 404);

    const fullName = String(requestRow.full_name ?? "").trim();
    const email = String(requestRow.email ?? "").trim().toLowerCase();
    const phone = String(requestRow.phone ?? "").trim();
    if (
      fullName.length < 2 || fullName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    ) {
      return json(req, { error: "Signup request contains invalid name or email" }, 400);
    }

    if (managerId) {
      const { data: manager, error: managerError } = await admin
        .from("profiles").select("id,role,is_active").eq("id", managerId).maybeSingle();
      if (managerError) {
        console.error("Manager lookup failed", managerError.message);
        return json(req, { error: "Could not verify reporting manager" }, 500);
      }
      if (!manager || manager.role !== "manager" || manager.is_active !== true) {
        return json(req, { error: "Reporting manager must be an active Manager" }, 400);
      }
    }

    const password = temporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, account_type: "staff" },
    });
    if (createError || !created.user) {
      console.error("Auth user creation failed", createError?.message ?? "No user returned");
      return json(req, { error: "Could not create login. Check whether this email already has an account." }, 400);
    }
    createdUserId = created.user.id;

    const { error: insertProfileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      role,
      phone: phone || null,
      manager_id: managerId,
      is_active: true,
    });
    if (insertProfileError) {
      console.error("Profile creation failed", insertProfileError.message);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      return json(req, { error: "Staff profile could not be created; Auth account was rolled back" }, 500);
    }
    profileCreated = true;

    const { data: approved, error: approvalError } = await admin
      .from("staff_signup_requests")
      .update({
        status: "approved",
        reviewed_by: authData.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId).eq("status", "pending").select("id").maybeSingle();

    if (approvalError || !approved) {
      console.error("Approval update failed", approvalError?.message ?? "Request already handled");
      await admin.from("profiles").delete().eq("id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      profileCreated = false;
      return json(req, { error: "Request was already handled or approval failed; new account rolled back" }, 409);
    }

    createdUserId = null;
    profileCreated = false;
    return json(req, {
      userId: created.user.id,
      fullName,
      email,
      role,
      managerId,
      requestId,
      temporaryPassword: password,
      message: "Save this password now. It will not be returned again.",
    });
  } catch (error) {
    console.error("Unexpected create-staff-login error", error instanceof Error ? error.message : "Unknown error");
    if (createdUserId) {
      const url = Deno.env.get("SUPABASE_URL");
      const secret = getServerSecret();
      if (url && secret) {
        const admin = createClient(url, secret, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        if (profileCreated) await admin.from("profiles").delete().eq("id", createdUserId);
        await admin.auth.admin.deleteUser(createdUserId);
      }
    }
    return json(req, { error: "Unexpected server error" }, 500);
  }
});
