import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
 if(req.method!=="POST")return json({error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!service)return json({error:"Server secret is not configured"},500);
 const auth=req.headers.get("Authorization")||"";
 const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error:authErr}=await caller.auth.getUser();
 if(authErr||!user)return json({error:"Admin login required"},401);
 const admin=createClient(url,service);
 const {data:adminProfile}=await admin.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
 if(!adminProfile||adminProfile.role!=="admin"||!adminProfile.is_active)return json({error:"Only active Admin can create staff accounts"},403);
 const body=await req.json().catch(()=>({}));
 const role=String(body.role||"sales_executive");
 const allowed=["manager","team_leader","sales_executive"];
 const email=String(body.email||"").trim().toLowerCase();
 const fullName=String(body.fullName||"").trim();
 const phone=String(body.phone||"").trim();
 const managerId=body.managerId?String(body.managerId):null;
 const requestId=body.requestId?String(body.requestId):null;
 if(!allowed.includes(role)||!email.includes("@")||fullName.length<2)return json({error:"Valid name, email and permitted staff role are required"},400);
 if(managerId){const {data:m}=await admin.from("profiles").select("id,role,is_active").eq("id",managerId).maybeSingle();if(!m||!m.is_active||m.role!=="manager")return json({error:"Selected reporting manager is not active"},400);}
 let request=null;
 if(requestId){const {data,error}=await admin.from("staff_signup_requests").select("*").eq("id",requestId).eq("status","pending").maybeSingle();if(error||!data)return json({error:"Pending signup request not found"},404);request=data;}
 const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
 const random=new Uint32Array(18);crypto.getRandomValues(random);
 const temporaryPassword=Array.from(random,n=>alphabet[n%alphabet.length]).join("");
 const {data:created,error:createErr}=await admin.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true,user_metadata:{full_name:fullName,account_type:"staff"}});
 if(createErr||!created.user)return json({error:createErr?.message||"Could not create auth user"},400);
 const profile={id:created.user.id,full_name:fullName,role,phone:phone||null,manager_id:managerId,is_active:true};
 const {error:profileErr}=await admin.from("profiles").insert(profile);
 if(profileErr){await admin.auth.admin.deleteUser(created.user.id);return json({error:"Profile creation failed: "+profileErr.message},500);}
 if(requestId){const {error:updateErr}=await admin.from("staff_signup_requests").update({status:"approved",reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq("id",requestId);if(updateErr){await admin.from("profiles").delete().eq("id",created.user.id);await admin.auth.admin.deleteUser(created.user.id);return json({error:"Approval failed and account rolled back: "+updateErr.message},500);}}
 return json({userId:created.user.id,fullName,email,role,temporaryPassword,requestId,message:"Staff login created. Share temporary password securely and ask user to change it after first login."});
});