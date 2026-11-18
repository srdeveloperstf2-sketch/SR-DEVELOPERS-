(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let client=null, channel=null, currentId=null, timer=null, busy=false;
  const style = document.createElement('style');
  style.textContent = `
    #srAdminBell{position:relative}
    #srAdminBell button{border:1px solid #d7e5dc;background:#fff;color:#145b3d;border-radius:12px;padding:9px 12px;font-weight:700}
    #srAdminBell .sr-count{display:inline-flex;min-width:19px;height:19px;align-items:center;justify-content:center;border-radius:20px;background:#c62828;color:white;font-size:11px;margin-left:5px}
    #srAdminNoticePanel{position:absolute;right:0;top:44px;width:min(390px,calc(100vw - 28px));max-height:70vh;overflow:auto;background:#fff;color:#1c2b22;border:1px solid #d8e5dc;border-radius:14px;box-shadow:0 12px 36px #10251a2b;padding:12px;z-index:9999}
    #srAdminNoticePanel[hidden]{display:none}
    .sr-notice{padding:11px 8px;border-bottom:1px solid #e6eee9;font-size:13px}
    .sr-notice.unread{background:#f0f8f3}
    .sr-notice small{display:block;color:#617268;line-height:1.5;margin-top:4px}
    .sr-notice button{margin-top:6px;font-size:11px;padding:5px 8px}
    .sr-notice-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}
  `;
  document.head.appendChild(style);

  function ensureUI(){
    if(document.getElementById('srAdminBell')) return;
    const tools=document.querySelector('.session-tools');
    if(!tools)return;
    const wrap=document.createElement('div');
    wrap.id='srAdminBell';
    wrap.innerHTML='<button type="button" id="srAdminBellButton" aria-expanded="false">🔔 Notifications <span id="srAdminUnread" class="sr-count" hidden>0</span></button><section id="srAdminNoticePanel" hidden><div class="sr-notice-head"><b>Admin Activity Notifications</b><button type="button" id="srAdminRefresh" class="tiny secondary">Refresh</button></div><div id="srAdminNoticeList">Loading…</div></section>';
    tools.insertBefore(wrap,tools.firstChild);
    wrap.querySelector('#srAdminBellButton').addEventListener('click',()=>{
      const panel=wrap.querySelector('#srAdminNoticePanel');
      panel.hidden=!panel.hidden;
      wrap.querySelector('#srAdminBellButton').setAttribute('aria-expanded',String(!panel.hidden));
      if(!panel.hidden) load();
    });
    wrap.querySelector('#srAdminRefresh').addEventListener('click',load);
  }

  function describe(n){
    if(n.event_type==='attendance_checkin'||n.event_type==='attendance_checkout'){
      return '<b>'+esc(n.title)+'</b><small>कर्मचारी: '+esc(n.employee_name||n.actor_name||'—')+' · मोबाइल: '+esc(n.employee_phone||'—')+'<br>पद: '+esc(n.employee_role||n.actor_role||'—')+'<br>समय: '+esc(new Date(n.created_at).toLocaleString('en-IN'))+'</small>';
    }
    if(n.event_type==='leave_requested'||n.event_type==='leave_approved'||n.event_type==='leave_rejected'){
      return '<b>'+esc(n.title)+'</b><small>कर्मचारी: '+esc(n.employee_name||'—')+' · मोबाइल: '+esc(n.employee_phone||'—')+'<br>Leave: '+esc(n.customer_name||'—')+'<br>कारण/नोट: '+esc(n.customer_phone||'—')+'<br>Manager: '+esc(n.manager_name||'—')+' · Team Leader: '+esc(n.team_leader_name||'—')+'</small>';
    }
    if(n.event_type==='followup_created'||n.event_type==='visit_created'||n.event_type==='booking_created'||n.event_type==='call_logged'){
      return '<b>'+esc(n.title)+'</b><small>ग्राहक: '+esc(n.customer_name||'—')+' · मोबाइल: '+esc(n.customer_phone||'—')+'<br>Project: '+esc(n.project_name||'—')+'<br>Owner: '+esc(n.owner_name||'—')+'<br>Entry By: '+esc(n.actor_name||'—')+' ('+esc(n.actor_role||'—')+')<br>Manager: '+esc(n.manager_name||'—')+' · Team Leader: '+esc(n.team_leader_name||'—')+'</small>';
    }
    if(n.event_type==='lead_created'){
      return '<b>नई Lead: '+esc(n.customer_name)+'</b><small>ग्राहक मोबाइल: '+esc(n.customer_phone||'—')+'<br>Project: '+esc(n.project_name||'—')+'<br>Lead Owner: '+esc(n.owner_name||'Unassigned')+'<br>Entry By: '+esc(n.actor_name||'—')+' ('+esc(n.actor_role||'—')+')<br>Manager: '+esc(n.manager_name||'—')+' · Team Leader: '+esc(n.team_leader_name||'—')+'</small>';
    }
    if(n.event_type==='staff_signup'){
      return '<b>नई Staff Registration Request</b><small>नाम: '+esc(n.employee_name||n.actor_name)+'<br>मोबाइल: '+esc(n.employee_phone||'—')+'<br>Requested Role: '+esc(n.employee_role||n.actor_role||'—')+'</small>';
    }
    return '<b>नया कर्मचारी जुड़ा: '+esc(n.employee_name||n.actor_name)+'</b><small>मोबाइल: '+esc(n.employee_phone||'—')+'<br>Role: '+esc(n.employee_role||n.actor_role||'—')+'<br>Manager: '+esc(n.manager_name||'—')+' · Team Leader: '+esc(n.team_leader_name||'—')+'</small>';
  }

  async function load(){
    const list=document.getElementById('srAdminNoticeList');
    if(!client||!currentId||!list||busy)return;
    busy=true;list.textContent='Notifications लोड हो रही हैं…';
    try{
      const {data,error}=await client.from('admin_notifications')
        .select('id,event_type,title,actor_name,actor_role,employee_name,employee_phone,employee_role,owner_name,manager_name,team_leader_name,customer_name,customer_phone,project_name,created_at,read_at')
        .eq('recipient_id',currentId).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      const rows=data||[];
      const unread=rows.filter(x=>!x.read_at).length;
      const count=document.getElementById('srAdminUnread');
      count.textContent=unread>99?'99+':String(unread);count.hidden=!unread;
      list.innerHTML=rows.map(n=>'<article class="sr-notice '+(!n.read_at?'unread':'')+'">'+describe(n)+'<small>'+esc(new Date(n.created_at).toLocaleString('en-IN'))+'</small>'+(!n.read_at?'<button type="button" data-read="'+esc(n.id)+'">Mark as read</button>':'<small>पढ़ लिया गया</small>')+'</article>').join('')||'<p class="muted">अभी कोई नई गतिविधि नहीं है।</p>';
      list.querySelectorAll('[data-read]').forEach(btn=>btn.addEventListener('click',async()=>{
        const {error}=await client.from('admin_notifications').update({read_at:new Date().toISOString()}).eq('id',btn.dataset.read).eq('recipient_id',currentId);
        if(error){alert('Notification update नहीं हुई: '+error.message);return;}load();
      }));
    }catch(err){
      list.textContent='Notifications उपलब्ध नहीं: '+(err?.message||String(err))+' · Supabase में admin_notifications migration चलाएँ।';
    }finally{busy=false;}
  }

  function playAlert(){
    try{
      if(navigator.vibrate)navigator.vibrate([180,90,180]);
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return;
      const ctx=new Audio();
      if(ctx.state==='suspended')ctx.resume();
      [0,0.24,0.48].forEach((offset,i)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type='sine';osc.frequency.value=i===1?1040:880;
        gain.gain.setValueAtTime(0.0001,ctx.currentTime+offset);
        gain.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+offset+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+offset+0.16);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(ctx.currentTime+offset);osc.stop(ctx.currentTime+offset+0.18);
      });
      setTimeout(()=>ctx.close(),1000);
    }catch(err){console.warn('Notification sound:',err)}
  }

  async function start(profile){
    stop();
    if(!profile||String(profile.role||'').toLowerCase()!=='admin')return;
    ensureUI();
    client=window.srSupabase;currentId=profile.id;
    if(!client||!currentId)return;
    await load();
    try{
      channel=client.channel('sr-admin-notifications-'+currentId)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'admin_notifications',filter:'recipient_id=eq.'+currentId},payload=>{
          playAlert();
          const panel=document.getElementById('srAdminNoticePanel');
          if(panel&&!panel.hidden)load();else{
            const count=document.getElementById('srAdminUnread');
            const old=Number(count?.textContent||0);
            if(count){count.textContent=String(old+1);count.hidden=false;}
          }
        }).subscribe();
    }catch(err){console.warn('Admin notification realtime:',err);}
    timer=setInterval(load,30000);
  }

  function stop(){
    if(timer)clearInterval(timer);timer=null;
    if(channel&&client)client.removeChannel(channel).catch(()=>{});channel=null;
    currentId=null;
  }

  window.addEventListener('sr-auth-ready',e=>start(e.detail));
  window.addEventListener('sr-auth-logout',stop);
  if(window.srCurrentProfile)setTimeout(()=>start(window.srCurrentProfile),0);
})();
