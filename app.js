const PROJECTS=['Hilalpur Township','Mandawar Society','S.R. City (Tappal)','Ayodhya Project','Banchari Project','Sondh Project','Aurangabad (Delivered)','Galaxy 1 (IMT Sohna)'];
const K='srcrm_v11';
let db;
try { db=JSON.parse(localStorage.getItem(K)||'{}'); } catch (_) { db={}; }
if(!db || typeof db!=='object' || Array.isArray(db)) db={};
['leads','followups','visits','bookings','staff','messages','attendance','callLogs','inventory','payments','partners','partnerPayouts','resources'].forEach(k=>{if(!Array.isArray(db[k]))db[k]=[];});
const $=id=>document.getElementById(id);const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};const save=()=>{try{localStorage.setItem(K,JSON.stringify(db))}catch(err){console.warn('Local CRM cache is full; cloud sync will be used:',err);window.dispatchEvent(new CustomEvent('sr-local-storage-full'))}if(window.srCloudReady&&window.srCloudPersist){Promise.resolve(window.srCloudPersist(db)).catch(err=>{console.error('CRM cloud save failed:',err);window.dispatchEvent(new CustomEvent('sr-cloud-save-failed',{detail:err?.message||String(err)}))})}};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const optProjects=()=>PROJECTS.map(p=>'<option>'+esc(p)+'</option>').join('');['lProject','vProject','bProject','iProject','cpProject'].forEach(id=>$(id).innerHTML=optProjects());
function leadOptions(id){$(id).innerHTML=db.leads.map(l=>'<option value="'+l.id+'">'+esc(l.name)+' — '+esc(l.phone)+'</option>').join('')}
function go(tab){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===tab));document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));window.scrollTo(0,0)}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
// Native Android reminders use Capacitor Local Notifications. Browser fallback works only while this page remains open.
let localNotifications=null;
function getLocalNotifications(){
 if(localNotifications)return localNotifications;
 const cap=window.Capacitor;
 try{
  if(cap?.registerPlugin)localNotifications=cap.registerPlugin('LocalNotifications');
  else localNotifications=cap?.Plugins?.LocalNotifications||null;
 }catch(_){localNotifications=cap?.Plugins?.LocalNotifications||null}
 return localNotifications;
}
async function askReminderPermission(){
 const plugin=getLocalNotifications();
 if(plugin){
  try{
   let p=await plugin.checkPermissions();
   if(p?.display!=='granted')p=await plugin.requestPermissions();
   if(p?.display!=='granted'){console.warn('Notification permission denied');return false;}
   try{await plugin.createChannel({id:'crm-reminders',name:'CRM Reminders',description:'Client follow-up and site visit reminders',importance:5,sound:'default',vibration:true,visibility:1})}catch(_){}
   try{const exact=await plugin.checkExactNotificationSetting();if(exact.value===false)console.warn('Exact alarm permission is not enabled on this phone; reminders may be delayed.')}catch(_){}
   return true;
  }catch(err){console.warn('Local notification permission:',err);return false}
 }
 if('Notification'in window){
  if(Notification.permission==='granted')return true;
  if(Notification.permission==='default'){try{return await Notification.requestPermission()==='granted'}catch(_){}}
 }
 return false;
}
function reminderId(type,id){let s=type+':'+id,h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0)%2000000000+1}
function reminderIds(type,id,count=36){return Array.from({length:count},(_,i)=>reminderId(type,id+'-'+i))}
async function cancelReminder(type,id){
 const plugin=getLocalNotifications();if(!plugin)return;
 try{await plugin.cancel({notifications:reminderIds(type,id).map(id=>({id}))})}catch(e){console.warn('Reminder cancel:',e)}
}
async function scheduleReminder(type,item,mins){
 if(mins===-1||mins===undefined||mins===null)return {ok:true,skipped:true};
 const eventAt=new Date(item.when).getTime();
 if(!Number.isFinite(eventAt))return {ok:false,reason:'invalid_time'};
 const at=eventAt-Math.max(0,Number(mins)||0)*60000;
 if(at<=Date.now())return {ok:false,reason:'reminder_time_passed'};
 const lead=db.leads.find(l=>l.id===item.lead),name=lead?.name||'ग्राहक';
 const isVisit=type==='visit';
 const title=isVisit?'S.R. DEVELOPERS — Site Visit':'S.R. DEVELOPERS — Follow-up Call';
 const action=isVisit?'ग्राहक की Site Visit है।':'ग्राहक को Follow-up Call करना है।';
 const body=name+' · '+(item.project||lead?.project||'S.R. Developers')+' — '+action+(item.notes?' '+item.notes:'');
 const plugin=getLocalNotifications();
 if(plugin){
  try{
   const id=reminderId(type,item.id);
   await plugin.cancel({notifications:[{id}]});
   await plugin.schedule({notifications:[{id,title,body,smallIcon:'ic_launcher',sound:'default',channelId:'crm-reminders',schedule:{at:new Date(at),allowWhileIdle:true},extra:{type,recordId:item.id,leadId:item.lead}}]});
   return {ok:true,native:true};
  }catch(error){console.warn('Native reminder could not be scheduled:',error);return {ok:false,reason:error.message||'schedule_failed'}}
 }
 if('Notification'in window&&Notification.permission==='granted'){
  const delay=at-Date.now();
  if(delay>2147480000)return {ok:false,reason:'too_far'};
  setTimeout(()=>{if(Date.now()>=at)new Notification(title,{body,tag:type+'-'+item.id,silent:false})},delay);
  return {ok:true,browser:true};
 }
 return {ok:false,reason:'permission'};
}
async function scheduleMorningSummary(){
 const plugin=getLocalNotifications();if(!plugin||!window.srCurrentProfile)return;
 try{
  const id=reminderId('morning-summary',window.srCurrentProfile.id);
  await plugin.cancel({notifications:[{id}]});
  const now=new Date(),at=new Date(now);at.setHours(8,30,0,0);if(at<=now)at.setDate(at.getDate()+1);
  const todayKey=[at.getFullYear(),String(at.getMonth()+1).padStart(2,'0'),String(at.getDate()).padStart(2,'0')].join('-');
  const ownLeads=db.leads.filter(l=>(l.owner_id||l.ownerId)===window.srCurrentProfile.id||String(l.assigned||'').trim().toLowerCase()===String(window.srCurrentProfile.full_name||'').trim().toLowerCase());
  const ownIds=new Set(ownLeads.map(l=>l.id));
  const followups=db.followups.filter(x=>String(x.when||'').slice(0,10)===todayKey&&ownIds.has(x.lead)&&!x.calledAt);
  const visits=db.visits.filter(x=>String(x.when||'').slice(0,10)===todayKey&&ownIds.has(x.lead));
  const lines=[...followups.slice(0,5).map(x=>'Call: '+(db.leads.find(l=>l.id===x.lead)?.name||'Customer')),...visits.slice(0,5).map(x=>'Visit: '+(db.leads.find(l=>l.id===x.lead)?.name||'Customer'))];
  const body='आज '+followups.length+' Follow-up और '+visits.length+' Site Visit हैं। '+(lines.join(' | ')||'CRM खोलकर आज के काम देखें।');
  await plugin.schedule({notifications:[{id,title:'S.R. Developers — आज का Morning Work Plan',body:body.slice(0,500),smallIcon:'ic_launcher',sound:'default',channelId:'crm-reminders',schedule:{at,allowWhileIdle:true},extra:{type:'morning-summary'}}]});
 }catch(e){console.warn('Morning summary schedule:',e)}
}
function contactActions(phone,leadId){const digits=String(phone||'').replace(/[^0-9]/g,'');return '<div class="contact-actions"><a href="tel:'+encodeURIComponent(phone||'')+'" data-lead="'+String(leadId||'')+'" onclick="logCall(this.dataset.lead)">📞 Call</a><a target="_blank" rel="noopener" href="https://wa.me/'+digits+'">WhatsApp</a></div>'}
window.logCall=id=>{const lead=db.leads.find(x=>x.id===id);if(!lead)return;db.callLogs.push({id:crypto.randomUUID(),lead:id,phone:lead.phone,at:new Date().toISOString(),type:'dialer_opened'});save();render()};
function render(){
$('pBooking').innerHTML=db.bookings.map(b=>'<option value="'+b.id+'">'+esc(nameOf(b.lead))+' · '+esc(b.project)+' · '+esc(b.unit)+'</option>').join('');
$('lPartner').innerHTML='<option value="">Direct / कोई Partner नहीं</option>'+db.partners.filter(p=>p.status==='Active').map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+esc(p.phone)+'</option>').join('');$('payPartner').innerHTML=db.partners.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');$('payBooking').innerHTML=db.bookings.map(b=>'<option value="'+b.id+'">'+esc(nameOf(b.lead))+' · '+esc(b.project)+' · '+esc(b.unit)+'</option>').join('');$('shareLead').innerHTML=db.leads.map(l=>'<option value="'+l.id+'">'+esc(l.name)+' — '+esc(l.phone)+'</option>').join('');
$('shareProject').innerHTML=PROJECTS.map(p=>'<option>'+esc(p)+'</option>').join('');$('sendProject').innerHTML=PROJECTS.map(p=>'<option>'+esc(p)+'</option>').join('');
$('resourceList').innerHTML=(db.resources||[]).map((r,i)=>'<div class="resource-card">'+(r.mimeType&&r.mimeType.startsWith('image/')?'<img src="'+esc(r.url)+'" alt="'+esc(r.label||r.project)+'">':r.mimeType&&r.mimeType.startsWith('video/')?'<video src="'+esc(r.url)+'" controls preload="metadata"></video>':'<div class="resource-thumb">📁</div>')+'<div class="resource-info"><b>'+esc(r.project)+' · '+esc(r.type)+'</b><small>'+esc(r.label||r.fileName||r.url)+'</small><button class="tiny secondary" onclick="useResource('+i+')">इस Resource को चुनें</button><button class="tiny danger" onclick="deleteResource('+i+')">Delete</button></div></div>').join('')||'<p class="muted">अभी कोई फोटो, वीडियो या brochure सेव नहीं है।</p>';
 $('leadCount').textContent=db.leads.length;$('followCount').textContent=db.followups.filter(x=>x.when.slice(0,10)===today()).length;$('visitCount').textContent=db.visits.length;$('bookingCount').textContent=db.bookings.length;
