import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

type IncomingEvent = {
  event_type?: string;
  data?: Record<string, unknown>;
};

const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const normalizePhone = (value: unknown) => {
  const raw = String(value || "").trim();
  const d = digits(raw);
  return d ? (raw.startsWith("+") ? "+" : "+") + d : "";
};
const uuidFrom = async (value: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405, headers: corsHeaders });

  const expected = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  const supplied = new URL(req.url).searchParams.get("secret");
  if (!expected || !supplied || supplied !== expected) {
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  let event: IncomingEvent;
  try { event = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders }); }

  const eventType = String(event.event_type || "");
  if (!["message:received:new", "message:sent:new"].includes(eventType)) {
    return Response.json({ ok: true, ignored: eventType }, { headers: corsHeaders });
  }

  const data = (event.data || {}) as Record<string, unknown>;
  const nestedChat = (data.chat || {}) as Record<string, unknown>;
  const messageUid = String(data.message_uid || data.uid || "");
  const phone = normalizePhone(data.sender_phone || data.phone || data.contact_phone || nestedChat.phone);
  const text = String(data.text || data.message || data.body || "");
  const chatId = String(data.chat_id || nestedChat.id || "");
  if (!messageUid || !phone) {
    return Response.json({ ok: true, ignored: "missing message_uid or sender phone" }, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Supabase function secrets are incomplete");
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: admins, error: adminError } = await supabase
      .from("profiles").select("id,full_name").eq("role", "admin").eq("is_active", true).limit(1);
    if (adminError) throw adminError;
    const admin = admins?.[0];
    if (!admin?.id) throw new Error("No active Admin profile found; cannot safely assign inbound WhatsApp lead");

    const { data: matches, error: findError } = await supabase
      .from("crm_records").select("id,payload,owner_id,created_by")
      .eq("record_type", "lead")
      .filter("payload->>phone", "eq", phone)
      .limit(1);
    if (findError) throw findError;

    const now = new Date().toISOString();
    const message = {
      uid: messageUid,
      direction: eventType === "message:received:new" ? "incoming" : "outgoing",
      text,
      phone,
      chat_id: chatId,
      timestamp: String(data.timestamp || now),
      sender_name: String(data.sender_name || ""),
      event_type: eventType,
    };

    const existing = matches?.[0];
    if (existing) {
      const payload = { ...(existing.payload || {}) } as Record<string, unknown>;
      const history = Array.isArray(payload.whatsappMessages) ? payload.whatsappMessages as Array<Record<string, unknown>> : [];
      if (history.some(item => String(item.uid || "") === messageUid)) {
        return Response.json({ ok: true, duplicate: true, lead_id: existing.id }, { headers: corsHeaders });
      }
      payload.whatsappMessages = [...history, message].slice(-500);
      payload.lastWhatsAppMessage = text;
      payload.lastWhatsAppAt = message.timestamp;
      payload.whatsappChatId = chatId;
      const { error } = await supabase.from("crm_records").update({ payload, updated_at: now }).eq("id", existing.id);
      if (error) throw error;
      return Response.json({ ok: true, updated: true, lead_id: existing.id }, { headers: corsHeaders });
    }

    // Do not create a new lead from messages sent by the company itself.
    if (eventType === "message:sent:new" || data.from_me === true) {
      return Response.json({ ok: true, ignored: "outgoing message without an existing CRM lead" }, { headers: corsHeaders });
    }

    const leadId = await uuidFrom("timelinesai-lead:" + phone);
    const payload = {
      id: leadId,
      name: String(data.sender_name || phone),
      phone,
      whatsapp: phone,
      project: "Not Selected",
      source: "WhatsApp",
      status: "New",
      assigned: admin.full_name,
      owner_id: admin.id,
      created_by: admin.id,
      created_by_name: admin.full_name,
      created_by_role: "admin",
      notes: "WhatsApp se prapt inquiry. CRM mein automatic create hui.",
      created: now.slice(0, 10),
      whatsappChatId: chatId,
      whatsappMessages: [message],
      lastWhatsAppMessage: text,
      lastWhatsAppAt: message.timestamp,
    };
    const { error: insertError } = await supabase.from("crm_records").insert({
      id: leadId,
      record_type: "lead",
      payload,
      owner_id: admin.id,
      created_by: admin.id,
      updated_at: now,
    });
    if (insertError) throw insertError;
    return Response.json({ ok: true, created: true, lead_id: leadId }, { headers: corsHeaders });
  } catch (error) {
    console.error("timelinesai-webhook:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Webhook processing failed" }, { status: 500, headers: corsHeaders });
  }
});