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
    ensurePasswordPanel();
    // Team profiles are loaded after cloud sync in verifySession.
  };
  const showGate = () => { window.srCurrentProfile=null; login.hidden=false; appHeader.hidden=true; appMain.hidden=true; if(footer)footer.hidden=true; signOut.hidden=true; window.dispatchEvent(new CustomEvent('sr-auth-logout')); };
  showGate();
  if (!cfg.url || !cfg.publishableKey || !window.supabase) {
    setState('Supabase configuration missing. Admin से संपर्क करें।',true); return;
  }
  const client=window.supabase.createClient(cfg.url,cfg.publishableKey);

  // Forgot-password flow: send a Supabase recovery link to the entered email.
  const forgotButton=document.createElement('button');
  forgotButton.type='button';
  forgotButton.id='forgotPasswordButton';
  forgotButton.className='tiny secondary';
  forgotButton.textContent='Password भूल गए?';
  const loginForm=document.getElementById('loginForm');
  const loginSubmit=document.getElementById('loginButton');
  if(loginForm && loginSubmit) loginSubmit.insertAdjacentElement('afterend',forgotButton);
  forgotButton.addEventListener('click',async()=>{
    const email=document.getElementById('loginEmail').value.trim().toLowerCase();
    if(!email || /^SRD[0-9]{4,}$/i.test(email)){setState('Password Reset के लिए अपना Registered Email भरें।',true);document.getElementById('loginEmail').focus();return;}
    // Validate the address before contacting Supabase to avoid malformed recovery requests.
    const emailPattern=/^[^\s@]+@[^\s@]+\\.[^\s@]{2,}$/;
    if(!emailPattern.test(email)){setState('ईमेल पता सही फॉर्मेट में लिखें, जैसे name@example.com।',true);document.getElementById('loginEmail').focus();return;}
    forgotButton.disabled=true;forgotButton.textContent='लिंक भेजा जा रहा है…';
    try{
      const redirectTo='https://srdeveloperstf2-sketch.github.io/SR-DEVELOPERS-/';
      const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
      if(error) throw error;
      setState('यदि यह Email अकाउंट में Registered है, तो Password Reset लिंक भेज दिया गया है। Inbox और Spam फ़ोल्डर देखें।');
    }catch(err){
      const detail=err?.message||String(err);
      const lower=detail.toLowerCase();
      let message='Reset लिंक नहीं भेजा गया: '+detail;
      if(lower.includes('error sending recovery email')||lower.includes('smtp')||lower.includes('email provider')){
        message='Supabase ईमेल सेवा अभी Reset ईमेल नहीं भेज पा रही है। Admin को Supabase → Logs → Auth में ताज़ा Error जाँचना होगा। यदि 535 Username and Password not accepted दिखे, तो SMTP Username और Google App Password ठीक करें।';
      }else if(lower.includes('rate limit')||lower.includes('too many requests')){
        message='ईमेल भेजने की सीमा पूरी हो गई है। अभी दोबारा प्रयास न करें; Admin को Supabase Auth की Email Rate Limits जाँचनी होंगी।';
      }
      setState(message,true);
    }
    finally{forgotButton.disabled=false;forgotButton.textContent='Password भूल गए?';}
  });
  window.srSupabase=client;
  // Handle Supabase PASSWORD_RECOVERY callback without requiring a staff profile first.
  const recoveryBox=document.createElement('section');
  recoveryBox.id='passwordRecoveryBox';
  recoveryBox.className='panel';
  recoveryBox.hidden=true;
  recoveryBox.innerHTML='<h3>नया Password सेट करें</h3><form id="passwordRecoveryForm"><label>नया Password (कम-से-कम 8 अक्षर)<input id="recoveryPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>नया Password दोबारा लिखें<input id="recoveryPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required></label><p id="recoveryStatus" role="status"></p><button class="wide" id="recoverySave" type="submit">नया Password सुरक्षित करें</button></form>';
  const authCard=document.querySelector('.auth-card');
  if(authCard) authCard.insertBefore(recoveryBox,authCard.firstChild);
  recoveryBox.querySelector('#passwordRecoveryForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const p=document.getElementById('recoveryPassword').value;
    const q=document.getElementById('recoveryPasswordConfirm').value;
    const out=document.getElementById('recoveryStatus');
    const save=document.getElementById('recoverySave');
    if(p.length<8){out.textContent='Password कम-से-कम 8 अक्षर का रखें।';return;}
    if(p!==q){out.textContent='दोनों Password एक जैसे नहीं हैं।';return;}
    save.disabled=true;save.textContent='सुरक्षित हो रहा है…';
    try{
      const {error}=await client.auth.updateUser({password:p});
      if(error) throw error;
      out.textContent='Password सफलतापूर्वक बदल गया। अब Login करें।';
      recoveryBox.hidden=true;
      const lf=document.getElementById('loginForm'); if(lf) lf.hidden=false;
      const reg=document.getElementById('employeeReg'); if(reg) reg.hidden=false;
      const divider=document.querySelector('.auth-divider'); if(divider) divider.hidden=false;
      await client.auth.signOut();
      setState('Password बदल गया। नए Password से Login करें।');
      history.replaceState({},document.title,window.location.pathname);
    }catch(err){out.textContent='Password नहीं बदला: '+(err?.message||String(err));}
    finally{save.disabled=false;save.textContent='नया Password सुरक्षित करें';}
  });
  let passwordRecoveryMode=false;
  client.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      passwordRecoveryMode=true;
      showGate();
      recoveryBox.hidden=false;
      const lf=document.getElementById('loginForm'); if(lf) lf.hidden=true;
      const reg=document.getElementById('employeeReg'); if(reg) reg.hidden=true;
      const divider=document.querySelector('.auth-divider'); if(divider) divider.hidden=true;
      setState('ईमेल सत्यापित हो गया। अब नया Password सेट करें।');
    }else if(session){setTimeout(()=>verifySession(session),0);}
    else if(event==='SIGNED_OUT'){showGate();}
  });

  // Self-service password change for every authenticated staff member.
  let passwordPanel;
  function ensurePasswordPanel(){
    if(passwordPanel) return passwordPanel;
    const tools=document.querySelector('.session-tools');
    if(!tools) return null;
    const open=document.createElement('button');
    open.type='button'; open.className='tiny secondary'; open.textContent='Password बदलें';
    open.id='changePasswordOpen';
    passwordPanel=document.createElement('section');
    passwordPanel.id='changePasswordPanel';
    passwordPanel.className='panel';
    passwordPanel.hidden=true;
    passwordPanel.innerHTML='<h3>अपना Password बदलें</h3><form id="changePasswordForm"><label>वर्तमान Password<input id="currentPassword" type="password" autocomplete="current-password" required></label><label>नया Password (कम-से-कम 8 अक्षर)<input id="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>नया Password दोबारा लिखें<input id="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label><p id="passwordChangeStatus" role="status"></p><button class="wide" type="submit" id="saveNewPassword">Password सुरक्षित करें</button></form>';
    tools.insertBefore(open, signOut);
    appHeader.insertAdjacentElement('afterend',passwordPanel);
    open.addEventListener('click',()=>{passwordPanel.hidden=!passwordPanel.hidden;});
    passwordPanel.querySelector('#changePasswordForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const current=document.getElementById('currentPassword').value;
      const next=document.getElementById('newPassword').value;
      const confirm=document.getElementById('confirmPassword').value;
      const out=document.getElementById('passwordChangeStatus');
      const save=document.getElementById('saveNewPassword');
      if(next.length<8){out.textContent='नया Password कम-से-कम 8 अक्षर का रखें।';return;}
      if(next!==confirm){out.textContent='दोनों नए Password एक जैसे नहीं हैं।';return;}
      if(next===current){out.textContent='नया Password वर्तमान Password से अलग रखें।';return;}
      save.disabled=true; save.textContent='बदल रहा है…'; out.textContent='वर्तमान Password जाँचा जा रहा है…';
      try{
        const {data:ud,error:ue}=await client.auth.getUser();
        if(ue||!ud?.user?.email) throw new Error('Login session verify नहीं हुआ। दोबारा Login करें।');
        const {error:reauthError}=await client.auth.signInWithPassword({email:ud.user.email,password:current});
        if(reauthError) throw new Error('वर्तमान Password सही नहीं है।');
        const {error:updateError}=await client.auth.updateUser({password:next});
        if(updateError) throw updateError;
        passwordPanel.querySelector('#changePasswordForm').reset();
        out.textContent='Password सफलतापूर्वक बदल गया। अगली बार नए Password से Login करें।';
      }catch(err){out.textContent='Password नहीं बदला: '+(err?.message||String(err));}
      finally{save.disabled=false;save.textContent='Password सुरक्षित करें';}
    });
    return passwordPanel;
  }
  let verificationInFlight=null;
  async function verifySession(session){
    if(!session){showGate();return}
    if(verificationInFlight) return verificationInFlight;
    verificationInFlight=(async()=>{
    const {data,error}=await client.from('profiles').select('full_name,role,is_active,employee_code').eq('id',session.user.id).maybeSingle();
    if(error || !data || !data.is_active){await client.auth.signOut();showGate();setState('इस User की सक्रिय कर्मचारी Profile नहीं मिली। Admin से संपर्क करें।',true);return}
    try {
      if(typeof window.srCloudInit!=='function') throw new Error('Cloud sync module लोड नहीं हुआ। पेज refresh करें।');
      const sync=await window.srCloudInit(client,session.user,data);
      window.srCurrentProfile={id:session.user.id,email:session.user.email,...data};
      showApp(session.user,data);
      await loadVisibleTeamProfiles();
      if(data.role==='admin') await initStaffAdmin();
      setState('Cloud sync जुड़ा है · '+sync.loaded+' रिकॉर्ड लोड · '+sync.uploaded+' अपलोड');
      window.dispatchEvent(new CustomEvent('sr-auth-ready',{detail:window.srCurrentProfile}));
    } catch(syncError) {
      showGate();
      setState('Cloud Sync शुरू नहीं हुआ: '+(syncError?.message||String(syncError))+' — Admin से संपर्क करें।',true);
    }
    })();
    try { return await verificationInFlight; }
    finally { verificationInFlight=null; }
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
  async function loadVisibleTeamProfiles(){
    const {data,error}=await client.from('profiles').select('id,employee_code,full_name,role,phone,manager_id,is_active').eq('is_active',true).order('full_name');
    if(error){console.warn('Team directory profile load:',error.message);return;}
    window.srVisibleProfiles=data||[];
    window.srSetProfiles?.(window.srVisibleProfiles);
  }
  async function initStaffAdmin(){
    const {data,error}=await client.from('profiles').select('id,employee_code,full_name,role,phone,manager_id,is_active').eq('is_active',true).order('full_name');
    if(error) console.warn('Could not load staff profiles:',error.message);
    window.srVisibleProfiles=data||[];
    window.srActiveManagers=(data||[]).filter(p=>['manager','team_leader'].includes(p.role));
    window.srSetProfiles?.(window.srVisibleProfiles);
    refreshDirectStaffManagers();
    await loadSignupRequests();
  }
  async function loadSignupRequests(){
    const target=document.getElementById('signupRequestList');if(!target)return;
    const {data,error}=await client.from('staff_signup_requests').select('*').eq('status','pending').order('created_at',{ascending:false});
    if(error){target.textContent='Requests नहीं खुलीं: '+error.message;return}
    const managers=window.srActiveManagers||[];
    target.innerHTML=(data||[]).map(x=>'<div class="item"><b>'+x.full_name.replace(/[&<>"]/g,'')+'</b><small>'+x.email+' · '+(x.phone||'मोबाइल नहीं')+' · Requested: '+x.requested_role+'</small><p>'+((x.message||'').replace(/[&<>"]/g,''))+'</p><label>Admin द्वारा स्वीकृत पद<select data-role="'+x.id+'"><option value="sales_executive">Sales Executive</option><option value="team_leader">Team Leader</option><option value="manager">Manager</option></select></label><label>Reporting Manager<select data-manager="'+x.id+'"><option value="">कोई नहीं</option>'+managers.map(m=>'<option value="'+m.id+'" data-supervisor-role="'+m.role+'">'+m.full_name.replace(/[&<>"]/g,'')+' · '+(m.role==='manager'?'Manager':'Team Leader')+'</option>').join('')+'</select></label><button class="tiny" data-approve="'+x.id+'">Approve करके ID बनाएं</button><button class="tiny secondary" data-reject="'+x.id+'">Reject</button></div>').join('')||'<p class="muted">कोई Pending Request नहीं।</p>';
    target.querySelectorAll('[data-role]').forEach(roleSelect=>{
      const requestId=roleSelect.dataset.role;
      const managerSelect=target.querySelector('[data-manager="'+requestId+'"]');
      const filterSupervisors=()=>{
        if(!managerSelect)return;
        const role=roleSelect.value;
        Array.from(managerSelect.options).forEach((opt,i)=>{
          if(i===0){opt.hidden=false;return;}
          const supervisorRole=opt.dataset.supervisorRole;
          opt.hidden=role==='manager'||(role==='team_leader'&&supervisorRole!=='manager');
        });
        if(managerSelect.selectedOptions[0]?.hidden)managerSelect.value='';
        managerSelect.disabled=role==='manager';
      };
      roleSelect.addEventListener('change',filterSupervisors);
      filterSupervisors();
    });
    target.querySelectorAll('[data-approve]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();approveSignup(b.dataset.approve,b);}));
    target.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rejectSignup(b.dataset.reject));
  }
  async function createStaff(payload){
    // Always attach a fresh, verified Admin access token explicitly.
    let {data:sessionData,error:sessionError}=await client.auth.getSession();
    let session=sessionData?.session||null;
    if(sessionError) console.warn('Could not read current auth session:',sessionError.message);
    if(!session?.access_token || (session.expires_at && session.expires_at*1000 < Date.now()+60000)){
      const refreshed=await client.auth.refreshSession();
      if(refreshed.error) throw new Error('Admin login session समाप्त हो गया है। Logout करके दोबारा Admin Login करें।');
      session=refreshed.data?.session||null;
    }
    if(!session?.access_token) throw new Error('Valid Admin login session नहीं मिला। Logout करके दोबारा Login करें।');
    const {data:currentUser,error:userError}=await client.auth.getUser(session.access_token);
    if(userError || !currentUser?.user) throw new Error('Admin login verify नहीं हुआ। Logout करके दोबारा Login करें।');
    const {data,error}=await client.functions.invoke('create-staff-login',{
      body:payload,
      headers:{Authorization:'Bearer '+session.access_token}
    });
    if(error){
      let detail=error.message||'Function request failed';
      try{
        const response=error.context;
        if(response && typeof response.json==='function'){
          const body=await response.clone().json();
          detail=body?.detail
            ? (body.error||detail)+': '+body.detail+(body.code?' ('+body.code+')':'')
            : (body?.error||body?.message||detail);
        }
      }catch(_){}
      throw new Error(detail);
    }
    if(data?.error)throw new Error(data.detail ? data.error+': '+data.detail : data.error);
    return data;
  }
  function validateCreatedAccount(data){
    if(!data || typeof data!=='object') throw new Error('Server से Login ID का सही जवाब नहीं मिला। Supabase में create-staff-login Function को latest code से redeploy करें।');
    if(!/^SRD[0-9]{4,}$/.test(String(data.employeeCode||''))) throw new Error('Employee ID सही नहीं बनी। Expected format SRD0001. Supabase में employee_identity_migration.sql चलाएँ और create-staff-login Function redeploy करें।');
    if(!/^\d{6}$/.test(String(data.temporaryPassword||''))) throw new Error('Server ने 6 अंकों का Password नहीं दिया। Supabase में create-staff-login Function को latest code से redeploy करें।');
    if(!data.fullName || !data.email) throw new Error('Staff का नाम या Email Server response में नहीं मिला। Pending Request का विवरण जाँचें।');
    return data;
  }
  function showCreatedAccount(data){
    validateCreatedAccount(data);
    const target=document.getElementById('staffAccountResult');
    const safe=value=>String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    target.innerHTML='<div class="credential-box"><b>Login ID बन गई</b><p>Name: '+safe(data.fullName)+'</p><p>Employee ID: <strong>'+safe(data.employeeCode)+'</strong></p><p>Mobile: '+safe(data.phone||'रिकॉर्ड नहीं')+'</p><p>Email: '+safe(data.email)+'</p><p>Role: '+safe(data.role)+'</p><p>Temporary Password: <strong>'+safe(data.temporaryPassword)+'</strong></p><button type="button" id="copyStaffCredentials" class="tiny secondary">Credentials Copy करें</button><p>पासवर्ड ठीक 6 अंकों का है। इसे कर्मचारी को निजी रूप से दें।</p></div>';
    document.getElementById('copyStaffCredentials').onclick=()=>navigator.clipboard?.writeText('Employee ID: '+data.employeeCode+'\nEmail: '+data.email+'\nMobile: '+(data.phone||'')+'\nTemporary Password: '+data.temporaryPassword);
  }
  async function approveSignup(requestId, button){
    const result=document.getElementById('staffAccountResult');
    if(button){button.disabled=true;button.textContent='Approval हो रहा है…';}
    if(result) result.textContent='Request जाँची जा रही है…';
    try{
      const {data:requests,error:requestReadError}=await client.from('staff_signup_requests').select('*').eq('id',requestId).maybeSingle();
      if(requestReadError) throw new Error('Request पढ़ने में समस्या: '+requestReadError.message);
      if(!requests) throw new Error('यह Pending Request नहीं मिली। Requests Refresh करें।');
      const roleEl=document.querySelector('[data-role="'+requestId+'"]');
      const managerEl=document.querySelector('[data-manager="'+requestId+'"]');
      if(!roleEl||!managerEl) throw new Error('Role या Reporting Manager का चयन नहीं मिला। Requests Refresh करें।');
      const role=roleEl.value;
      const managerId=managerEl.value||null;
      const data=await createStaff({requestId,fullName:requests.full_name,email:requests.email,phone:requests.phone,role,managerId});
      showCreatedAccount(data);
      await loadVisibleTeamProfiles();
      await loadSignupRequests();
    }catch(err){
      const message='Approval failed: '+(err?.message||String(err));
      setState(message,true);
      if(result) result.textContent=message;
    }finally{
      if(button){button.disabled=false;button.textContent='Approve करके ID बनाएं';}
    }
  }
  async function rejectSignup(requestId){const {data:authData}=await client.auth.getUser();const {error}=await client.from('staff_signup_requests').update({status:'rejected',reviewed_by:authData.user.id,reviewed_at:new Date().toISOString()}).eq('id',requestId).eq('status','pending');if(error)setState('Reject नहीं हुआ: '+error.message,true);else await loadSignupRequests();}
  document.getElementById('refreshSignupRequests').addEventListener('click',loadSignupRequests);
  // Admin-created staff accounts use the same approved-request workflow and server-side provisioning.
  const directStaffForm=document.getElementById('directStaffForm');
  const directStaffRole=document.getElementById('directStaffRole');
  const directStaffManager=document.getElementById('directStaffManager');
  const directStaffManagerWrap=document.getElementById('directStaffManagerWrap');
  function refreshDirectStaffManagers(){
    if(!directStaffManager||!directStaffRole)return;
    const role=directStaffRole.value;
    const managers=window.srActiveManagers||[];
    directStaffManager.innerHTML='<option value="">Reporting Manager चुनें</option>'+managers
      .filter(m=>m.is_active&&(role==='team_leader'?m.role==='manager':['manager','team_leader'].includes(m.role)))
      .map(m=>'<option value="'+m.id+'">'+m.full_name.replace(/[&<>"]/g,'')+' · '+(m.role==='manager'?'Manager':'Team Leader')+'</option>').join('');
    directStaffManager.disabled=role==='manager';
    directStaffManagerWrap.hidden=role==='manager';
  }
  if(directStaffRole)directStaffRole.addEventListener('change',refreshDirectStaffManagers);
  if(directStaffForm)directStaffForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const button=document.getElementById('directStaffCreate');
    const name=document.getElementById('directStaffName').value.trim();
    const email=document.getElementById('directStaffEmail').value.trim().toLowerCase();
    const phone=document.getElementById('directStaffPhone').value.trim();
    const role=directStaffRole.value;
    const managerId=role==='manager'?null:(directStaffManager.value||null);
    if(name.length<2||!email){setState('कर्मचारी का नाम और सही Email भरें।',true);return;}
    if(role!=='manager'&&!managerId){setState('इस Role के लिए Reporting Manager चुनना जरूरी है।',true);return;}
    button.disabled=true;button.textContent='Login ID बनाई जा रही है…';
    try{
      const {data:request,error:requestError}=await client.from('staff_signup_requests').insert({
        full_name:name,email,phone:phone||null,requested_role:role,
        message:'Admin द्वारा सीधे बनाया गया Staff Login',status:'pending'
      }).select('id').single();
      if(requestError)throw new Error('Staff request सेव नहीं हुई: '+requestError.message);
      const created=await createStaff({requestId:request.id,role,managerId});
      showCreatedAccount(created);
      directStaffForm.reset();refreshDirectStaffManagers();
      await initStaffAdmin();
      setState('कर्मचारी की Login ID सफलतापूर्वक बनाई गई। Temporary Password अभी सुरक्षित कर लें।');
    }catch(err){
      const message='Login ID नहीं बनी: '+(err?.message||String(err));
      setState(message,true);
      const result=document.getElementById('staffAccountResult');
      if(result)result.textContent=message+' यदि Pending Request बनी है, तो Requests Refresh करके उसे approve किया जा सकता है।';
    }finally{button.disabled=false;button.textContent='Login ID बनाएँ';}
  });


  client.auth.getSession().then(({data})=>{if(!passwordRecoveryMode) verifySession(data.session);});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    btn.disabled=true; btn.textContent='लॉगिन हो रहा है…'; setState('आपकी जानकारी जाँची जा रही है।');
    const identifier=document.getElementById('loginEmail').value.trim();
    const password=document.getElementById('loginPassword').value;
    try{
      const isEmployeeCode=/^SRD[0-9]{4,}$/i.test(identifier);
      const mobileDigits=identifier.replace(/\D/g,'');
      const isMobile=(mobileDigits.length===10 && /^[6-9][0-9]{9}$/.test(mobileDigits)) ||
        (mobileDigits.length===12 && /^91[6-9][0-9]{9}$/.test(mobileDigits));
      if(isEmployeeCode||isMobile){
        if(!password) throw new Error('6 अंकों का Password लिखें।');
        const {data,error}=await client.functions.invoke('login-with-employee-code',{body:{identifier,password}});
        if(error) throw new Error(error.message||'Employee ID / Mobile Login सेवा उपलब्ध नहीं है।');
        if(data?.error) throw new Error(data.error);
        if(!data?.access_token||!data?.refresh_token) throw new Error('Login Session प्राप्त नहीं हुआ।');
        const {data:sessionData,error:sessionError}=await client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
        if(sessionError) throw sessionError;
        await verifySession(sessionData.session);
      }else{
        if(!identifier||!password) throw new Error('Registered Email और Password दोनों भरें।');
        const {data,error}=await client.auth.signInWithPassword({email:identifier,password});
        if(error) throw error;
        await verifySession(data.session);
      }
    }catch(err){setState('Login नहीं हुआ: '+(err?.message||String(err)),true);}
    finally{btn.disabled=false;btn.textContent='Login करें';}
  });

  signOut.addEventListener('click',async()=>{await client.auth.signOut();setState('आप Logout हो गए हैं।')});
})();