$('recent').innerHTML=db.leads.slice(-5).reverse().map(l=>'<div class="item"><b>'+esc(l.name)+'</b><small>ग्राहक मोबाइल: '+esc(l.phone)+' · '+esc(l.project)+' · '+esc(l.status)+'</small><small>Owner: '+esc(leadOwnerLabel(l))+' · Creator: '+esc(leadCreatorLabel(l))+' · '+esc(leadHierarchyLabel(l))+'</small></div>').join('')||'<p class="muted">अभी कोई Lead नहीं है।</p>';
const q=($('leadSearch').value||'').toLowerCase();$('leadList').innerHTML=db.leads.slice().reverse().filter(l=>(l.name+l.phone+l.project+' '+leadOwnerLabel(l)+' '+leadCreatorLabel(l)).toLowerCase().includes(q)).map(l=>'<div class="item"><b>'+esc(l.name)+' <span class="tag">'+esc(l.status)+'</span></b>'+contactActions(l.phone,l.id)+'<small>ग्राहक मोबाइल: '+esc(l.phone)+' · '+esc(l.project)+' · '+esc(l.source)+' · '+(l.date?'Follow-up '+esc(l.date):'No follow-up')+'</small><div class="item-meta"><b>Lead Owner:</b> '+esc(leadOwnerLabel(l))+' <span>·</span> <b>Entry By:</b> '+esc(leadCreatorLabel(l))+'<br><b>Reporting:</b> '+esc(leadHierarchyLabel(l))+'</div><p>'+esc(l.notes)+'</p><button class="tiny danger" onclick="del(\'leads\',\''+l.id+'\')">Delete</button></div>').join('')||'<p class="muted">कोई रिकॉर्ड नहीं।</p>';
leadOptions('fLead');leadOptions('vLead');leadOptions('bLead');$('aStaff').innerHTML=db.staff.map(x=>'<option value="'+x.id+'">'+esc(employeeCodeOf(x))+' · '+esc(x.name)+' — '+esc(x.role)+'</option>').join('');
$('followList').innerHTML=list('followups',x=>'<b>'+esc(nameOf(x.lead))+'</b>'+contactActions(db.leads.find(l=>l.id===x.lead)?.phone||'',x.lead)+'<small>'+esc(x.when)+' · '+esc(x.notes)+' · '+(x.calledAt?'✓ Complete':'Pending')+'</small>'+(x.calledAt?'':'<button class="tiny secondary" onclick="markFollowupDone(\''+x.id+'\')">Mark Complete</button>'));
$('visitList').innerHTML=list('visits',x=>'<b>'+esc(nameOf(x.lead))+'</b><small>'+esc(x.when)+' · '+esc(x.project)+' · '+esc(x.assigned)+'</small>');
$('bookingList').innerHTML=list('bookings',x=>'<b>'+esc(nameOf(x.lead))+'</b><small>'+esc(x.project)+' · '+esc(x.unit)+' · ₹'+esc(x.amount)+' · '+esc(x.date)+' · '+esc(x.status)+'</small>');
$('staffList').innerHTML=db.staff.map(x=>'<div class="item"><b>'+esc(employeeCodeOf(x))+' · '+esc(x.name)+' <span class="tag">'+esc(x.role)+'</span></b><small>'+esc(x.phone)+' · Monthly booking target: '+esc(x.target)+'</small></div>').join('')||'<p class="muted">Staff records अभी नहीं हैं।</p>';
$('messageList').innerHTML=db.messages.slice().reverse().map(x=>'<div class="item">'+esc(x.text)+'<small>'+esc(x.at)+'</small></div>').join('');$('attendanceList').innerHTML=db.attendance.slice().reverse().map(x=>'<div class="item"><b>'+esc(employeeCodeOf(db.staff.find(s=>s.id===x.staff)||{name:'Staff'}))+' · '+esc(db.staff.find(s=>s.id===x.staff)?.name||'Staff')+'</b><small>'+esc(x.date)+' · In: '+esc(x.in||'—')+' · Out: '+esc(x.out||'—')+'</small></div>').join('')||'<p class="muted">Attendance अभी दर्ज नहीं है।</p>';
const staffRows=(db.staff||[]).filter(x=>x.active!==false).map(st=>{
 const staffName=String(st.name||'').trim().toLowerCase();
 const assignedLeads=db.leads.filter(l=>String(l.assigned||'').trim().toLowerCase()===staffName||l.owner_id===st.id||l.ownerId===st.id);
 const ids=new Set(assignedLeads.map(l=>l.id));
 let calls=0,follow=0,visits=0,bookings=0;
 for(const x of db.callLogs)if(ids.has(x.lead))calls++;
 for(const x of db.followups)if(ids.has(x.lead))follow++;
 for(const x of db.visits)if(ids.has(x.lead))visits++;
 for(const x of db.bookings)if(ids.has(x.lead))bookings++;
 return '<tr><td><b>'+esc(employeeCodeOf(st))+'</b><br>'+esc(st.name)+'</td><td>'+esc(st.role)+'</td><td>'+assignedLeads.length+'</td><td>'+calls+'</td><td>'+follow+'</td><td>'+visits+'</td><td>'+bookings+'</td></tr>';
 }).join('');
