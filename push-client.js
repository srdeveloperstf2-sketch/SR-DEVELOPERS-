(() => {
 const native=window.Capacitor?.Plugins?.PushNotifications;
 let registeredToken=null,ready=false,registering=false,listenersInstalled=false;
 const config=window.SR_SUPABASE_CONFIG||{};
 const platform=()=>window.Capacitor?.getPlatform?.()==="ios"?"ios":"android";
 async function session(){const c=window.srAuthClient; if(!c)return null;const {data}=await c.auth.getSession();return data?.session||null}
 async function call(action,token,extra={}){
  const s=await session();if(!s?.access_token||!config.url||!config.publishableKey)throw new Error("Push registration needs active CRM login");
  const r=await fetch(config.url+"/functions/v1/register-push-device",{method:"POST",headers:{"Content-Type":"application/json","apikey":config.publishableKey,"Authorization":"Bearer "+s.access_token},body:JSON.stringify({action,token,platform:platform(),label:"S.R. CRM Android",...extra})});
  if(!r.ok)throw new Error("Device token endpoint failed "+r.status);
  return r.json();
 }
 async function installListeners(){
  if(listenersInstalled)return;
  await native.addListener("registration",async ({value})=>{
   const token=String(value||"").trim();if(!token)return;
   registeredToken=token;
   try{await call("register",token);console.info("CRM push token registered (token not logged)")}catch(e){console.error("Push token registration error",e)}
  });
  await native.addListener("registrationError",e=>console.error("Push registration error",e));
  await native.addListener("pushNotificationReceived",n=>window.dispatchEvent(new CustomEvent("sr-push-received",{detail:n})));
  await native.addListener("pushNotificationActionPerformed",a=>window.dispatchEvent(new CustomEvent("sr-push-action",{detail:a})));
  listenersInstalled=true;
 }
 async function register(){
  if(!native||registering)return;
  // Do not invoke the native Firebase plugin in builds that have no matching google-services.json.
  if(window.SR_FCM_CONFIGURED!==true){ready=false;console.info("FCM disabled: Android Firebase configuration not packaged");return;}
  registering=true;
  try{
   const status=await native.checkPermissions();
   const permission=status.receive==="granted" ? status : await native.requestPermissions();
   if(permission.receive!=="granted"){ready=false;console.info("FCM permission not granted; registration can be retried");return}
   if(platform()==="android"&&native.createChannel){await native.createChannel({id:"crm-push",name:"CRM Alerts",description:"S.R. Developers CRM push alerts",importance:5});}
   await installListeners();
   await native.register();
   ready=true;
  }catch(e){ready=false;console.error("Push setup error",e)}
  finally{registering=false}
 }
 async function revoke(){
  const t=registeredToken;registeredToken=null;ready=false;
  if(t){try{await call("revoke",t)}catch(e){console.warn("Token revocation deferred; server token cleanup required",e)}}
 }
 window.addEventListener("sr-auth-ready",register);
 window.addEventListener("sr-auth-logout",revoke);
 window.srPushRegistration={register,revoke};
})();