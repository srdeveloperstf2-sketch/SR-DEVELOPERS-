import { createClient } from "npm:@supabase/supabase-js@2";

const configuredOrigins=(Deno.env.get("ALLOWED_ORIGINS")??"").split(",").map(v=>v.trim()).filter(Boolean);
const allowedOrigins=configuredOrigins.length?configuredOrigins:[
  "https://srdeveloperstf2-sketch.github.io","https://localhost","capacitor://localhost","http://localhost"
];
function corsHeaders(req:Request){
  const origin=req.headers.get("Origin");
  const h:Record<string,string>={"Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"86400"};
  if(origin&&allowedOrigins.includes(origin))h["Access-Control-Allow-Origin"]=origin;
  return h;
}
function json(req:Request,body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(req),"Content-Type":"application/json","Cache-Control":"no-store"}});
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function password(){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const limit=Math.floor(256/alphabet.length)*alphabet.length,out:string[]=[];
  while(out.length<28){const bytes=new Uint8Array(64);crypto.getRandomValues(bytes);for(const b of bytes){if(b>=limit)continue;out.push(alphabet[b%alphabet.length]);if(out.length===28)break;}}
  return out.join("");
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(origin&&!allowedOrigins.includes(origin))return json(req,{error:"Origin not allowed"},403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(req)});
  if(req.method!=="POST")return json(req,{error:"POST required"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL");
    const anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const service=Deno.env.get("SERVICE_ROLE_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anon||!service)return json(req,{error:"Server configuration is incomplete"},500);
    const token=req.headers.get("Authorization")?.match(/^Bearer\\s+(.+)$/i)?.[1];
    if(!token)return json(req,{error:"Admin login required"},401);
    const caller=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:auth,error:authError}=await caller.auth.getUser(token);
    if(authError||!auth.user)return json(req,{error:"Valid login required"},401);
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:profile,error:profileError}=await admin.from("profiles").select("role,is_active").eq("id",auth.user.id).maybeSingle();
    if(profileError)return json(req,{error:"Could not verify Admin profile"},500);
    if(profile?.role!=="admin"||profile.is_active!==true)return json(req,{error:"Only an active Admin can create partner logins"},403);
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
    const partnerId=typeof body?.partnerId==="string"?body.partnerId.trim():"";
    const email=typeof body?.email==="string"?body.email.trim().toLowerCase():"";
    if(!UUID.test(partnerId)||! /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)||email.length>254)
      return json(req,{error:"Valid Partner ID and email are required"},400);
    const {data:partner,error:partnerError}=await admin.from("channel_partners")
      .select("id,partner_code,status,auth_user_id").eq("id",partnerId).maybeSingle();
    if(partnerError)return json(req,{error:"Could not read Partner record"},500);
    if(!partner)return json(req,{error:"Partner record not found"},404);
    if(partner.auth_user_id)return json(req,{error:"This Partner already has a login"},409);
    if(!["pending","active"].includes(partner.status))return json(req,{error:"Partner must be pending or active"},409);
    const temporaryPassword=password();
    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email,password:temporaryPassword,email_confirm:true,
      user_metadata:{partner_id:partner.id,partner_code:partner.partner_code,account_type:"channel_partner"}
    });
    if(createError||!created.user)return json(req,{error:"Could not create login. Check whether this email already has an account."},400);
    const {error:updateError}=await admin.from("channel_partners")
      .update({auth_user_id:created.user.id,status:"active"}).eq("id",partner.id).is("auth_user_id",null);
    if(updateError){
      await admin.auth.admin.deleteUser(created.user.id);
      return json(req,{error:"Partner linking failed; login account was rolled back"},500);
    }
    return json(req,{partnerCode:partner.partner_code,email,temporaryPassword,message:"Save this password now. It will not be returned again."});
  }catch(error){
    console.error("create-partner-login failed",error instanceof Error?error.message:"Unknown error");
    return json(req,{error:"Unexpected server error"},500);
  }
});
