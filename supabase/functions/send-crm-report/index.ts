import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGINS")?.split(",")[0]?.trim() || "https://srdeveloperstf2-sketch.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const TYPE_LABELS: Record<string, string> = {
  lead: "Leads",
  followup: "Follow-ups",
  visit: "Site Visits",
  booking: "Bookings",
  attendance: "Attendance",
  call_log: "Call Logs",
  inventory: "Inventory",
  payment: "Payments",
  partner: "Partners",
  partner_payout: "Partner Payouts",
  message: "Messages",
  resource: "Resources",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "POST required" }, 405);

  const expected = Deno.env.get("CRM_REPORT_CRON_SECRET");
  const supplied = req.headers.get("x-cron-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied !== expected) return response({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const reportType = body?.report_type === "evening" ? "evening" : "morning";
    const reportLabel = reportType === "evening" ? "Evening Report" : "Morning Report";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("REPORT_FROM_EMAIL");
    const to = Deno.env.get("ADMIN_REPORT_EMAIL") || "srdeveloperstf2@gmail.com";
    if (!supabaseUrl || !serviceKey || !resendKey || !from) {
      return response({ error: "Missing required function secrets: Supabase URL/key, RESEND_API_KEY or REPORT_FROM_EMAIL" }, 503);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = new Date();
    // Build report windows by India calendar day (IST), then convert to UTC for Postgres.
    const IST_OFFSET_MS = 330 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const todayIstStartUtc = new Date(Date.UTC(
      istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()
    ) - IST_OFFSET_MS);
    const morningStartUtc = new Date(todayIstStartUtc.getTime() - 24 * 60 * 60 * 1000);
    const start = reportType === "morning" ? morningStartUtc : todayIstStartUtc;
    const end = reportType === "morning" ? todayIstStartUtc : now;
    const reportWindowDescription = reportType === "morning"
      ? "पिछले कैलेंडर दिन (00:00–24:00 IST)"
      : "आज (00:00 IST से रिपोर्ट बनने तक)";
    const { data, error } = await supabase
      .from("crm_records")
      .select("id,record_type,payload,owner_id,created_by,updated_at")
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString())
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error("CRM data query failed: " + error.message);

    const counts: Record<string, number> = {};
    for (const row of data || []) counts[row.record_type] = (counts[row.record_type] || 0) + 1;

    const rows = Object.entries(TYPE_LABELS)
      .map(([type, label]) => ({ label, count: counts[type] || 0 }))
      .filter((item) => item.count > 0);

    const istDate = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short",
    }).format(now);

    const tableRows = rows.length
      ? rows.map((item) => `<tr><td style="padding:10px;border-bottom:1px solid #eee">${item.label}</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee">${item.count}</td></tr>`).join("")
      : '<tr><td colspan="2" style="padding:12px">${reportWindowDescription} में कोई CRM रिकॉर्ड अपडेट नहीं हुआ।</td></tr>';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#202124">
        <h2 style="color:#176b45">S.R. DEVELOPERS — CRM ${reportLabel}</h2>
        <p><b>Report generated:</b> ${istDate} (IST)</p>
        <p>यह रिपोर्ट ${reportWindowDescription} में CRM रिकॉर्ड अपडेट का सारांश है।</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f6f4"><th style="padding:10px;text-align:left">Activity</th><th style="padding:10px;text-align:right">Updated records</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p style="margin-top:22px;color:#666;font-size:12px">यह स्वचालित रिपोर्ट है। ग्राहक का निजी विवरण ईमेल में शामिल नहीं किया गया है।</p>
      </div>`;

    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `S.R. DEVELOPERS CRM — ${reportLabel} — ${istDate}`,
        html,
      }),
    });
    const result = await mail.json().catch(() => ({}));
    if (!mail.ok) throw new Error("Resend delivery failed: " + (result.message || mail.statusText));

    return response({
      ok: true,
      sent_to: to,
      report_type: reportType,
      report_label: reportLabel,
      report_window: reportType === "morning" ? "previous_ist_calendar_day" : "today_ist_to_now",
      records_included: (data || []).length,
      counts,
      resend_id: result.id || null,
    });
  } catch (error) {
    console.error("send-crm-report:", error instanceof Error ? error.message : "unknown error");
    return response({ error: error instanceof Error ? error.message : "Report failed" }, 500);
  }
});
