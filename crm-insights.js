(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // Prevent duplicate panels if the script is evaluated more than once.
  if (document.getElementById('srInsights')) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const db = () => window.srDb || {};
  const profile = () => window.srCurrentProfile || {};
  const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
  const dateOf = v => String(v || '').slice(0,10);
  const money = v => '₹' + Number(v || 0).toLocaleString('en-IN');
  const stamp = () => new Date().toISOString();
  const who = () => profile().full_name || profile().email || 'CRM User';
  const role = () => String(profile().role || '').trim().toLowerCase();
  const isAdmin = () => role() === 'admin';
  const isManager = () => ['manager','team_leader','team leader'].includes(role()) || isAdmin();
  const leadById = id => (db().leads || []).find(x => x.id === id);
  const leadOwner = l => l?.owner_id || l?.ownerId || '';
  // The directory is already constrained by Supabase profile RLS.
  const visibleStaff = () => {
    const me=profile(), all=[...(window.srEmployeeDirectory||[]).filter(p=>p.id!==me.id),me], ids=new Set([me.id]);
    if(isAdmin()) return all;
    if(role()==='manager'){
      let changed=true;
      while(changed){changed=false;for(const p of all){if(ids.has(p.id))continue;if(ids.has(p.manager_id)||ids.has(p.team_leader_id)){ids.add(p.id);changed=true;}}}
    } else if(['team_leader','team leader'].includes(role())) {
      all.forEach(p=>{if(p.team_leader_id===me.id)ids.add(p.id);});
    }
    return all.filter(p=>ids.has(p.id));
  };
  const visibleOwnerIds = () => new Set(visibleStaff().map(p=>p.id));
  const nameToId = name => visibleStaff().find(p=>String(p.full_name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())?.id||'';
  const assignedToMe = l => leadOwner(l)===profile().id || nameToId(l?.assigned)===profile().id || (l?.created_by&&l.created_by===profile().id);
  const canSeeLead = l => !!l && (isAdmin() || visibleOwnerIds().has(leadOwner(l)||nameToId(l?.assigned)) || l.created_by===profile().id);
  const visibleLeads = () => (db().leads || []).filter(canSeeLead);
  const root = document.createElement('section');
  root.id = 'srInsights';
  root.className = 'panel';
  root.innerHTML = `
    <style>
      #srInsights{margin-top:16px}#srInsights .ins-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:12px 0}
      #srInsights .ins-card{background:#f6faf7;border:1px solid #dce9e0;border-radius:13px;padding:13px;min-width:0}
      #srInsights .ins-card small{display:block;color:#66786d;font-size:12px}#srInsights .ins-card strong{font-size:23px;color:#145c3b}
      #srInsights .ins-scroll{overflow:auto}#srInsights table{width:100%;border-collapse:collapse;font-size:12px;min-width:620px}
      #srInsights th,#srInsights td{padding:9px;border-bottom:1px solid #e4ece6;text-align:left;vertical-align:top}
      #srInsights th{background:#f1f7f3;color:#315b43;position:sticky;top:0}
      #srInsights .ins-list{display:grid;gap:8px}#srInsights .ins-row{border:1px solid #e1eae4;border-radius:11px;padding:10px;background:#fff}
      #srInsights .ins-row small{display:block;color:#6a786f;margin-top:4px;overflow-wrap:anywhere}
      #srInsights .ins-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
      #srInsights input,#srInsights select,#srInsights textarea{width:100%;padding:10px;border:1px solid #d6e2d9;border-radius:9px;background:white}
      #srInsights .ins-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}
      #srInsights .ins-form label{font-size:12px;color:#53665a}#srInsights .ins-form button{align-self:end}
      #srInsights .ins-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}#srInsights .ins-tabs button{font-size:12px;padding:8px 11px}
      #srInsights .ins-muted{font-size:12px;color:#6d7b72;line-height:1.5}
      #srInsights .ins-badge{display:inline-block;border-radius:20px;padding:3px 8px;background:#edf5ef;color:#256344;font-size:11px}
      #srInsights .ins-warn{background:#fff7e8;color:#805b18}
      @media(max-width:600px){#srInsights{padding:12px}#srInsights .ins-form{grid-template-columns:1fr}}
    </style>
    <h2>Sales Intelligence & Customer 360</h2>
    <p class="ins-muted">Daily Work Planner, अनुमानित Sales Pipeline, Manager Monitoring और ग्राहक की पूरी उपलब्ध CRM History। रिपोर्ट केवल CRM में दर्ज डेटा पर आधारित है।</p>
    <div class="ins-grid" id="insKpis"></div>
    <div class="ins-tabs">
      <button type="button" data-ins-tab="planner">Daily Work Planner</button>
      <button type="button" data-ins-tab="team">Manager Monitoring</button>
      <button type="button" data-ins-tab="history">Customer History</button>
    </div>
    <div id="insPlanner">
      <h3>आज का काम और Pending Follow-ups</h3><div id="insPlannerList" class="ins-list"></div>
      <h3 style="margin-top:18px">Sales Forecast</h3><div id="insForecast"></div>
    </div>
    <div id="insTeam" hidden>
      <h3>Daily Team Performance</h3><label>रिपोर्ट की तारीख <input id="insReportDate" type="date" value="${today()}"></label>
      <div id="insTeamTable" class="ins-scroll"></div>
      <p class="ins-muted">Lead count ownership के आधार पर है। Calls केवल CRM में दर्ज Call Attempt हैं; फोन पर वास्तव में बात हुई या नहीं, यह अलग से पुष्टि किए बिना नहीं माना जाता।</p>
    </div>
    <div id="insHistory" hidden>
      <h3>ग्राहक की पूरी History</h3>
      <div class="ins-form"><label>ग्राहक खोजें (नाम / मोबाइल)<input id="insCustomerSearch" placeholder="नाम या मोबाइल नंबर"></label><label>ग्राहक चुनें<select id="insCustomerSelect"><option value="">पहले ग्राहक खोजें</option></select></label></div>
      <div id="insCustomerSummary"></div>
      <h4>नई बातचीत / गतिविधि दर्ज करें</h4>
      <form id="insInteractionForm" class="ins-form">
        <label>बातचीत का प्रकार<select id="insInteractionType"><option value="call_connected">Call Connected</option><option value="call_no_answer">Call No Answer</option><option value="whatsapp_sent">WhatsApp Message Sent</option><option value="whatsapp_reply">WhatsApp Reply Received</option><option value="meeting">Meeting / Site Discussion</option><option value="note">Other Note</option></select></label>
        <label>अगली Follow-up तारीख और समय<input id="insNextFollow" type="datetime-local"></label>
        <label style="grid-column:1/-1">बातचीत का विवरण<textarea id="insInteractionNote" rows="2" required placeholder="ग्राहक की बात, बजट, पसंद, अगला कदम..."></textarea></label>
        <button type="submit">History में Save करें</button>
      </form>
      <div id="insHistoryList" class="ins-list"></div>
    </div>`;
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.appendChild(root);
  const updateAccess=()=>{root.querySelector('[data-ins-tab="team"]').hidden=!isManager();};

  function refresh() {
    const d = db(), leads = visibleLeads(), fups = (d.followups || []).filter(f => canSeeLead(leadById(f.lead)));
    const visits = (d.visits || []).filter(v => canSeeLead(leadById(v.lead)));
    const bookings = (d.bookings || []).filter(b => canSeeLead(leadById(b.lead)));
    const pending = fups.filter(f => !f.completedAt && !f.calledAt);
    const overdue = pending.filter(f => dateOf(f.when) < today());
    const dueToday = pending.filter(f => dateOf(f.when) === today());
    const calls = (d.callLogs || []).filter(x => canSeeLead(leadById(x.lead)));
    const dayCalls = calls.filter(x => dateOf(x.at) === today());
    const dayVisits = visits.filter(x => dateOf(x.when) === today());
    const dayBookings = bookings.filter(x => dateOf(x.date || x.createdAt) === today());
    $('insKpis').innerHTML = [
      ['Visible Leads',leads.length],['Follow-ups Pending',pending.length],['Overdue Follow-ups',overdue.length],["Today's Call Entries",dayCalls.length],["Today's Site Visits",dayVisits.length],["Today's Bookings",dayBookings.length]
    ].map(([a,b])=>'<div class="ins-card"><small>'+esc(a)+'</small><strong>'+b+'</strong></div>').join('');
    const plan = pending.slice().sort((a,b)=>String(a.when).localeCompare(String(b.when))).slice(0,50);
    $('insPlannerList').innerHTML = plan.map(f=>{const l=leadById(f.lead);const late=dateOf(f.when)<today();return '<div class="ins-row"><b>'+esc(l?.name || 'ग्राहक रिकॉर्ड उपलब्ध नहीं')+'</b> <span class="ins-badge '+(late?'ins-warn':'')+'">'+(late?'Overdue':dateOf(f.when)===today()?'आज':'आगामी')+'</span><small>'+esc(l?.phone||'')+' · '+esc(l?.project||'')+' · '+esc(f.when||'समय नहीं')+'</small><small>जिम्मेदार: '+esc(l?.assigned || 'Unassigned')+' · '+esc(f.notes||'Follow-up')+'</small><div class="ins-actions">'+(l?.phone?'<a href="tel:'+esc(l.phone)+'">Call</a><a target="_blank" rel="noopener" href="https://wa.me/'+esc(String(l.whatsapp||l.phone).replace(/\D/g,''))+'">WhatsApp</a>':'')+'<button type="button" data-ins-done="'+esc(f.id)+'">Mark Follow-up Done</button></div></div>'}).join('') || '<p class="ins-muted">अभी कोई Pending Follow-up नहीं है।</p>';
    const weighted = leads.filter(l=>!['Booked','Lost'].includes(String(l.status||''))).reduce((sum,l)=>sum+Number(l.budget||0)*(String(l.priority).toLowerCase()==='hot'?.6:String(l.priority).toLowerCase()==='warm'?.3:.1),0);
    const hot = leads.filter(l=>String(l.priority).toLowerCase()==='hot'&&!['Booked','Lost'].includes(String(l.status||''))).length;
    $('insForecast').innerHTML = '<div class="ins-grid"><div class="ins-card"><small>Open Pipeline Budget (entered budgets)</small><strong>'+money(leads.filter(l=>!['Booked','Lost'].includes(String(l.status||''))).reduce((s,l)=>s+Number(l.budget||0),0))+'</strong></div><div class="ins-card"><small>Weighted Estimate (Hot 60%, Warm 30%, Cold 10%)</small><strong>'+money(weighted)+'</strong></div><div class="ins-card"><small>Hot Open Leads</small><strong>'+hot+'</strong></div></div><p class="ins-muted">यह planning estimate है, confirmed revenue या guaranteed booking forecast नहीं। प्रतिशत केवल planning assumptions हैं और इन्हें कंपनी के वास्तविक conversion data से calibrate करना होगा। जिन Leads में Budget नहीं भरा है, वे रकम में शामिल नहीं हैं।</p>';
    renderTeam();
    renderCustomerOptions();
  }
  function renderTeam() {
    if(!isManager()){$('insTeamTable').innerHTML='<p class="ins-muted">Manager Monitoring केवल Admin, Manager और Team Leader के लिए उपलब्ध है।</p>';return;}
    const d=db(), day=$('insReportDate')?.value || today(), staff=visibleStaff().map(p=>({id:p.id,name:p.full_name,role:p.role})).filter(p=>p.id);
    // Never fall back to an unrestricted locally cached staff list.
    const rows=staff.map(s=>{
      const mine=(d.leads||[]).filter(l=>canSeeLead(l)&&(leadOwner(l)===s.id||nameToId(l.assigned)===s.id));
      const ids=new Set(mine.map(l=>l.id));
      const interactions=(d.callLogs||[]).filter(x=>ids.has(x.lead)&&dateOf(x.at)===day);
      const follow=(d.followups||[]).filter(x=>ids.has(x.lead)&&dateOf(x.when)===day);
      const v=(d.visits||[]).filter(x=>ids.has(x.lead)&&dateOf(x.when)===day);
      const b=(d.bookings||[]).filter(x=>ids.has(x.lead)&&dateOf(x.date||x.createdAt)===day);
      const done=follow.filter(x=>x.completedAt||x.calledAt).length;
      const pending=follow.length-done;
      return '<tr><td><b>'+esc(s.name)+'</b><br>'+esc(s.id)+'</td><td>'+esc(s.role)+'</td><td>'+mine.length+'</td><td>'+interactions.length+'</td><td>'+follow.length+' <small>(Pending '+pending+')</small></td><td>'+v.length+'</td><td>'+b.length+'</td></tr>';
    });
    $('insTeamTable').innerHTML='<table><thead><tr><th>कर्मचारी</th><th>पद</th><th>Assigned Leads</th><th>Contact Entries</th><th>Follow-ups</th><th>Site Visits</th><th>Bookings</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>' || '<p class="ins-muted">कर्मचारी डेटा उपलब्ध नहीं।</p>';
  }
  function renderCustomerOptions() {
    const q=($('insCustomerSearch')?.value||'').toLowerCase().trim();
    const list=visibleLeads().filter(l=>(String(l.name)+' '+String(l.phone)).toLowerCase().includes(q));
    const select=$('insCustomerSelect'), old=select.value;
    select.innerHTML='<option value="">ग्राहक चुनें ('+list.length+')</option>'+list.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+' — '+esc(l.phone)+'</option>').join('');
    if(list.some(l=>l.id===old)) select.value=old;
    renderHistory();
  }
  function renderHistory() {
    const id=$('insCustomerSelect')?.value, l=leadById(id);
    if(!l){$('insCustomerSummary').innerHTML='<p class="ins-muted">ग्राहक चुनने पर उसका Project, Owner, अगला Follow-up और संपर्क इतिहास यहाँ दिखेगा।</p>'; $('insHistoryList').innerHTML='';return;}
    const logs=(db().callLogs||[]).filter(x=>x.lead===id).slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    const fups=(db().followups||[]).filter(x=>x.lead===id).sort((a,b)=>String(a.when).localeCompare(String(b.when)));
    const next=fups.find(x=>!x.completedAt&&!x.calledAt);
    $('insCustomerSummary').innerHTML='<div class="ins-card"><b>'+esc(l.name)+'</b><div>'+esc(l.phone)+' · '+esc(l.project)+'</div><small>Priority: '+esc(l.priority)+' · Status: '+esc(l.status)+' · Owner: '+esc(l.assigned||'Unassigned')+'</small><small>Created: '+esc(l.created||'—')+' · Contact entries: '+logs.length+' · Next Follow-up: '+esc(next?.when||'Not scheduled')+'</small><small>Requirement: '+esc(l.propertyType||'—')+' · '+esc(l.size||'')+' · Budget: '+money(l.budget)+'</small><small>Purpose: '+esc(l.purpose||'—')+' · Timeline: '+esc(l.timeline||'—')+'</small></div>';
    $('insHistoryList').innerHTML=logs.map(x=>'<div class="ins-row"><b>'+esc(({call_button_clicked:'Call button opened',call_attempt:'Call attempt',call_connected:'Call connected',call_no_answer:'Call not answered',whatsapp_sent:'WhatsApp sent',whatsapp_reply:'WhatsApp reply',meeting:'Meeting / Site discussion',note:'Note'})[x.type]||x.type||'Activity')+'</b><small>'+esc(x.at||'')+' · '+esc(x.actor_name||'Staff')+'</small><small>'+esc(x.note||'')+'</small></div>').join('')||'<p class="ins-muted">अभी कोई contact history दर्ज नहीं है। पुराने records में history न होने पर यह खाली दिख सकता है।</p>';
  }
  root.addEventListener('click',e=>{const done=e.target.closest('[data-ins-done]');if(done){const f=(db().followups||[]).find(x=>x.id===done.dataset.insDone);if(f){f.completedAt=stamp();f.completedBy=profile().id||null;f.completedByName=who();localStorage.setItem('srcrm_v11',JSON.stringify(db()));if(window.srCloudReady&&window.srCloudPersist)window.srCloudPersist(db());refresh();}return;}const b=e.target.closest('[data-ins-tab]');if(!b)return;const key=b.dataset.insTab;['planner','team','history'].forEach(k=>{$('ins'+k[0].toUpperCase()+k.slice(1)).hidden=k!==key;});if(key==='team')renderTeam();if(key==='history')renderCustomerOptions();});
  $('insReportDate').addEventListener('change',renderTeam);
  $('insCustomerSearch').addEventListener('input',renderCustomerOptions);
  $('insCustomerSelect').addEventListener('change',renderHistory);
  $('insInteractionForm').addEventListener('submit',e=>{
    e.preventDefault();const id=$('insCustomerSelect').value,l=leadById(id);if(!l){alert('पहले ग्राहक चुनें।');return;}
    const item={id:crypto.randomUUID(),lead:id,at:stamp(),type:$('insInteractionType').value,note:$('insInteractionNote').value.trim(),actor_id:profile().id||null,actor_name:who()};
    db().callLogs.push(item);
    const next=$('insNextFollow').value;
    if(next){db().followups.push({id:crypto.randomUUID(),lead:id,when:next,notes:'Customer History से बनाया गया follow-up',created_by:profile().id||null,created_by_name:who(),owner_id:leadOwner(l)||profile().id||null,reminder:5});}
    localStorage.setItem('srcrm_v11',JSON.stringify(db()));
    if(window.srCloudReady&&window.srCloudPersist)window.srCloudPersist(db());
    e.target.reset();renderHistory();refresh();alert('ग्राहक की History सेव हो गई।');
  });
  const originalLog=window.logCall;
  window.logCall=id=>{
    const l=leadById(id);if(!l)return;
    db().callLogs.push({id:crypto.randomUUID(),lead:id,phone:l.phone,at:stamp(),type:'call_attempt',actor_id:profile().id||null,actor_name:who(),note:'CRM से Call link खोला गया; connected call की पुष्टि नहीं।'});
    localStorage.setItem('srcrm_v11',JSON.stringify(db()));
    if(window.srCloudReady&&window.srCloudPersist)window.srCloudPersist(db());
    refresh();
  };
  window.addEventListener('sr-cloud-ready',refresh);
  window.addEventListener('sr-auth-ready',()=>{updateAccess();refresh();});
  document.addEventListener('submit',e=>{if(e.target.closest('#dashboard')||e.target.closest('#leads')||e.target.closest('#followups')||e.target.closest('#visits')||e.target.closest('#bookings'))setTimeout(refresh,0);});
  const oldRender=window.srRender;window.srRender=()=>{oldRender?.();refresh();};
  updateAccess();
  refresh();
})();