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
    signOut.hidden=false;
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
  client.auth.onAuthStateChange((_event,session)=>{ if(session) setTimeout(()=>verifySession(session),0); else showGate(); });
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