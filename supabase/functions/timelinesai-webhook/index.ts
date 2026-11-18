import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const first = (...values: unknown[]) => values.find(v => v !== undefined && v !== null && String(v).trim() !== "");
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const normalizePhone = (value: unknown) => {
  const d = digits(value);
  return d ? "+" + d : "";
};
const phoneCandidates = (phone: string) => {
  const d = digits(phone);
  const last10 = d.slice(-10);
  return [...new Set([phone, d, "+" + d, last10, "91" + last10, "+91" + last10].filter(Boolean))];
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
    console.warn("timelinesai-webhook: rejected request (secret mismatch)");
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  let event: Obj;
  try { event = obj(await req.json()); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders }); }

  const rootData = obj(first(event.data, event.message, event.payload, event));
  const nestedMessage = obj(rootData.message);
  const nestedChat = obj(first(rootData.chat, nestedMessage.chat, event.chat));
  const data: Obj = { ...rootData, ...nestedMessage };
  const eventType = String(first(event.event_type, event.type, rootData.event_type, rootData.type) || "");
  if (!["message:received:new", "message:sent:new"].includes(eventType)) {
    console.log("timelinesai-webhook: ignored event", JSON.stringify({ eventType, rootKeys: Object.keys(event), dataKeys: Object.keys(rootData) }));
    return Response.json({ ok: true, ignored: "unsupported event", event_type: eventType }, { headers: corsHeaders });
  }

  const senderPhone = first(data.sender_phone, data.phone, data.contact_phone, data.whatsapp_phone, obj(data.contact).phone, nestedChat.phone);
  const recipientPhone = first(data.recipient_phone, data.to, obj(data.recipient).phone);
  const fromMe = data.from_me === true || data.whatsapp_from_me === true || obj(data.data).whatsapp_from_me === true;
  const phone = normalizePhone(eventType === "message:received:new" ? senderPhone : (senderPhone || recipientPhone));
  const messageUid = String(first(data.message_uid, data.uid, data.id, obj(data.message).uid) || await uuidFrom(JSON.stringify({
    eventType, chat: first(data.chat_id, nestedChat.id), phone,
    timestamp: first(data.timestamp, data.created_at), text: first(data.text, data.body)
  })));
  const text = String(first(data.text, data.body, data.message_text, data.content, data.transcript) || "");
  const chatId = String(first(data.chat_id, nestedChat.id, data.chatId) || "");
  const senderName = String(first(data.sender_name, data.chat_name, data.contact_name, nestedChat.name, obj(data.contact).name) || phone);

  console.log("timelinesai-webhook: received", JSON.stringify({
    eventType, hasPhone: !!phone, hasMessageUid: !!messageUid, hasText: !!text,
    hasChatId: !!chatId, fromMe, keys: Object.keys(data)
  }));

  if (!phone) {
    console.warn("timelinesai-webhook: ignored because contact phone is missing", JSON.stringify({ eventType, chatId, keys: Object.keys(data) }));
    return Response.json({ ok: true, ignored: "missing contact phone", event_type: eventType, chat_id: chatId }, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Supabase function secrets are incomplete");
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: admins, error: adminError } = await supabase
      .from("profiles").select("id,full_name").ilike("role", "admin").eq("is_active", true).limit(1);
    if (adminError) throw adminError;
    const admin = admins?.[0];
    if (!admin?.id) throw new Error("No active Admin profile found; cannot safely assign inbound WhatsApp lead");

    const candidates = phoneCandidates(phone);
    const { data: leadRows, error: findError } = await supabase
      .from("crm_records").select("id,payload,owner_id,created_by")
      .eq("record_type", "lead")
      .in("payload->>phone", candidates)
      .limit(20);
    if (findError) throw findError;
    const last10 = digits(phone).slice(-10);
    const existing = (leadRows || []).find(row => digits(obj(row.payload).phone).slice(-10) === last10);

    const now = new Date().toISOString();
    const message = {
      uid: messageUid,
      direction: eventType === "message:received:new" ? "incoming" : "outgoing",
      text, phone, chat_id: chatId,
      timestamp: String(first(data.timestamp, data.created_at, now)),
      sender_name: senderName,
      event_type: eventType,
    };

    if (existing) {
      const payload = { ...obj(existing.payload) };
      const history = Array.isArray(payload.whatsappMessages) ? payload.whatsappMessages as Array<Obj> : [];
      if (history.some(item => String(item.uid || "") === messageUid)) {
        console.log("timelinesai-webhook: duplicate message", JSON.stringify({ leadId: existing.id }));
        return Response.json({ ok: true, duplicate: true, lead_id: existing.id }, { headers: corsHeaders });
      }
      payload.whatsappMessages = [...history, message].slice(-500);
      payload.lastWhatsAppMessage = text;
      payload.lastWhatsAppAt = message.timestamp;
      payload.whatsappChatId = chatId;
      const { error } = await supabase.from("crm_records").update({ payload, updated_at: now }).eq("id", existing.id).eq("record_type", "lead");
      if (error) throw error;
      console.log("timelinesai-webhook: updated existing lead", JSON.stringify({ leadId: existing.id }));
      return Response.json({ ok: true, updated: true, lead_id: existing.id }, { headers: corsHeaders });
    }

    if (eventType === "message:sent:new" || fromMe) {
      return Response.json({ ok: true, ignored: "outgoing message without an existing CRM lead" }, { headers: corsHeaders });
    }

    const leadId = await uuidFrom("timelinesai-lead:" + last10);
    const payload = {
      id: leadId, name: senderName || phone, phone, whatsapp: phone,
      project: "Not Selected", source: "WhatsApp", status: "New",
      assigned: admin.full_name, owner_id: admin.id, created_by: admin.id,
      created_by_name: admin.full_name, created_by_role: "admin",
      notes: "WhatsApp se prapt inquiry. CRM mein automatic create hui.",
      created: now.slice(0, 10), whatsappChatId: chatId,
      whatsappMessages: [message], lastWhatsAppMessage: text, lastWhatsAppAt: message.timestamp,
    };
    const { error: insertError } = await supabase.from("crm_records").upsert({
      id: leadId, record_type: "lead", payload,
      owner_id: admin.id, created_by: admin.id, updated_at: now,
    }, { onConflict: "id" });
    if (insertError) throw insertError;
    console.log("timelinesai-webhook: created lead", JSON.stringify({ leadId, phoneLast4: last10.slice(-4) }));
    return Response.json({ ok: true, created: true, lead_id: leadId }, { headers: corsHeaders });
  } catch (error) {
    console.error("timelinesai-webhook: processing failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Webhook processing failed" }, { status: 500, headers: corsHeaders });
  }
});
