(() => {
  const cfg=window.SR_SUPABASE_CONFIG||{};
  const $=id=>document.getElementById(id);
  const authBox=$('partnerAuth'),dash=$('partnerDashboard'),status=$('partnerAuthStatus');
  const say=(el,msg,error=false)=>{el.textContent=msg;el.className=error?'partner-error':'partner-success'};
  if(!cfg.url||!cfg.publishableKey||!window.supabase){say(status,'Supabase configuration उपलब्ध नहीं है। Admin से संपर्क करें।',true);return;}
  const client=window.supabase.createClient(cfg.url,cfg.publishableKey);
  let partner=null;
  const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  $('partnerRequest').addEventListener('submit',async e=>{
    e.preventDefault();const b=$('requestBtn');b.disabled=true;b.textContent='Request भेजी जा रही है…';
    const payload={full_name:$('requestName').value.trim(),email:$('requestEmail').value.trim().toLowerCase(),phone:$('requestPhone').value.trim(),partner_type:$('requestType').value,firm_name:$('requestFirm').value.trim()||null,area:$('requestArea').value.trim()||null,project_interest:$('requestProject').value.trim()||null,message:$('requestMessage').value.trim()||null,status:'pending'};
    const {error}=await client.from('partner_signup_requests').insert(payload);
    if(error)say(status,'Request नहीं भेजी गई: '+error.message,true);else{$('partnerRequest').reset();say(status,'आपकी Request Admin को भेज दी गई है। Approval के बाद Login ID मिलेगी।');}
    b.disabled=false;b.textContent='Approval Request भेजें';
  });
  $('partnerLogin').addEventListener('submit',async e=>{
    e.preventDefault();const b=$('partnerLoginBtn');b.disabled=true;b.textContent='Login हो रहा है…';
    const {data,error}=await client.auth.signInWithPassword({email:$('partnerEmail').value.trim().toLowerCase(),password:$('partnerPassword').value});
    if(error){say(status,'Login नहीं हुआ: '+error.message,true);b.disabled=false;b.textContent='Login करें';return;}
    await openPartner(data.user);b.disabled=false;b.textContent='Login करें';
  });
  async function openPartner(user){
    const {data,error}=await client.from('channel_partners').select('id,partner_code,full_name,phone,firm_name,commission_percent,project_scope,status').eq('auth_user_id',user.id).maybeSingle();
    if(error||!data||data.status!=='active'){await client.auth.signOut();say(status,'यह Partner Account सक्रिय नहीं है। Admin Approval के लिए संपर्क करें।',true);return;}
    partner=data;authBox.classList.add('partner-hidden');dash.classList.remove('partner-hidden');$('partnerWelcome').textContent='नमस्ते, '+data.full_name;$('partnerMeta').textContent='Partner Code: '+data.partner_code+' · '+(data.firm_name||'Independent Partner');
    await loadPartnerData();
  }
  async function loadPartnerData(){
    const [leads,commissions]=await Promise.all([
      client.from('partner_leads').select('id,customer_name,phone,project_name,requirement,budget,status,created_at').eq('partner_id',partner.id).order('created_at',{ascending:false}),
      client.from('partner_commissions').select('id,gross_amount,commission_percent,commission_amount,status,due_date,paid_at,payment_reference,created_at').eq('partner_id',partner.id).order('created_at',{ascending:false})
    ]);
    if(leads.error||commissions.error){say($('partnerLeadStatus'),'डेटा लोड नहीं हुआ: '+(leads.error?.message||commissions.error?.message),true);return;}
    const L=leads.data||[],C=commissions.data||[];$('myLeadCount').textContent=L.length;$('myCommissionCount').textContent=C.length;
    $('myPending').textContent=money(C.filter(x=>['pending','approved','on_hold'].includes(x.status)).reduce((s,x)=>s+Number(x.commission_amount||0),0));
    $('myPaid').textContent=money(C.filter(x=>x.status==='paid').reduce((s,x)=>s+Number(x.commission_amount||0),0));
    $('partnerLeadList').innerHTML=L.map(x=>'<div class="partner-item"><b>'+safe(x.customer_name)+'</b><div class="partner-muted">'+safe(x.phone)+' · '+safe(x.project_name||'Project pending')+' · '+safe(x.status)+' · '+new Date(x.created_at).toLocaleDateString('en-IN')+'</div><div>'+safe(x.requirement||'')+'</div></div>').join('')||'<p class="partner-muted">अभी कोई Lead Submit नहीं की गई है।</p>';
    $('partnerCommissionList').innerHTML=C.map(x=>'<div class="partner-item"><b>'+money(x.commission_amount)+' · '+safe(x.status)+'</b><div class="partner-muted">Booking Value: '+money(x.gross_amount)+' · Commission: '+Number(x.commission_percent||0)+'% · Due: '+safe(x.due_date||'—')+' · Paid: '+safe(x.paid_at||'—')+'</div></div>').join('')||'<p class="partner-muted">अभी कोई Commission Entry उपलब्ध नहीं है।</p>';
  }
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  $('partnerLeadForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!partner)return;const b=$('partnerLeadBtn');b.disabled=true;b.textContent='Submit हो रहा है…';
    const payload={partner_id:partner.id,customer_name:$('customerName').value.trim(),phone:$('customerPhone').value.trim(),project_name:$('customerProject').value,requirement:$('customerRequirement').value.trim()||null,budget:$('customerBudget').value?Number($('customerBudget').value):null,status:'new'};
    const {error}=await client.from('partner_leads').insert(payload);
    if(error)say($('partnerLeadStatus'),'Lead Submit नहीं हुई: '+error.message,true);else{$('partnerLeadForm').reset();say($('partnerLeadStatus'),'Lead सफलतापूर्वक Submit हो गई।');await loadPartnerData();}
    b.disabled=false;b.textContent='Lead Submit करें';
  });
  $('partnerForgot').addEventListener('click',async()=>{const email=$('partnerEmail').value.trim().toLowerCase();if(!email){say(status,'पहले Login Email भरें।',true);return;}const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});say(status,error?'Reset Email नहीं भेजा गया: '+error.message:'यदि Email Registered है तो Password Reset Link भेज दिया गया है।',!!error);});
  $('partnerChangePassword').onclick=()=>$('partnerPasswordBox').classList.toggle('partner-hidden');
  $('partnerPasswordForm').addEventListener('submit',async e=>{e.preventDefault();const p=$('partnerNewPassword').value,q=$('partnerConfirmPassword').value;if(p.length<8||p!==q){say($('partnerPasswordStatus'),'Password कम-से-कम 8 अक्षर का हो और दोनों एक जैसे हों।',true);return;}const {error}=await client.auth.updateUser({password:p});say($('partnerPasswordStatus'),error?'Password नहीं बदला: '+error.message:'Password सफलतापूर्वक बदल गया।',!!error);if(!error)$('partnerPasswordForm').reset();});
  $('partnerLogout').onclick=async()=>{await client.auth.signOut();partner=null;dash.classList.add('partner-hidden');authBox.classList.remove('partner-hidden');say(status,'आप Logout हो गए हैं।');};
  client.auth.getSession().then(({data})=>{if(data.session)openPartner(data.session.user);});
})();