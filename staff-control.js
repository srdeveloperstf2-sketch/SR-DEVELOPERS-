(() => {
  const $ = id => document.getElementById(id);
  const panel = $('staffControl');
  if (!panel) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roleLabel = role => ({admin:'Admin',manager:'Manager',team_leader:'Team Leader',sales_executive:'Sales Executive'}[role] || role || '—');
  const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
  const dateLabel = value => value ? new Date(value+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  let client=null, me=null, profiles=[], attendance=[], leaves=[], records=[];
  const status = (msg,error=false) => { const el=$('scStatus'); if(el){el.textContent=msg;el.classList.toggle('error',error);} };
  const canAdmin = () => me?.role==='admin';
  const canReview = () => ['admin','manager','team_leader'].includes(me?.role);
  const activeProfiles = () => profiles.filter(p=>p.is_active);
  function navVisibility(){
    const tabs=document.querySelector('#tabs');
    const b=document.createElement('button');
    b.type='button';b.dataset.tab='staffControl';b.textContent='Staff Control';
    if(!tabs.querySelector('[data-tab="staffControl"]'))tabs.appendChild(b);
    b.hidden=!canReview();
    b.onclick=()=>{document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='staffControl'));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));window.scrollTo(0,0);refresh();};
    panel.hidden=!canReview();
    $('scAdminPanel').hidden=!canAdmin();
    $('scAdminNote').hidden=canAdmin();
    $('scAttendancePanel').hidden=false;
    $('scLeavePanel').hidden=false;
  }
  function fillSupervisorOptions(){
    const managers=profiles.filter(p=>p.is_active&&p.role==='manager');
    const leaders=profiles.filter(p=>p.is_active&&p.role==='team_leader');
    $('scManager').innerHTML='<option value="">— कोई Manager नहीं —</option>'+managers.map(p=>'<option value="'+p.id+'">'+esc(p.full_name)+'</option>').join('');
    $('scLeader').innerHTML='<option value="">— कोई Team Leader नहीं —</option>'+leaders.map(p=>'<option value="'+p.id+'">'+esc(p.full_name)+'</option>').join('');
  }
  function renderTeam(){
    const visible=profiles;
    $('scTeamCount').textContent=visible.length;
    $('scActiveCount').textContent=visible.filter(p=>p.is_active).length;
    $('scManagerCount').textContent=visible.filter(p=>p.role==='manager').length;
    $('scExecCount').textContent=visible.filter(p=>p.role==='sales_executive').length;
    fillSupervisorOptions();
    $('scTeamList').innerHTML=visible.map(p=>{
      const manager=visible.find(x=>x.id===p.manager_id)?.full_name||'—';
      const leader=visible.find(x=>x.id===p.team_leader_id)?.full_name||'—';
      const isSelf=p.id===me.id;
      const adminControls=canAdmin()?'<div class="sc-row-actions"><label>Role<select data-field="role" data-id="'+p.id+'">'+['admin','manager','team_leader','sales_executive'].map(r=>'<option value="'+r+'" '+(p.role===r?'selected':'')+'>'+roleLabel(r)+'</option>').join('')+'</select></label><label>Manager<select data-field="manager_id" data-id="'+p.id+'"><option value="">None</option>'+profiles.filter(x=>x.is_active&&x.role==='manager'&&x.id!==p.id).map(x=>'<option value="'+x.id+'" '+(p.manager_id===x.id?'selected':'')+'>'+esc(x.full_name)+'</option>').join('')+'</select></label><label>Team Leader<select data-field="team_leader_id" data-id="'+p.id+'"><option value="">None</option>'+profiles.filter(x=>x.is_active&&x.role==='team_leader'&&x.id!==p.id).map(x=>'<option value="'+x.id+'" '+(p.team_leader_id===x.id?'selected':'')+'>'+esc(x.full_name)+'</option>').join('')+'</select></label><button class="tiny" data-save-profile="'+p.id+'">Save</button><button class="tiny '+(p.is_active?'danger':'secondary')+'" data-toggle-profile="'+p.id+'">'+(p.is_active?'Deactivate':'Activate')+'</button></div>':'';
      return '<article class="sc-person"><div class="sc-avatar">'+esc((p.full_name||'S').trim().slice(0,1).toUpperCase())+'</div><div class="sc-person-main"><div class="sc-person-head"><b>'+esc(p.full_name)+'</b><span class="sc-chip '+(p.is_active?'good':'off')+'">'+(p.is_active?'Active':'Inactive')+'</span></div><small>'+esc(roleLabel(p.role))+' · '+esc(p.phone||p.email||'Contact not added')+'</small><small>Manager: '+esc(manager)+' · Team Leader: '+esc(leader)+'</small>'+adminControls+'</div></article>';
    }).join('')||'<p class="muted">इस Login के लिए कोई टीम रिकॉर्ड उपलब्ध नहीं है।</p>';
    $('scTeamList').querySelectorAll('[data-save-profile]').forEach(btn=>btn.onclick=()=>saveProfile(btn.dataset.saveProfile,btn));
    $('scTeamList').querySelectorAll('[data-toggle-profile]').forEach(btn=>btn.onclick=()=>toggleProfile(btn.dataset.toggleProfile,btn));
  }
  async function saveProfile(id,button){
    const fields=[...$('scTeamList').querySelectorAll('[data-id="'+id+'"]')];
    const patch={};fields.forEach(el=>patch[el.dataset.field]=el.value||null);
    if(patch.role==='admin'&&id!==me.id){if(!confirm('इस कर्मचारी को Admin अधिकार देना चाहते हैं? Admin को कंपनी के सभी रिकॉर्ड दिख सकते हैं।'))return;}
    if(patch.role==='manager'){patch.manager_id=null;patch.team_leader_id=null;}
    if(patch.role==='team_leader')patch.team_leader_id=null;
    if(patch.manager_id===id||patch.team_leader_id===id){status('कर्मचारी स्वयं अपना Manager / Team Leader नहीं हो सकता।',true);return;}
    button.disabled=true;
    const {error}=await client.from('profiles').update(patch).eq('id',id);
    button.disabled=false;
    if(error){status('Profile अपडेट नहीं हुई: '+error.message,true);return;}
    status('कर्मचारी की Role और Reporting Structure अपडेट हो गई।');
    await refresh();
  }
  async function toggleProfile(id,button){
    const p=profiles.find(x=>x.id===id);if(!p)return;
    if(id===me.id){status('आप अपना Admin Login यहाँ से बंद नहीं कर सकते।',true);return;}
    const next=!p.is_active;
    if(!confirm((next?'इस कर्मचारी का Login फिर से चालू':'इस कर्मचारी का Login बंद')+' करना चाहते हैं?'))return;
    button.disabled=true;
    const {error}=await client.from('profiles').update({is_active:next}).eq('id',id);
    button.disabled=false;
    if(error){status('Account status अपडेट नहीं हुआ: '+error.message,true);return;}
    status(next?'कर्मचारी Profile सक्रिय कर दी गई।':'कर्मचारी Profile निष्क्रिय कर दी गई। अगली session verification पर ऐप Login रोक देगा।');
    await refresh();
  }
  function renderAttendance(){
    const own=attendance.filter(a=>a.user_id===me.id).sort((a,b)=>b.attendance_date.localeCompare(a.attendance_date));
    $('scAttendanceList').innerHTML=own.slice(0,10).map(a=>'<div class="sc-list-row"><div><b>'+dateLabel(a.attendance_date)+'</b><small>In: '+(a.check_in?new Date(a.check_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—')+' · Out: '+(a.check_out?new Date(a.check_out).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—')+'</small></div><span class="sc-chip '+(a.check_out?'good':'pending')+'">'+(a.check_out?'Complete':a.check_in?'Checked In':'—')+'</span></div>').join('')||'<p class="muted">अभी Attendance दर्ज नहीं है।</p>';
    const inToday=own.find(a=>a.attendance_date===today());
    $('scCheckIn').disabled=!!inToday?.check_in;
    $('scCheckOut').disabled=!inToday?.check_in||!!inToday?.check_out;
    $('scTodayAttendance').textContent=inToday?.check_out?'आज की Attendance पूरी है':inToday?.check_in?'आज Check-in दर्ज है':'आज अभी Check-in नहीं हुआ';
  }
  async function attendanceAction(kind){
    const now=new Date().toISOString(),day=today();
    const existing=attendance.find(a=>a.user_id===me.id&&a.attendance_date===day);
    let result;
    if(kind==='in'){
      if(existing?.check_in){status('आज का Check-in पहले से दर्ज है।',true);return;}
      result=await client.from('attendance').upsert({user_id:me.id,attendance_date:day,check_in:now},{onConflict:'user_id,attendance_date'});
    }else{
      if(!existing?.check_in||existing.check_out){status('Check-out से पहले आज Check-in जरूरी है।',true);return;}
      result=await client.from('attendance').update({check_out:now}).eq('user_id',me.id).eq('attendance_date',day);
    }
    if(result.error){status('Attendance सेव नहीं हुई: '+result.error.message,true);return;}
    status(kind==='in'?'आज का Check-in Cloud में सेव हो गया।':'आज का Check-out Cloud में सेव हो गया।');
    await refresh();
  }
  function renderLeaves(){
    $('scLeaveList').innerHTML=leaves.map(l=>{
      const who=profiles.find(p=>p.id===l.employee_id)?.full_name||(l.employee_id===me.id?'आप':'Team member');
      const review=canReview()&&l.status==='pending'&&l.employee_id!==me.id?'<div class="sc-row-actions"><button class="tiny" data-leave-action="approved" data-leave-id="'+l.id+'">Approve</button><button class="tiny danger" data-leave-action="rejected" data-leave-id="'+l.id+'">Reject</button></div>':'';
      return '<article class="sc-leave"><div class="sc-person-head"><b>'+esc(who)+'</b><span class="sc-chip '+(l.status==='approved'?'good':l.status==='rejected'?'off':'pending')+'">'+esc(l.status.toUpperCase())+'</span></div><small>'+esc(l.leave_type)+' · '+dateLabel(l.start_date)+' – '+dateLabel(l.end_date)+'</small><p>'+esc(l.reason)+'</p>'+review+'</article>';
    }).join('')||'<p class="muted">अभी Leave Request नहीं है।</p>';
    $('scLeaveList').querySelectorAll('[data-leave-action]').forEach(btn=>btn.onclick=()=>reviewLeave(btn.dataset.leaveId,btn.dataset.leaveAction,btn));
  }
  async function reviewLeave(id,next,button){
    if(!confirm('इस Leave Request को '+(next==='approved'?'Approve':'Reject')+' करना चाहते हैं?'))return;
    button.disabled=true;
    const {error}=await client.from('leave_requests').update({status:next,reviewed_by:me.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending');
    button.disabled=false;
    if(error){status('Leave update नहीं हुई: '+error.message,true);return;}
    status('Leave Request '+next+' कर दी गई।');await refresh();
  }
  function renderReport(){
    const counts=new Map();
    for(const p of profiles)counts.set(p.id,{name:p.full_name,role:p.role,leads:0,followups:0,visits:0,bookings:0,attendance:0});
    for(const r of records){
      const owner=r.owner_id||r.created_by;const c=counts.get(owner);if(!c)continue;
      if(r.record_type==='lead')c.leads++;
      if(r.record_type==='followup')c.followups++;
      if(r.record_type==='visit')c.visits++;
      if(r.record_type==='booking')c.bookings++;
    }
    for(const a of attendance){const c=counts.get(a.user_id);if(c)c.attendance++;}
    $('scReportTable').innerHTML=[...counts.values()].sort((a,b)=>b.bookings-a.bookings||b.leads-a.leads).map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(roleLabel(c.role))+'</td><td>'+c.leads+'</td><td>'+c.followups+'</td><td>'+c.visits+'</td><td>'+c.bookings+'</td><td>'+c.attendance+'</td></tr>').join('')||'<tr><td colspan="7">रिपोर्ट डेटा उपलब्ध नहीं है।</td></tr>';
    $('scReportHint').textContent='रिपोर्ट उपलब्ध Cloud Records और आपकी Role Permission के अनुसार दिखाई गई है।';
  }
  async function refresh(){
    if(!client||!me)return;
    status('Staff Control का डेटा लोड हो रहा है…');
    const [p,a,l,r]=await Promise.all([
      client.from('profiles').select('id,full_name,role,phone,email,manager_id,team_leader_id,is_active,created_at').order('full_name'),
      client.from('attendance').select('id,user_id,attendance_date,check_in,check_out').order('attendance_date',{ascending:false}).limit(500),
      client.from('leave_requests').select('*').order('created_at',{ascending:false}).limit(200),
      client.from('crm_records').select('id,record_type,owner_id,created_by,updated_at').limit(2000)
    ]);
    if(p.error){status('Team data नहीं खुला: '+p.error.message,true);return;}
    profiles=p.data||[];attendance=a.data||[];leaves=l.data||[];records=r.data||[];
    if(a.error)status('Attendance table उपलब्ध नहीं: '+a.error.message,true);
    if(l.error)status('Leave Requests migration अभी लागू नहीं हुई: '+l.error.message,true);
    renderTeam();renderAttendance();renderLeaves();renderReport();
    if(!a.error&&!l.error)status('Staff Control अपडेट है · '+profiles.length+' visible profiles');
  }
  $('scAttendanceDate').value=today();
  $('scCheckIn').onclick=()=>attendanceAction('in');
  $('scCheckOut').onclick=()=>attendanceAction('out');
  $('scLeaveForm').onsubmit=async e=>{
    e.preventDefault();
    const start=$('scLeaveStart').value,end=$('scLeaveEnd').value;
    if(end<start){status('Leave की समाप्ति तारीख शुरुआत से पहले नहीं हो सकती।',true);return;}
    const {error}=await client.from('leave_requests').insert({employee_id:me.id,leave_type:$('scLeaveType').value,start_date:start,end_date:end,reason:$('scLeaveReason').value.trim(),status:'pending'});
    if(error){status('Leave Request सेव नहीं हुई: '+error.message,true);return;}
    e.target.reset();$('scLeaveStart').value=today();$('scLeaveEnd').value=today();status('Leave Request Manager / Admin को भेज दी गई।');await refresh();
  };
  async function boot(){
    client=window.srSupabase;me=window.srCurrentProfile;
    if(!client||!me)return;
    navVisibility();await refresh();
  }
  window.addEventListener('sr-auth-ready',boot);
  window.addEventListener('sr-cloud-ready',()=>{if(me)refresh();});
  window.addEventListener('sr-auth-logout',()=>{me=null;profiles=[];attendance=[];leaves=[];records=[];panel.hidden=true;});
  if(window.srCurrentProfile)setTimeout(boot,0);
})();
