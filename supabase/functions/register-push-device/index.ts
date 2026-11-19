import { createClient } from "npm:@supabase/supabase-js@2";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Cache-Control":"no-store" };
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("SERVICE_ROLE_KEY");
 if(!url||!anon||!sr)return reply({error:"Function not configured"},503);
 const auth=req.headers.get("Authorization")||"";
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error:userErr}=await userClient.auth.getUser();
 if(userErr||!user)return reply({error:"Unauthorized"},401);
 const body=await req.json().catch(()=>null);
 const token=typeof body?.token==="string"?body.token.trim():"";
 const action=body?.action==="revoke"?"revoke":"register";
 if(token.length<40||token.length>4096)return reply({error:"Invalid token"},400);
 const admin=createClient(url,sr);
 const {data:profile,error:profileError}=await admin.from("profiles").select("is_active").eq("id",user.id).maybeSingle();
 if(profileError||!profile?.is_active)return reply({error:"Active CRM staff account required"},403);
 if(action==="revoke"){
  const {error}=await admin.from("push_device_tokens").update({revoked_at:new Date().toISOString()}).eq("user_id",user.id).eq("token",token).is("revoked_at",null);
  if(error)return reply({error:"Token revocation failed"},500);
  return reply({ok:true,action:"revoke"});
 }
 const platform=body?.platform;
 if(!["android","ios"].includes(platform))return reply({error:"Invalid platform"},400);
 const {error}=await admin.from("push_device_tokens").upsert({user_id:user.id,token,platform,device_label:typeof body?.label==="string"?body.label.slice(0,80):null,last_seen_at:new Date().toISOString(),revoked_at:null},{onConflict:"token"});
 if(error)return reply({error:"Token registration failed"},500);
 return reply({ok:true,action:"register"});
});