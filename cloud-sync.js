(() => {
  const types={leads:'lead',followups:'followup',visits:'visit',bookings:'booking',attendance:'attendance',callLogs:'call_log',inventory:'inventory',payments:'payment',partners:'partner',partnerPayouts:'partner_payout',messages:'message',resources:'resource'};
  const reverse=Object.fromEntries(Object.entries(types).map(([k,v])=>[v,k]));
  let client=null,user=null,profile=null,ready=false,queue=Promise.resolve(),profileByName=new Map(),accessibleOwnerIds=new Set();
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
  const isAdmin=()=>String(profile?.role||'').trim().toLowerCase()==='admin';
  const canWriteOwner=ownerId=>!!ownerId&&(isAdmin()||ownerId===user?.id||accessibleOwnerIds.has(ownerId));
  async function persist(db){
    if(!ready||!client||!user)return;
    const rows=[];
    for(const [key,type] of Object.entries(types)){
      for(const raw of (db[key]||[])){
        if(!raw.id)raw.id=uuid();
        const item=raw;
        const ownerId=ownerFor(key,item,db);
        // Never try to upload another employee's locally cached records.
        // Supabase RLS allows only the signed-in user, Admin, or visible team owners.
        if(!canWriteOwner(ownerId))continue;
        if(item.created_by&&item.created_by!==user.id&&!isAdmin())continue;
        rows.push({id:item.id,record_type:type,payload:item,owner_id:ownerId,created_by:isAdmin()?(item.created_by||user.id):user.id,updated_at:new Date().toISOString()});
      }
    }
    if(!rows.length)return;
    // Keep the queue usable after a failed write, but never report a failed
    // cloud write as a successful sync to the caller.
    const task=queue.catch(()=>{}).then(async()=>{
      const {error}=await client.from('crm_records').upsert(rows,{onConflict:'id'});
      if(error)throw error;
      return {synced:rows.length};
    });
    queue=task;
    try {
      return await task;
    } catch(err) {
      console.error('CRM cloud sync:',err);
      window.dispatchEvent(new CustomEvent('sr-cloud-error',{detail:err?.message||String(err)}));
      throw err;
    }
  }
  async function init(supabase,userData,profileData){
    client=supabase;user=userData;profile=profileData;ready=false;
    window.srCloudReady=false;
    const {data:profiles,error:profilesError}=await client.from('profiles').select('id,employee_code,full_name,role,manager_id,team_leader_id,is_active').eq('is_active',true);
    if(profilesError) throw new Error('Staff directory load failed: '+profilesError.message);
    profileByName=new Map((profiles||[]).map(p=>[String(p.full_name||'').trim().toLowerCase(),p.id]));
    window.srEmployeeDirectory=profiles||[];
    // Client writes are limited to self and the authenticated user's reporting tree.
    // Supabase RLS remains the authoritative access-control boundary.
    const currentRole=String(profile?.role||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    const allowed=new Set([user.id]);
    if(currentRole==='admin') (profiles||[]).forEach(p=>allowed.add(p.id));
    else {
      const visible=[...(profiles||[]),{...profile,id:user.id}];
      let changed=true;
      while(changed){
        changed=false;
        for(const p of visible){
          if(allowed.has(p.id))continue;
          const isTeamLeaderMember=currentRole==='team_leader'&&p.team_leader_id===user.id;
          const reportsToVisible=currentRole==='manager'&&(allowed.has(p.manager_id)||allowed.has(p.team_leader_id));
          if(isTeamLeaderMember||reportsToVisible){allowed.add(p.id);changed=true;}
        }
      }
    }
    accessibleOwnerIds=allowed;
    // Load the first page immediately; fetch additional pages only when needed.
    // This avoids a slow unbounded response while preserving every visible CRM record.
    // Keep the login-critical request deliberately small. The remaining records
    // are hydrated after the app is usable, so large CRM histories cannot block login.
    const pageSize=250;
    const first=await client.from('crm_records').select('id,record_type,payload,owner_id,created_by,updated_at').order('id',{ascending:true}).range(0,pageSize-1);
    if(first.error){console.error(first.error);throw new Error('Cloud data load failed: '+first.error.message)}
    const data=[...(first.data||[])];
    const hasMorePages=data.length===pageSize;
    // Recover safely if the app database was not attached to window before login.
    let db=window.srDb;
    if(!db || typeof db!=='object'){
      try { db=JSON.parse(localStorage.getItem('srcrm_v11')||'{}'); } catch (_) { db={}; }
    }
    if(!db || typeof db!=='object' || Array.isArray(db)) db={};
    for(const key of Object.keys(types)) if(!Array.isArray(db[key])) db[key]=[];
    window.srDb=db;
    const seen=new Set();
    // Build per-collection ID indexes once. Repeated Array.findIndex() made
    // cloud hydration quadratic as each employee's CRM history grew.
    const dbIndex=Object.fromEntries(Object.keys(types).map(key=>[
      key,new Map((db[key]||[]).map((item,index)=>[item.id,index]))
    ]));
    for(const row of (data||[])){
      const key=reverse[row.record_type];if(!key)continue;
      db[key]=db[key]||[];
      const payload={...row.payload,id:row.id,owner_id:row.owner_id,created_by:row.created_by};
      const idx=dbIndex[key].get(row.id);
      if(idx!==undefined)db[key][idx]=payload;
      else {dbIndex[key].set(row.id,db[key].length);db[key].push(payload);}
      seen.add(row.id);
    }
    for(const key of Object.keys(types))if(!Array.isArray(db[key]))db[key]=[];
    // Keep locally cached records from other reporting lines out of the active UI.
    // They are quarantined locally (not deleted) and restored automatically for Admin
    // or when the signed-in employee gains legitimate access later.
    const restricted=Array.isArray(db._restrictedCache)?db._restrictedCache:[];
    const restored=[];
    const visibleOwner=(key,item)=>{
      if(isAdmin())return true;
      if(item.created_by===user.id||item.createdById===user.id)return true;
      const byNameLocal=name=>profileByName.get(String(name||'').trim().toLowerCase());
      let owner=item.owner_id||item.ownerId||byNameLocal(item.assigned);
      if(!owner&&['followups','visits','bookings'].includes(key)){
        const lead=(db.leads||[]).find(x=>x.id===item.lead);
        owner=lead?.owner_id||lead?.ownerId||byNameLocal(lead?.assigned)||lead?.created_by;
      }
      return !!owner&&accessibleOwnerIds.has(owner);
    };
    for(const cached of restricted){
      if(types[cached.key]&&cached.item&&visibleOwner(cached.key,cached.item)){
        const list=db[cached.key]||(db[cached.key]=[]);
        if(!list.some(x=>x.id===cached.item.id))list.push(cached.item);
      } else restored.push(cached);
    }
    const nextRestricted=[];
    for(const key of Object.keys(types)){
      const keep=[];
      for(const item of db[key]){
        if(visibleOwner(key,item))keep.push(item);
        else nextRestricted.push({key,item});
      }
      db[key]=keep;
    }
    db._restrictedCache=[...restored,...nextRestricted];
    localStorage.setItem('srcrm_v11',JSON.stringify(db));
    window.srCloudPersist=persist;ready=true;window.srCloudReady=true;
    const loadedCount=data.length;
    // Do not hold the login screen open while uploading old local records.
    // Background migration is safe: only records owned by this user/Admin are queued.
    const backgroundUpload=async()=>{
      const missing=[];let skippedLocal=0;
      for(const [key,type] of Object.entries(types))for(const item of db[key]){
        if(seen.has(item.id))continue;
        const ownerId=ownerFor(key,item,db);
        if(!canWriteOwner(ownerId)||(item.created_by&&item.created_by!==user.id&&!isAdmin())){skippedLocal++;continue;}
        missing.push({id:item.id,record_type:type,payload:item,owner_id:ownerId,created_by:user.id,updated_at:new Date().toISOString()});
      }
      if(missing.length){
        const {error:upErr}=await client.from('crm_records').upsert(missing,{onConflict:'id'});
        if(upErr) throw new Error('Local records background upload failed: '+upErr.message);
      }
      window.dispatchEvent(new CustomEvent('sr-cloud-background-sync',{detail:{uploaded:missing.length,skippedLocal}}));
    };
    setTimeout(()=>backgroundUpload().catch(err=>{
      console.error('CRM background sync:',err);
      window.dispatchEvent(new CustomEvent('sr-cloud-error',{detail:err?.message||String(err)}));
    }),0);
    // Continue loading older pages without blocking login or the first screen.
    if(hasMorePages){
      setTimeout(async()=>{
        let from=pageSize, totalAdded=0;
        try{
          while(true){
            const {data:page,error}=await client.from('crm_records')
              .select('id,record_type,payload,owner_id,created_by,updated_at')
              .order('id',{ascending:true}).range(from,from+pageSize-1);
            if(error)throw new Error('Background cloud data load failed: '+error.message);
            for(const row of (page||[])){
              const key=reverse[row.record_type];if(!key)continue;
              const payload={...row.payload,id:row.id,owner_id:row.owner_id,created_by:row.created_by};
              if(!visibleOwner(key,payload)){
                const stash=db._restrictedCache||(db._restrictedCache=[]);
                if(!stash.some(x=>x.key===key&&x.item?.id===row.id))stash.push({key,item:payload});
                continue;
              }
              const idx=dbIndex[key].get(row.id);
              if(idx!==undefined)db[key][idx]=payload;
              else{dbIndex[key].set(row.id,db[key].length);db[key].push(payload);}
              totalAdded++;
            }
            localStorage.setItem('srcrm_v11',JSON.stringify(db));
            window.srRender?.();
            window.dispatchEvent(new CustomEvent('sr-cloud-progress',{detail:{loaded:loadedCount+totalAdded,totalAdded}}));
            if((page||[]).length<pageSize)break;
            from+=pageSize;
            await new Promise(resolve=>setTimeout(resolve,0));
          }
          window.dispatchEvent(new CustomEvent('sr-cloud-background-complete',{detail:{loaded:loadedCount+totalAdded}}));
        }catch(err){
          console.error('CRM background hydration:',err);
          window.dispatchEvent(new CustomEvent('sr-cloud-error',{detail:err?.message||String(err)}));
        }
      },0);
    }
    window.srRender?.();
    window.dispatchEvent(new CustomEvent('sr-cloud-ready',{detail:{count:loadedCount,uploaded:0,skippedLocal:0,role:profile.role}}));
    return {loaded:loadedCount,uploaded:0,skippedLocal:0,backgroundLoading:hasMorePages};
  }
  window.srCloudInit=init;
  window.addEventListener('online',()=>{if(ready&&window.srDb)persist(window.srDb)});
})();