$('reportStats').innerHTML='<p>Total Leads: <b>'+db.leads.length+'</b></p><p>Call attempts (dialer opened): <b>'+db.callLogs.length+'</b></p><p>Follow-ups: <b>'+db.followups.length+'</b></p><p>Site Visits: <b>'+db.visits.length+'</b></p><p>Bookings: <b>'+db.bookings.length+'</b></p><p>Staff: <b>'+db.staff.length+'</b></p><h3>कर्मचारी-wise Performance</h3><div class="table-wrap"><table><thead><tr><th>कर्मचारी</th><th>पद</th><th>Leads</th><th>Call Attempts</th><th>Follow-ups</th><th>Visits</th><th>Bookings</th></tr></thead><tbody>'+staffRows+'</tbody></table></div><p class="muted">Calls का अर्थ CRM से Dialer खोला गया है; connected call duration का दावा नहीं है। रिपोर्ट उपलब्ध/अनुमत डेटा पर आधारित है।</p>';
const iq=($('inventorySearch')?.value||'').toLowerCase(), ist=$('inventoryStatusFilter')?.value||'All';$('inventoryList').innerHTML=db.inventory.slice().reverse().filter(x=>(String(x.project)+' '+String(x.unit)+' '+String(x.block)).toLowerCase().includes(iq)&&(ist==='All'||x.status===ist)).map(x=>'<div class="item"><b>'+esc(x.project)+' · '+esc(x.unit)+' <span class="tag">'+esc(x.status)+'</span></b><small>'+esc(x.block)+' · '+esc(x.size)+' गज · ₹'+esc(x.rate)+'/गज · Plot value approx. ₹'+(Number(x.size||0)*Number(x.rate||0)).toLocaleString('en-IN')+'</small></div>').join('')||'<p class="muted">इस filter में कोई Inventory unit नहीं मिली।</p>';
$('paymentList').innerHTML=db.payments.slice().reverse().map(x=>'<div class="item"><b>₹'+esc(x.amount)+' · '+esc(x.mode)+'</b><small>'+esc(nameOf(db.bookings.find(b=>b.id===x.booking)?.lead||''))+' · '+esc(x.date)+' · Receipt: '+esc(x.ref)+' · Next due: '+esc(x.due)+'</small></div>').join('')||'<p class="muted">Payment entries अभी नहीं हैं।</p>';
$('partnerList').innerHTML=db.partners.slice().reverse().map(x=>{const pl=db.leads.filter(l=>l.partnerId===x.id),pb=db.bookings.filter(b=>pl.some(l=>l.id===b.lead)),paid=db.partnerPayouts.filter(p=>p.partner===x.id&&p.status==='Paid').reduce((a,p)=>a+Number(p.amount||0),0),pending=db.partnerPayouts.filter(p=>p.partner===x.id&&p.status!=='Paid').reduce((a,p)=>a+Number(p.amount||0),0);return '<div class="item"><b>'+esc(x.name)+' <span class="tag">'+esc(x.status)+'</span></b><small>'+esc(x.type||'Broker')+' · '+esc(x.firm)+' · '+esc(x.phone)+' · '+esc(x.project)+' · Commission '+esc(x.commission)+'%</small><small>Area: '+esc(x.area)+' · Manager: '+esc(x.manager)+' · Leads: '+pl.length+' · Bookings: '+pb.length+' · Paid: ₹'+paid+' · Pending: ₹'+pending+'</small></div>'}).join('')||'<p class="muted">Partner अभी नहीं हैं।</p>';$('payoutList').innerHTML=db.partnerPayouts.slice().reverse().map(p=>'<div class="item"><b>₹'+esc(p.amount)+' · '+esc(p.status)+'</b><small>'+esc(db.partners.find(x=>x.id===p.partner)?.name||'Partner')+' · '+esc(nameOf(db.bookings.find(x=>x.id===p.booking)?.lead||''))+' · '+esc(p.date||'Date pending')+' · '+esc(p.ref)+' · '+esc(p.notes)+'</small></div>').join('')||'<p class="muted">अभी कोई commission payout दर्ज नहीं है।</p>';
$('projectList').innerHTML=PROJECTS.map((p,i)=>{const media=(db.resources||[]).filter(r=>r.project===p);const photos=media.filter(r=>(r.mimeType||'').startsWith('image/')).length;const videos=media.filter(r=>(r.mimeType||'').startsWith('video/')).length;return '<div class="item project-library-card"><b>'+esc(p)+(i===6?' <span class="tag">Delivered</span>':'')+'</b><small>Leads: '+db.leads.filter(l=>l.project===p).length+' · Photos: '+photos+' · Videos: '+videos+' · Other resources: '+(media.length-photos-videos)+'</small><button class="tiny secondary" onclick="openProjectMedia('+i+')">इस Project की Media Library खोलें</button></div>'}).join('');}
window.openProjectMedia=i=>{const p=PROJECTS[Number(i)];if(!p)return;go('sharing');$('shareProject').value=p;$('resourceType').focus()};
function profileById(id){return (window.srEmployeeDirectory||[]).find(p=>p.id===id)}function leadOwnerProfile(l){if(l.owner_id||l.ownerId)return profileById(l.owner_id||l.ownerId);const assigned=String(l.assigned||'').trim().toLowerCase();return (window.srEmployeeDirectory||[]).find(p=>String(p.full_name||'').trim().toLowerCase()===assigned)||window.srCurrentProfile||null}function leadOwnerLabel(l){const p=leadOwnerProfile(l);return p?(p.full_name+' ('+String(p.role||'').replace('_',' ')+')'):(l.assigned||'Unassigned / पुष्टि बाकी')}function leadCreatorLabel(l){const p=profileById(l.created_by||l.createdById);return p?.full_name||l.created_by_name||'पुराना रिकॉर्ड — Creator उपलब्ध नहीं'}function leadHierarchyLabel(l){const p=leadOwnerProfile(l);if(!p)return 'Reporting जानकारी उपलब्ध नहीं';const all=window.srEmployeeDirectory||[];const m=all.find(x=>x.id===p.manager_id);const tl=all.find(x=>x.id===p.team_leader_id);return 'Manager: '+(m?.full_name||'—')+' · Team Leader: '+(tl?.full_name|| (p.role==='team_leader'?p.full_name:'—'))}function nameOf(id){return db.leads.find(l=>l.id===id)?.name||'Lead deleted'}function employeeCodeOf(st){const directory=window.srEmployeeDirectory||[];const match=directory.find(p=>p.id===st.id||String(p.full_name||'').trim().toLowerCase()===String(st.name||'').trim().toLowerCase());return match?.employee_code||st.employee_code||'ID pending'}function list(key,fn){return db[key].slice().reverse().map(x=>'<div class="item">'+fn(x)+'<button class="tiny danger" onclick="del(\''+key+'\',\''+x.id+'\')">Delete</button></div>').join('')||'<p class="muted">अभी कोई रिकॉर्ड नहीं।</p>'}window.markFollowupDone=id=>{const item=db.followups.find(x=>x.id===id);if(!item||item.calledAt)return;item.calledAt=new Date().toISOString();cancelReminder('followup',id);save();render();};window.del=async(k,id)=>{if(!confirm('इस रिकॉर्ड को हटाएँ?'))return;if(k==='followups')cancelReminder('followup',id);if(k==='visits')cancelReminder('visit',id);db[k]=db[k].filter(x=>x.id!==id);save();render();if(window.srCloudDelete){try{await window.srCloudDelete(k,id);alert('रिकॉर्ड CRM Cloud से भी हट गया।')}catch(err){alert('रिकॉर्ड इस डिवाइस से हट गया, लेकिन Cloud Delete pending है: '+(err.message||err)+'. इंटरनेट चालू रखकर ऐप refresh करें।')}}};
$('leadForm').onsubmit=e=>{
 e.preventDefault();
 const actor=window.srCurrentProfile||{},directory=window.srEmployeeDirectory||[];
 const role=String(actor.role||'').toLowerCase();
 const requestedName=$('lAssigned').value.trim();
 const requestedProfile=directory.find(p=>String(p.full_name||'').trim().toLowerCase()===requestedName.toLowerCase()&&p.is_active);
 let assignedProfile=actor.id?directory.find(p=>p.id===actor.id)||actor:null;
 if(role==='admin') assignedProfile=requestedProfile||assignedProfile;
 else if(role==='manager') assignedProfile=requestedProfile&&requestedProfile.manager_id===actor.id?requestedProfile:assignedProfile;
 else if(role==='team_leader') assignedProfile=requestedProfile&&requestedProfile.team_leader_id===actor.id?requestedProfile:assignedProfile;
 // Sales Executives and any unrecognized roles can only create leads assigned to themselves.
 const assignedName=assignedProfile?.full_name||actor.full_name||'';
 const duplicate=db.leads.find(x=>String(x.phone||'').replace(/\D/g,'').slice(-10)===String($('lPhone').value||'').replace(/\D/g,'').slice(-10));
 if(!String($('lName').value||'').trim()||String($('lPhone').value||'').replace(/\D/g,'').length<10){alert('ग्राहक का नाम और सही 10 अंकों का मोबाइल नंबर भरें।');return;}
 db.leads.push({id:crypto.randomUUID(),name:$('lName').value.trim(),phone:$('lPhone').value.trim(),project:$('lProject').value,source:$('lSource').value,partnerId:$('lPartner').value||'',budget:$('lBudget').value,minBudget:$('lMinBudget').value,whatsapp:$('lWhatsapp').value,city:$('lCity').value,address:$('lAddress').value,occupation:$('lOccupation').value,company:$('lCompany').value,propertyType:$('lType').value,size:$('lSize').value,purpose:$('lPurpose').value,timeline:$('lTimeline').value,payment:$('lPayment').value,priority:$('lPriority').value,campaign:$('lCampaign').value,status:$('lStatus').value,date:$('lDate').value,assigned:assignedName,owner_id:assignedProfile?.id||actor.id||null,created_by:actor.id||null,created_by_name:actor.full_name||'',created_by_role:actor.role||'',notes:$('lNotes').value,duplicateOf:duplicate?.id||null,created:today()});
 e.target.reset();setDefaultPlannerTimes();save();render();alert(duplicate?'Lead सेव हो गई। इस मोबाइल नंबर की पुरानी Lead भी मौजूद है; duplicate alert के साथ नया रिकॉर्ड रखा गया।':'Lead सेव हो गई।');
};
function setDefaultPlannerTimes(){const now=new Date();now.setMinutes(Math.ceil((now.getMinutes()+15)/5)*5,0,0);const value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')+'T'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');if(!$('fWhen').value)$('fWhen').value=value;if(!$('vWhen').value)$('vWhen').value=value;}setDefaultPlannerTimes();
$('followForm').onsubmit=async e=>{e.preventDefault();const item={id:crypto.randomUUID(),lead:$('fLead').value,when:$('fWhen').value,notes:$('fNotes').value,reminder:Number($('fReminder').value)};if(!item.lead){alert('पहले Lead जोड़ें।');return}db.followups.push(item);save();e.target.reset();setDefaultPlannerTimes();render();let result={ok:true,skipped:true};if(item.reminder!==-1){try{const permitted=await askReminderPermission();result=permitted?await scheduleReminder('followup',item,item.reminder):{ok:false,reason:'permission'}}catch(err){console.warn('Follow-up reminder setup failed; record remains saved:',err)}}alert(result.ok?(result.skipped?'Follow-up सेव हो गया।':'Follow-up सेव हो गया और reminder schedule हो गया।'):'Follow-up CRM में सेव हो गया। Notification permission बंद है, इसलिए alarm नहीं लगा। Android Settings > Apps > S.R. DEVELOPERS CRM > Notifications को Allow करें, फिर नया reminder सेट करें। रिकॉर्ड सुरक्षित है।');};
$('visitForm').onsubmit=async e=>{e.preventDefault();const item={id:crypto.randomUUID(),lead:$('vLead').value,when:$('vWhen').value,project:$('vProject').value,assigned:$('vAssigned').value,notes:$('vNotes').value,reminder:Number($('vReminder').value)};if(!item.lead){alert('पहले Lead जोड़ें।');return}db.visits.push(item);save();e.target.reset();render();let result={ok:true,skipped:true};if(item.reminder!==-1){try{const permitted=await askReminderPermission();result=permitted?await scheduleReminder('visit',item,item.reminder):{ok:false,reason:'permission'}}catch(err){console.warn('Visit reminder setup failed; record remains saved:',err)}}alert(result.ok?(result.skipped?'Site Visit सेव हो गई।':'Site Visit सेव हो गई और reminder schedule हो गया।'):'Site Visit CRM में सेव हो गई। Notification permission बंद है, इसलिए alarm नहीं लगा। Android Settings > Apps > S.R. DEVELOPERS CRM > Notifications को Allow करें, फिर नया reminder सेट करें। रिकॉर्ड सुरक्षित है।');};
$('bookingForm').onsubmit=e=>{
 e.preventDefault();
 const project=$('bProject').value, unit=$('bUnit').value.trim(), status=$('bStatus').value;
 if(!unit){alert('Plot / Unit नंबर भरें।');return}
 const conflict=db.bookings.find(x=>x.project===project&&String(x.unit||'').trim().toLowerCase()===unit.toLowerCase()&&!['cancelled','rejected','lost'].includes(String(x.status||'').toLowerCase()));
 if(conflict){alert('यह Plot / Unit पहले से Booking में दर्ज है। दोहरी Booking रोक दी गई है।');return}
 const inv=db.inventory.find(x=>x.project===project&&String(x.unit||'').trim().toLowerCase()===unit.toLowerCase());
 if(inv&&String(inv.status||'').toLowerCase()==='booked'){alert('Inventory में यह Plot पहले से Booked है।');return}
 db.bookings.push({id:crypto.randomUUID(),lead:$('bLead').value,project,unit,amount:$('bAmount').value,date:$('bDate').value,status});
 if(inv&&['booked','confirmed','reserved'].includes(String(status).toLowerCase()))inv.status='Booked';
 e.target.reset();save();render();alert('Booking सेव हो गई।');
};
$('checkIn').onclick=()=>attendanceAction('in');$('checkOut').onclick=()=>attendanceAction('out');function attendanceAction(kind){const staff=$('aStaff').value,date=$('aDate').value||today();if(!staff){alert('पहले Team में कर्मचारी जोड़ें।');return}let row=db.attendance.find(x=>x.staff===staff&&x.date===date);if(!row){row={id:crypto.randomUUID(),staff,date,in:'',out:''};db.attendance.push(row)}if(kind==='in'){if(row.in){alert('आज Check In पहले से दर्ज है।');return}row.in=new Date().toLocaleTimeString('en-IN')}else{if(!row.in){alert('पहले Check In करें।');return}if(row.out){alert('आज Check Out पहले से दर्ज है।');return}row.out=new Date().toLocaleTimeString('en-IN')}save();render();alert(kind==='in'?'Check In दर्ज हो गया।':'Check Out दर्ज हो गया।')}
$('staffForm').onsubmit=e=>{e.preventDefault();db.staff.push({id:crypto.randomUUID(),name:$('sName').value,phone:$('sPhone').value,role:$('sRole').value,target:$('sTarget').value});e.target.reset();save();render()};
$('messageForm').onsubmit=e=>{e.preventDefault();db.messages.push({text:$('messageText').value,at:new Date().toLocaleString('en-IN')});e.target.reset();save();render()};

