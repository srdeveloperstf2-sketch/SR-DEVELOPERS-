import { createClient } from "npm:@supabase/supabase-js@2";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods":"POST, OPTIONS", "Cache-Control":"no-store" };
const reply=(b:Record<string,unknown>,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const enc=(s:string)=>btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
async function accessToken(sa:any){
 const now=Math.floor(Date.now()/1000);
 const head=enc(JSON.stringify({alg:"RS256",typ:"JWT"}));
 const claims=enc(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
 const unsigned=head+"."+claims;
 const key=await crypto.subtle.importKey("pkcs8",pem(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
 const assertion=unsigned+"."+enc(String.fromCharCode(...new Uint8Array(sig)));
 const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
 if(!res.ok)throw new Error("Google OAuth token exchange failed ("+res.status+")");
 return (await res.json()).access_token as string;
}
function pem(v:string){return Uint8Array.from(atob(v.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0)).buffer}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 const secret=Deno.env.get("PUSH_DISPATCH_SECRET");
 if(!secret||req.headers.get("x-cron-secret")!==secret)return reply({error:"Unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("SERVICE_ROLE_KEY"),raw=Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
 if(!url||!sr||!raw)return reply({error:"Missing dispatcher configuration"},503);
 let sa:any;try{sa=JSON.parse(raw)}catch{return reply({error:"Invalid Firebase service-account JSON"},503)}
 if(!sa.project_id||!sa.client_email||!sa.private_key)return reply({error:"Service-account fields missing"},503);
 const db=createClient(url,sr);
 const {data:jobs,error}=await db.from("crm_push_jobs").select("*").in("status",["pending","failed"]).lte("next_attempt_at",new Date().toISOString()).lt("attempts",8).order("created_at").limit(50);
 if(error)return reply({error:"Queue read failed"},500);
 if(!jobs?.length)return reply({processed:0});
 let bearer:string;try{bearer=await accessToken(sa)}catch{return reply({error:"FCM OAuth failed"},503)}
 let sent=0,failed=0,invalid=0;
 for(const job of jobs){
  // Claim each row atomically via conditional update to reduce concurrent duplicate sends.
  const {data:claim}=await db.from("crm_push_jobs").update({status:"processing",attempts:job.attempts+1}).eq("id",job.id).in("status",["pending","failed"]).select("id").maybeSingle();
  if(!claim)continue;
  const {data:devices}=await db.from("push_device_tokens").select("id,token").eq("user_id",job.recipient_id).is("revoked_at",null);
  if(!devices?.length){await db.from("crm_push_jobs").update({status:"failed",last_error:"No active device token",next_attempt_at:new Date(Date.now()+3600000).toISOString()}).eq("id",job.id);failed++;continue}
  let jobSent=false,permanent=false,lastError="";
  for(const d of devices){
   const res=await fetch("https://fcm.googleapis.com/v1/projects/"+sa.project_id+"/messages:send",{method:"POST",headers:{Authorization:"Bearer "+bearer,"Content-Type":"application/json"},body:JSON.stringify({message:{token:d.token,notification:{title:job.title,body:job.body},data:Object.fromEntries(Object.entries(job.data||{}).map(([k,v])=>[k,String(v)])),android:{priority:"HIGH",notification:{channel_id:"crm-push"}}}})});
   if(res.ok){jobSent=true;continue}
   const txt=await res.text().catch(()=> "");
   lastError="FCM "+res.status+" "+txt.slice(0,300);
   if(res.status===404||res.status===400){await db.from("push_device_tokens").update({revoked_at:new Date().toISOString()}).eq("id",d.id);invalid++}
   if(res.status===401||res.status===403){permanent=true;break}
  }
  if(jobSent){await db.from("crm_push_jobs").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",job.id);sent++}
  else {const attempts=job.attempts+1;const delay=Math.min(3600,30*Math.pow(2,attempts));await db.from("crm_push_jobs").update({status:"failed",last_error:lastError||"No send succeeded",next_attempt_at:new Date(Date.now()+delay*1000).toISOString()}).eq("id",job.id);failed++;if(permanent)break}
 }
 return reply({processed:jobs.length,sent,failed,invalidTokensRevoked:invalid});
});
