(() => {
  const $ = id => document.getElementById(id);
  const panel = $('partnerAdminPanel');
  if (!panel) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let client=null, me=null, rows=[];
  const say=(message,error=false)=>{const el=$('partnerAdminStatus');if(el){el.textContent=message;el.classList.toggle('error',error);}};
  async function refresh(){
    if(!client||me?.role!=='admin')return;
    say('Partner Requests लोड हो रही हैं…');
    const {data,error}=await client.from('partner_signup_requests').select('*').order('created_at',{ascending:false}).limit(200);
    if(error){say('Requests नहीं खुलीं: '+error.message,true);return;}
    rows=data||[];
    $('partnerSignupList').innerHTML=rows.map(r=>{
      const actions=r.status==='pending'
        ? '<div class="sc-row-actions"><button type="button" class="tiny" data-partner-approve="'+r.id+'">Approve + Login बनाएं</button><button type="button" class="tiny danger" data-partner-reject="'+r.id+'">Reject</button></div>'
        : '<small>Reviewed: '+esc(r.status)+' · '+esc(r.reviewed_at||'—')+'</small>';
      return '<article class="sc-person"><div class="sc-person-main"><div class="sc-person-head"><b>'+esc(r.full_name)+'</b><span class="sc-chip '+(r.status==='pending'?'pending':r.status==='approved'?'good':'off')+'">'+esc(r.status)+'</span></div><small>'+esc(r.email)+' · '+esc(r.phone||'Phone not given')+'</small><small>'+esc(r.partner_type)+' · '+esc(r.firm_name||'Individual')+' · '+esc(r.area||'Area not given')+'</small><small>Project: '+esc(r.project_interest||'Not specified')+'</small><p>'+esc(r.message||'')+'</p>'+actions+'</div></article>';
    }).join('')||'<p class="muted">अभी कोई Partner Request नहीं है।</p>';
    $('partnerSignupList').querySelectorAll('[data-partner-approve]').forEach(b=>b.onclick=()=>approve(b.dataset.partnerApprove,b));
    $('partnerSignupList').querySelectorAll('[data-partner-reject]').forEach(b=>b.onclick=()=>reject(b.dataset.partnerReject,b));
    say(rows.filter(x=>x.status==='pending').length+' Pending Request · कुल '+rows.length);
  }
  async function approve(id,button){
    const r=rows.find(x=>x.id===id&&x.status==='pending');if(!r)return;
    if(!confirm(r.full_name+' के लिए Partner Login बनाना चाहते हैं?'))return;
    button.disabled=true;say('Partner Profile और Login बनाया जा रहा है…');
    const code='SRCP-'+crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase();
    const {data:partner,error:insertError}=await client.from('channel_partners').insert({
      partner_code:code,full_name:r.full_name,phone:r.phone||null,firm_name:r.firm_name||null,
      partner_type:r.partner_type||'Individual Broker',project_scope:r.project_interest?[r.project_interest]:[],
      area:r.area||null,status:'pending',created_by:me.id
    }).select('id').single();
    if(insertError){button.disabled=false;say('Partner Profile नहीं बनी: '+insertError.message,true);return;}
    const {data:loginData,error:loginError}=await client.functions.invoke('create-partner-login',{body:{partnerId:partner.id,email:r.email}});
    if(loginError||loginData?.error){
      await client.from('channel_partners').delete().eq('id',partner.id);
      button.disabled=false;say('Login नहीं बना: '+(loginData?.error||loginError?.message||'Unknown error')+'. Edge Function deploy और server secret जाँचें।',true);return;
    }
    const {error:updateError}=await client.from('partner_signup_requests').update({status:'approved',reviewed_by:me.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending');
    if(updateError){
      say('Login बन गया लेकिन Request status update नहीं हुआ। Partner Code '+code+'; Supabase में manually reconcile करें।',true);
      $('partnerAdminCredentials').textContent='Partner Code: '+loginData.partnerCode+' | Email: '+loginData.email+' | Temporary Password: '+loginData.temporaryPassword;
      button.disabled=false;await refresh();return;
    }
    $('partnerAdminCredentials').textContent='Partner Code: '+loginData.partnerCode+' | Email: '+loginData.email+' | Temporary Password: '+loginData.temporaryPassword+' — इसे सुरक्षित तरीके से Partner को दें; यह दोबारा नहीं दिखेगा।';
    say('Partner Login बन गया। Temporary Password सुरक्षित रूप से साझा करें।');
    button.disabled=false;await refresh();
  }
  async function reject(id,button){
    if(!confirm('इस Partner Request को Reject करना चाहते हैं?'))return;
    button.disabled=true;
    const {error}=await client.from('partner_signup_requests').update({status:'rejected',reviewed_by:me.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending');
    button.disabled=false;if(error){say('Request Reject नहीं हुई: '+error.message,true);return;}say('Request Reject कर दी गई।');await refresh();
  }
  function boot(){
    client=window.srSupabase;me=window.srCurrentProfile;
    if(!client||!me)return;
    panel.hidden=me.role!=='admin';
    if(me.role==='admin')refresh();
  }
  $('refreshPartnerRequests').onclick=refresh;
  window.addEventListener('sr-auth-ready',boot);
  window.addEventListener('sr-auth-logout',()=>{me=null;rows=[];panel.hidden=true;});
  if(window.srCurrentProfile)setTimeout(boot,0);
})();
