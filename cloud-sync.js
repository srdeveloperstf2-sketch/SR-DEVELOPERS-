(() => {
  const types={leads:'lead',followups:'followup',visits:'visit',bookings:'booking',attendance:'attendance',callLogs:'call_log',inventory:'inventory',payments:'payment',partners:'partner',partnerPayouts:'partner_payout',messages:'message',resources:'resource'};
  const reverse=Object.fromEntries(Object.entries(types).map(([k,v])=>[v,k]));
  let client=null,user=null,profile=null,ready=false,queue=Promise.resolve(),profileByName=new Map();
  const uuid=()=>crypto.randomUUID();
  const normalize=(item)=>({...item,id:item.id||uuid()});
  function ownerFor(key,item,db){
    const byName=name=>profileByName.get(String(name||'').trim().toLowerCase());
    if(key==='leads') return item.owner_id||item.ownerId||byName(item.assigned)||user.id;
    if(['followups','visits','bookings'].includes(key)){
      const lead=(db.leads||[]).find(x=>x.id===item.lead);
      return item.owner_id||item.ownerId||(lead?(lead.owner_id||lead.ownerId||byName(lead.assigned)):null)||user.id;
    }
    return item.owner_id||item.ownerId||user.id;
  }
  async function persist(db){
    if(!ready||!client||!user)return;
    const rows=[];
    for(const [key,type] of Object.entries(types)){
      for(const raw of (db[key]||[])){
        if(!raw.id)raw.id=uuid();
        const item=raw;
        const ownerId=ownerFor(key,item,db);
        rows.push({id:item.id,record_type:type,payload:item,owner_id:ownerId,created_by:item.created_by||user.id,updated_at:new Date().toISOString()});
      }
    }
    if(!rows.length)return;
    queue=queue.then(async()=>{
      const {error}=await client.from('crm_records').upsert(rows,{onConflict:'id'});
      if(error)throw error;
    }).catch(err=>{console.error('CRM cloud sync:',err);window.dispatchEvent(new CustomEvent('sr-cloud-error',{detail:err.message}));});
    return queue;
  }
  async function init(supabase,userData,profileData){
    client=supabase;user=userData;profile=profileData;ready=false;
    window.srCloudReady=false;
    const {data:profiles}=await client.from('profiles').select('id,employee_code,full_name,role,manager_id,team_leader_id,is_active').eq('is_active',true);
    profileByName=new Map((profiles||[]).map(p=>[String(p.full_name||'').trim().toLowerCase(),p.id]));\n    window.srEmployeeDirectory=profiles||[];
    const {data,error}=await client.from('crm_records').select('id,record_type,payload,owner_id,created_by,updated_at');
    if(error){console.error(error);throw new Error('Cloud data load failed: '+error.message)}
    // Recover safely if the app database was not attached to window before login.
    let db=window.srDb;
    if(!db || typeof db!=='object'){
      try { db=JSON.parse(localStorage.getItem('srcrm_v11')||'{}'); } catch (_) { db={}; }
    }
    if(!db || typeof db!=='object' || Array.isArray(db)) db={};
    for(const key of Object.keys(types)) if(!Array.isArray(db[key])) db[key]=[];
    window.srDb=db;
    const seen=new Set();
    for(const row of (data||[])){
      const key=reverse[row.record_type];if(!key)continue;
      db[key]=db[key]||[];
      const payload={...row.payload,id:row.id,owner_id:row.owner_id,created_by:row.created_by};
      const idx=db[key].findIndex(x=>x.id===row.id);
      if(idx>=0)db[key][idx]=payload;else db[key].push(payload);
      seen.add(row.id);
    }
    for(const key of Object.keys(types))if(!Array.isArray(db[key]))db[key]=[];
    localStorage.setItem('srcrm_v11',JSON.stringify(db));
    window.srCloudPersist=persist;ready=true;window.srCloudReady=true;
    const missing=[];
    for(const [key,type] of Object.entries(types))for(const item of db[key])if(!seen.has(item.id))missing.push({id:item.id,record_type:type,payload:item,owner_id:ownerFor(key,item,db),created_by:user.id,updated_at:new Date().toISOString()});
    if(missing.length){const {error:upErr}=await client.from('crm_records').upsert(missing,{onConflict:'id'});if(upErr)throw new Error('Local records cloud upload failed: '+upErr.message)}
    window.srRender?.();
    window.dispatchEvent(new CustomEvent('sr-cloud-ready',{detail:{count:(data||[]).length,uploaded:missing.length,role:profile.role}}));
    return {loaded:(data||[]).length,uploaded:missing.length};
  }
  window.srCloudInit=init;
  window.addEventListener('online',()=>{if(ready&&window.srDb)persist(window.srDb)});
})();