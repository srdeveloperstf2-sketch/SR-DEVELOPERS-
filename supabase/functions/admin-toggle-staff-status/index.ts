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
function reply(req: Request, body: Record<string, unknown>, status=200) {
  return new Response(JSON.stringify(body), {status,headers:{...cors(req),"Content-Type":"application/json","Cache-Control":"no-store"}});
}
function serverKey(): string | null {
  const direct=Deno.env.get("SERVICE_ROLE_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(direct)return direct;
  try { const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}"); return typeof keys.default==="string"?keys.default:null; }
  catch { return null; }
}
function randomPassword(): string {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";
  const bytes=new Uint8Array(40); crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(origin&&!origins.includes(origin))return reply(req,{error:"Origin not allowed"},403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=="POST")return reply(req,{error:"POST required"},405);
  try {
    const url=Deno.env.get("SUPABASE_URL");
    const anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const secret=serverKey();
    if(!url||!anon||!secret)return reply(req,{error:"Staff status service not configured"},503);
    const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return reply(req,{error:"Admin login required"},401);
    const caller=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:userData,error:userError}=await caller.auth.getUser(token);
    if(userError||!userData.user)return reply(req,{error:"Valid login required"},401);
    const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:callerProfile,error:callerProfileError}=await admin.from("profiles").select("role,is_active").eq("id",userData.user.id).maybeSingle();
    if(callerProfileError||callerProfile?.role!=="admin"||callerProfile?.is_active!==true)return reply(req,{error:"केवल सक्रिय Admin यह बदलाव कर सकता है।"},403);
    const body=await req.json().catch(()=>null);
    const targetId=typeof body?.targetId==="string"?body.targetId:"";
    const active=body?.isActive;
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuid.test(targetId)||typeof active!=="boolean")return reply(req,{error:"Staff ID या Status सही नहीं है।"},400);
    if(targetId===userData.user.id)return reply(req,{error:"आप अपना Admin Login यहाँ से बंद नहीं कर सकते।"},400);
    const {data:target,error:targetError}=await admin.from("profiles").select("id,full_name,role,is_active").eq("id",targetId).maybeSingle();
    if(targetError||!target)return reply(req,{error:"कर्मचारी रिकॉर्ड नहीं मिला।"},404);
    if(target.role==="admin")return reply(req,{error:"Admin Account को Staff Control से disable/enable नहीं किया जा सकता।"},403);
    if(target.is_active===active)return reply(req,{success:true,unchanged:true,is_active:active});
    if(!active){
      // Fail closed: ban sign-ins first, then mark inactive, then rotate password.
      const ban=await admin.auth.admin.updateUserById(targetId,{ban_duration:"876000h"});
      if(ban.error)return reply(req,{error:"Auth ban लागू नहीं हुआ; Profile status नहीं बदला।"},500);
      const {error:profileUpdate}=await admin.from("profiles").update({is_active:false}).eq("id",targetId);
      if(profileUpdate){
        await admin.auth.admin.updateUserById(targetId,{ban_duration:"none"});
        return reply(req,{error:"Profile inactive नहीं हुई; Auth ban rollback किया गया।"},500);
      }
      const rotated=await admin.auth.admin.updateUserById(targetId,{password:randomPassword()});
      if(rotated.error){
        // Keep the profile inactive and Auth banned. This is safer than reopening access.
        return reply(req,{success:false,is_active:false,warning:"Profile inactive और sign-in banned है, लेकिन password/session invalidation चरण में error आया। Admin को Auth logs जाँचने चाहिए।"},500);
      }
      return reply(req,{success:true,is_active:false,message:"Profile inactive, Auth sign-in banned, और password rotated. Existing JWTs remain valid until expiry, but active-profile RLS checks deny access."});
    }
    // Reactivation lifts Auth ban first; if DB update fails, restore the ban.
    const unban=await admin.auth.admin.updateUserById(targetId,{ban_duration:"none"});
    if(unban.error)return reply(req,{error:"Auth ban हटाया नहीं गया; Profile अभी inactive रहेगी।"},500);
    const {error:profileUpdate}=await admin.from("profiles").update({is_active:true}).eq("id",targetId);
    if(profileUpdate){
      await admin.auth.admin.updateUserById(targetId,{ban_duration:"876000h"});
      return reply(req,{error:"Profile activate नहीं हुई; Auth ban वापस लगाया गया।"},500);
    }
    return reply(req,{success:true,is_active:true,message:"Profile सक्रिय। Employee को Admin से नया password reset लेना होगा क्योंकि deactivate करते समय password rotate किया गया था।"});
  } catch(e) {
    console.error("admin-toggle-staff-status failed",e instanceof Error?e.message:"unknown");
    return reply(req,{error:"Staff Status Security operation पूरी नहीं हुई।"},500);
  }
});