$('inventoryForm').onsubmit=e=>{e.preventDefault();const unit=$('iUnit').value.trim();if(db.inventory.some(x=>x.project===$('iProject').value&&x.unit.toLowerCase()===unit.toLowerCase())){alert('यह Plot / Unit पहले से दर्ज है।');return}db.inventory.push({id:crypto.randomUUID(),project:$('iProject').value,unit,size:$('iSize').value,rate:$('iRate').value,status:$('iStatus').value,block:$('iBlock').value});e.target.reset();save();render();alert('Inventory unit सेव हो गई।')};
$('paymentForm').onsubmit=e=>{e.preventDefault();if(!$('pBooking').value){alert('पहले Booking दर्ज करें।');return}db.payments.push({id:crypto.randomUUID(),booking:$('pBooking').value,amount:$('pAmount').value,date:$('pDate').value,mode:$('pMode').value,ref:$('pRef').value,due:$('pDue').value});e.target.reset();save();render();alert('Payment entry सेव हो गई।')};
$('partnerForm').onsubmit=e=>{e.preventDefault();db.partners.push({id:crypto.randomUUID(),name:$('cpName').value,phone:$('cpPhone').value,firm:$('cpFirm').value,type:$('cpType').value,manager:$('cpManager').value,area:$('cpArea').value,kycRef:$('cpKyc').value,commission:$('cpCommission').value,project:$('cpProject').value,status:$('cpStatus').value});e.target.reset();save();render();alert('Channel partner सेव हो गया।')};$('payoutForm').onsubmit=e=>{e.preventDefault();db.partnerPayouts.push({id:crypto.randomUUID(),partner:$('payPartner').value,booking:$('payBooking').value,amount:$('payAmount').value,status:$('payStatus').value,date:$('payDate').value,ref:$('payRef').value,notes:$('payNotes').value});e.target.reset();save();render();alert('Broker commission entry सेव हो गई।')};
let leadSearchTimer; $('leadSearch').oninput=()=>{clearTimeout(leadSearchTimer);leadSearchTimer=setTimeout(render,180)};$('export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.download='sr-developers-crm-backup.json';a.click();URL.revokeObjectURL(a.href)};
$('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const x=JSON.parse(await f.text());if(!x.leads||!x.staff)throw Error();db=x;save();render();alert('Backup restore हो गया।')}catch{alert('यह backup file सही नहीं है।')}};
window.srDb=db;window.srRender=render;window.addEventListener('sr-cloud-ready',()=>{if(window.srCurrentProfile)scheduleMorningSummary()});window.addEventListener('sr-auth-ready',async()=>{try{const plugin=getLocalNotifications();if(plugin){const permitted=await askReminderPermission();if(permitted)await scheduleMorningSummary();}else await scheduleMorningSummary();}catch(e){console.warn('Notification startup check:',e)}});
window.srSetProfiles=profiles=>{
 const local=String(window.srCurrentProfile?.role||'').trim().toLowerCase()==='admin'?(db.staff||[]).filter(x=>!x.profileId):[];
 const mapped=(profiles||[]).map(p=>({id:p.id,profileId:p.id,name:p.full_name||p.email||'Staff',phone:p.phone||'',role:p.role==='sales_executive'?'Sales Executive':p.role==='team_leader'?'Team Leader':p.role==='manager'?'Manager':'Admin',target:'',managerId:p.manager_id||'',managerName:(profiles||[]).find(m=>m.id===p.manager_id)?.full_name||'',active:p.is_active!==false}));
 db.staff=[...local,...mapped];render();
};
render();
async function uploadProjectMedia(file,project,type,label){
 const client=window.srSupabase;
 if(!client){throw new Error('Cloud Storage अभी configure नहीं है। पहले Supabase Storage migration चलाएँ।')}
 if(!file)throw new Error('पहले फोटो या वीडियो चुनें।');
 if(!/^image\//.test(file.type)&&!/^video\//.test(file.type))throw new Error('केवल फोटो या वीडियो अपलोड करें।');
 if(file.size>100*1024*1024)throw new Error('फाइल 100 MB से छोटी होनी चाहिए।');
 const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
 const path=project.replace(/[^a-zA-Z0-9_-]/g,'_')+'/'+Date.now()+'_'+safeName;
 const {data,error}=await client.storage.from('project-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
 if(error)throw error;
 const {data:pub}=client.storage.from('project-media').getPublicUrl(data.path);
 return {project,type,url:pub.publicUrl,label:label||file.name,fileName:file.name,mimeType:file.type,size:file.size,storagePath:data.path};
}
$('resourceForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{db.resources=db.resources||[];const file=$('resourceFile')?.files?.[0];let item;if(file){item=await uploadProjectMedia(file,$('shareProject').value,$('resourceType').value,$('resourceLabel').value.trim());}else{const url=$('resourceUrl').value.trim();if(!url)throw new Error('फोटो/वीडियो चुनें या Link URL डालें।');item={project:$('shareProject').value,type:$('resourceType').value,url,label:$('resourceLabel').value.trim()};}db.resources.push(item);save();e.target.reset();render();alert('Project Resource सेव हो गया।');}catch(err){alert('Upload नहीं हुआ: '+(err.message||err));}finally{btn.disabled=false;}};
window.useResource=i=>{const r=(db.resources||[])[i];if(!r)return;$('shareProject').value=r.project;$('sendProject').value=r.project;$('resourceType').value=r.type;$('shareType').value=r.type;$('shareUrl').value=r.url;$('resourceLabel').value=r.label||'';$('shareMessage').value=resourceMessage(r);};
window.deleteResource=async i=>{if(!confirm('इस resource link को हटाएँ?'))return;const item=db.resources[i];db.resources.splice(i,1);save();render();if(item?.id&&window.srCloudDelete){try{await window.srCloudDelete('resources',item.id)}catch(err){alert('Cloud delete pending: '+(err.message||err))}}};
function resourceMessage(r){return 'नमस्ते! S.R. Developers की ओर से '+r.project+' की '+r.type+' जानकारी आपके लिए। '+(r.label?r.label+' ':'')+'देखने के लिए लिंक खोलें: '+r.url}
$('shareForm').onsubmit=async e=>{e.preventDefault();const l=db.leads.find(x=>x.id===$('shareLead').value);if(!l){alert('पहले ग्राहक की Lead सेव करें।');return}const phone=String(l.whatsapp||l.phone||'').replace(/[^0-9]/g,'');if(!phone){alert('ग्राहक का WhatsApp नंबर दर्ज करें।');return}const r=(db.resources||[]).find(x=>x.url===$('shareUrl').value.trim());const msg=$('shareMessage').value.trim()||('नमस्ते '+l.name+', S.R. Developers की ओर से '+$('sendProject').value+' की '+$('shareType').value+' जानकारी: '+$('shareUrl').value.trim());if(r?.storagePath&&r.mimeType&&navigator.canShare&&navigator.share){try{const response=await fetch(r.url);const blob=await response.blob();const file=new File([blob],r.fileName||'project-media', {type:r.mimeType});if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:r.project,text:msg});return;}}catch(err){if(err.name==='AbortError')return;console.warn('Native media share fallback:',err);}}window.open('https://wa.me/'+(phone.length===10?'91'+phone:phone)+'?text='+encodeURIComponent(msg),'_blank','noopener');};

