(() => {
  const cfg = window.SR_SUPABASE_CONFIG || {};
  const login = document.getElementById('authGate');
  const appHeader = document.querySelector('header');
  const appMain = document.querySelector('main');
  const footer = document.querySelector('footer');
  const status = document.getElementById('authStatus');
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginButton');
  const signOut = document.getElementById('signOut');
  const setState = (message, error=false) => { status.textContent=message; status.classList.toggle('error',error); };
  const showApp = (user, profile) => {
    login.hidden=true; appHeader.hidden=false; appMain.hidden=false; if(footer)footer.hidden=false;
    document.getElementById('sessionUser').textContent=(profile.full_name||user.email)+' · '+profile.role;
    document.querySelectorAll('.admin-only').forEach(el=>el.hidden=profile.role!=='admin');
    signOut.hidden=false;
    if(profile.role==='admin') initStaffAdmin();
  };
  const showGate = () => { login.hidden=false; appHeader.hidden=true; appMain.hidden=true; if(footer)footer.hidden=true; signOut.hidden=true; };
  showGate();
  if (!cfg.url || !cfg.publishableKey || !window.supabase) {
    setState('Supabase configuration missing. Admin से संपर्क करें।',true); return;
  }
  const client=window.supabase.createClient(cfg.url,cfg.publishableKey);
  window.srSupabase=client;
  async function verifySession(session){
    if(!session){showGate();return}
    const {data,error}=await client.from('profiles').select('full_name,role,is_active').eq('id',session.user.id).maybeSingle();
    if(error || !data || !data.is_active){await client.auth.signOut();showGate();setState('इस User की सक्रिय कर्मचारी Profile नहीं मिली। Admin से संपर्क करें।',true);return}
    try { const sync=await window.srCloudInit(client,session.user,data); showApp(session.user,data); setState('Cloud sync जुड़ा है · '+sync.loaded+' रिकॉर्ड लोड · '+sync.uploaded+' अपलोड'); } catch(syncError) { showGate(); setState('Cloud Sync शुरू नहीं हुआ: '+syncError.message+' — Admin से संपर्क करें।',true); }
  }

  const signupForm=document.getElementById('signupForm');
  signupForm.addEventListener('submit',async e=>{
    e.preventDefault();const b=document.getElementById('signupButton');b.disabled=true;b.textContent='Request भेजी जा रही है…';
    const {error}=await client.from('staff_signup_requests').insert({
      full_name:document.getElementById('signupName').value.trim(),
      email:document.getElementById('signupEmail').value.trim().toLowerCase(),
      phone:document.getElementById('signupPhone').value.trim()||null,
      requested_role:document.getElementById('signupRole').value,
      message:document.getElementById('signupMessage').value.trim()||null,
      status:'pending'
    });
    if(error)setState('Request नहीं भेजी गई: '+error.message,true);
    else {signupForm.reset();setState('आपकी Request Admin को भेज दी गई है। मंजूरी के बाद Login ID मिलेगी।');}
    b.disabled=false;b.textContent='नई ID के लिए Request भेजें';
  });
  async function initStaffAdmin(){
    const manager=document.getElementById('accountManager');
    const {data}=await client.from('profiles').select('id,full_name').eq('role','manager').eq('is_active',true).order('full_name');
    manager.innerHTML='<option value="">कोई नहीं / लागू नहीं</option>'+(data||[]).map(x=>'<option value="'+x.id+'">'+x.full_name.replace(/[&<>"]/g,'')+'</option>').join('');
    await loadSignupRequests();
  }
  async function loadSignupRequests(){
    const target=document.getElementById('signupRequestList');if(!target)return;
    const {data,error}=await client.from('staff_signup_requests').select('*').eq('status','pending').order('created_at',{ascending:false});
    if(error){target.textContent='Requests नहीं खुलीं: '+error.message;return}
    target.innerHTML=(data||[]).map(x=>'<div class="item"><b>'+x.full_name.replace(/[&<>"]/g,'')+'</b><small>'+x.email+' · '+(x.phone||'मोबाइल नहीं')+' · '+x.requested_role+'</small><p>'+((x.message||'').replace(/[&<>"]/g,''))+'</p><button class="tiny" data-approve="'+x.id+'">Approve करके ID बनाएं</button></div>').join('')||'<p class="muted">कोई Pending Request नहीं।</p>';
    target.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveSignup(b.dataset.approve));
  }
  async function createStaff(payload){
    const {data,error}=await client.functions.invoke('create-staff-login',{body:payload});
    if(error)throw new Error(error.message);
    if(data?.error)throw new Error(data.error);
    return data;
  }
  function showCreatedAccount(data){
    const target=document.getElementById('staffAccountResult');
    target.innerHTML='<div class="credential-box"><b>Login ID बन गई</b><p>Name: '+data.fullName+'</p><p>Email: '+data.email+'</p><p>Role: '+data.role+'</p><p>Temporary Password: <strong>'+data.temporaryPassword+'</strong></p><button type="button" id="copyStaffCredentials" class="tiny secondary">Credentials Copy करें</button><p>यह Password कर्मचारी को सुरक्षित तरीके से दें और पहली Login के बाद बदलवाएँ।</p></div>';
    document.getElementById('copyStaffCredentials').onclick=()=>navigator.clipboard?.writeText('Email: '+data.email+'\nTemporary Password: '+data.temporaryPassword);
  }
  document.getElementById('createStaffAccountForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.submitter;b.disabled=true;
    try{const data=await createStaff({fullName:document.getElementById('accountName').value.trim(),email:document.getElementById('accountEmail').value.trim(),phone:document.getElementById('accountPhone').value.trim(),role:document.getElementById('accountRole').value,managerId:document.getElementById('accountManager').value||null});showCreatedAccount(data);e.target.reset();}
    catch(err){document.getElementById('staffAccountResult').textContent='ID नहीं बनी: '+err.message;}
    b.disabled=false;
  });
  async function approveSignup(requestId){
    const {data:requests}=await client.from('staff_signup_requests').select('*').eq('id',requestId).maybeSingle();if(!requests)return;
    try{const data=await createStaff({requestId,fullName:requests.full_name,email:requests.email,phone:requests.phone,role:requests.requested_role});showCreatedAccount(data);await loadSignupRequests();}
    catch(err){setState('Approval failed: '+err.message,true);}
  }
  document.getElementById('refreshSignupRequests').addEventListener('click',loadSignupRequests);
\n  client.auth.onAuthStateChange((_event,session)=>{ if(session) setTimeout(()=>verifySession(session),0); else showGate(); });
  client.auth.getSession().then(({data})=>verifySession(data.session));
  form.addEventListener('submit',async e=>{
    e.preventDefault(); btn.disabled=true; btn.textContent='लॉगिन हो रहा है…'; setState('आपकी जानकारी जाँची जा रही है।');
    const email=document.getElementById('loginEmail').value.trim();
    const password=document.getElementById('loginPassword').value;
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){setState('Login नहीं हुआ: '+error.message,true);btn.disabled=false;btn.textContent='Login करें';return}
    await verifySession(data.session); btn.disabled=false; btn.textContent='Login करें';
  });
  signOut.addEventListener('click',async()=>{await client.auth.signOut();setState('आप Logout हो गए हैं।')});
})();