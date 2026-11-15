import { createClient } from "npm:@supabase/supabase-js@2";

const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
// GitHub Pages web app + Capacitor Android origins. Override with ALLOWED_ORIGINS in production.
const allowedOrigins = configuredOrigins.length ? configuredOrigins : [
  "https://srdeveloperstf2-sketch.github.io",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
];

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

function temporaryPassword(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = new DataView(bytes.buffer).getUint32(0, false) % 1000000;
  return String(value).padStart(6, "0");
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

    // Verify the JWT first, then check the caller profile using the server-side client.
    // This avoids legitimate Admin access being blocked by profiles table RLS.
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
      console.error("Admin profile lookup failed", profileLookupError.code, profileLookupError.message);
      return json(req, {
        error: "Admin profile lookup failed",
        detail: profileLookupError.message,
        code: profileLookupError.code ?? null,
      }, 500);
    }
    if (!profile || profile.role !== "admin" || profile.is_active !== true) {
      return json(req, { error: "Logged-in account is not an active Admin profile" }, 403);
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
    if (managerId !== null && !UUID.test(managerId)) return json(req, { error: "Invalid reporting manager ID" }, 400);
    if (role === "manager" && managerId !== null) return json(req, { error: "A Manager cannot report to another staff member" }, 400);
    if (role !== "manager" && managerId === null) return json(req, { error: "Select a Reporting Manager" }, 400);

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
    const rawPhone = String(requestRow.phone ?? "").trim();
    const digits = rawPhone.replace(/\D/g, "");
    const phone = digits.length === 10 ? "+91" + digits
      : digits.length === 12 && digits.startsWith("91") ? "+" + digits
      : rawPhone.startsWith("+") && digits.length >= 8 && digits.length <= 15 ? "+" + digits
      : "";
    if (
      fullName.length < 2 || fullName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254
    ) {
      return json(req, { error: "Signup request contains invalid name or email" }, 400);
    }

    if (managerId) {
      const { data: manager, error: managerError } = await admin
        .from("profiles").select("id,role,is_active,manager_id").eq("id", managerId).maybeSingle();
      if (managerError) {
        console.error("Manager lookup failed", managerError.message);
        return json(req, { error: "Could not verify reporting manager" }, 500);
      }
      const validSupervisor = role === "team_leader"
        ? manager?.role === "manager"
        : role === "sales_executive"
          ? ["manager", "team_leader"].includes(manager?.role ?? "")
          : false;
      if (!manager || !validSupervisor || manager.is_active !== true) {
        return json(req, { error: role === "team_leader"
          ? "A Team Leader must report to an active Manager"
          : "A Sales Executive must report to an active Manager or Team Leader" }, 400);
      }
    }

    const password = temporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      ...(phone ? { phone } : {}),
      password,
      email_confirm: true,
      ...(phone ? { phone_confirm: false } : {}),
      user_metadata: { full_name: fullName, account_type: "staff" },
    });
    if (createError || !created.user) {
      console.error("Auth user creation failed", createError?.message ?? "No user returned");
      return json(req, { error: "Could not create login. Check whether this email already has an account." }, 400);
    }
    createdUserId = created.user.id;

    const { data: supervisor } = managerId
      ? await admin.from("profiles").select("id,role,manager_id").eq("id", managerId).maybeSingle()
      : { data: null };
    const { error: insertProfileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      role,
      phone: phone || null,
      manager_id: supervisor?.role === "team_leader" ? supervisor.manager_id : managerId,
      team_leader_id: supervisor?.role === "team_leader" ? managerId : null,
      is_active: true,
    });
    if (insertProfileError) {
      console.error("Profile creation failed", insertProfileError.message);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      return json(req, { error: "Staff profile could not be created; Auth account was rolled back" }, 500);
    }
    profileCreated = true;

    const { data: identityProfile, error: identityError } = await admin
      .from("profiles").select("employee_code").eq("id", created.user.id).single();
    if (identityError || !identityProfile?.employee_code) {
      console.error("Employee code assignment failed", identityError?.message ?? "No employee code returned");
      await admin.from("profiles").delete().eq("id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      profileCreated = false;
      return json(req, { error: "Employee ID could not be assigned. Run employee_identity_migration.sql and retry." }, 500);
    }

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
      employeeCode: identityProfile.employee_code,
      phone,
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
