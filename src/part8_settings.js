/* ============================================================================
   PART 8 — Settings: shop/BIR, portal, commission, parts server, bays,
   checkpoints, backup/clear
   ========================================================================== */

VIEWS.settings = function(){
  var sh=S.shop;
  var bays=S.bays.map(function(b){return '<span class="tagx">'+esc(b.name)+'<button title="Rename" onclick="renameBay(\''+b.id+'\')">✎</button><button title="Remove" onclick="delBay(\''+b.id+'\')">✕</button></span>';}).join('');
  var cps=(sh.checkpoints||[]).map(function(c,i){return '<span class="tagx">'+esc(c)+'<button onclick="delCheckpoint('+i+')">✕</button></span>';}).join('');
  var sampleQuery="SELECT part_no AS partNo, description AS name, srp AS price,\n       buying_price AS cost, quantity AS stock, min_qty AS reorder\nFROM parts;";
  var sampleJSON='[\n  {"partNo":"OF-1042","name":"Oil Filter","price":220,"cost":120,"stock":24,"reorder":6}\n]';
  return '<div class="page"><div class="page-head"><h1>Settings</h1></div>'+
  '<div class="cols"><div class="colmain">'+
    '<div class="card"><h2>Shop & BIR details</h2><div class="grid2">'+
      field('Shop name','<input id="shName" value="'+attr(sh.name)+'">')+
      field('Legal / business style','<input id="shStyle" value="'+attr(sh.businessStyle)+'">')+
      field('Address','<input id="shAddr" value="'+attr(sh.address)+'">')+
      field('Contact','<input id="shContact" value="'+attr(sh.contact)+'">')+
      field('TIN','<input id="shTin" value="'+attr(sh.tin)+'">')+
      field('VAT rate %','<input id="shVatRate" type="number" value="'+attr(sh.vatRate)+'">')+
      field('VAT registered','<label class="chk"><input type="checkbox" id="shVatReg" '+(sh.vatReg?'checked':'')+'> Prices are VAT-inclusive</label>')+
    '</div><button class="btn primary" onclick="saveShop()">Save shop details</button></div>'+

    '<div class="card"><h2>Customer QR portal</h2>'+
      field('Portal base URL','<input id="shPortal" value="'+attr(sh.portalUrl)+'">','Vehicle QR encodes <portalUrl>/#v=<id>. Host this file there for scans to resolve.')+
      '<label class="chk"><input type="checkbox" id="shPinReq" '+(sh.portalPinRequired?'checked':'')+'> Require a PIN to open portals (customer sets it on first scan)</label>'+
      '<p class="muted small">Local branches always require a PIN. For the cloud site this needs the Firestore rule from FIRESTORE_RULES.md deployed first.</p>'+
      '<div class="row gap"><button class="btn ghost" onclick="saveShop()">Save</button>'+
      '<button class="btn ghost" onclick="publishAllPortals()">↑ Publish all portals</button></div>'+
      '<p class="muted small">Publishing writes a minimal public snapshot (plate, service history, next service) per vehicle so customers can scan their QR without signing in. No prices, chassis, TIN or contact numbers are exposed.</p></div>'+

    '<div class="card"><h2>Commission</h2>'+
      field('Default rate % of labor','<input id="shComm" type="number" step="0.1" value="'+attr(sh.mechCommissionRate)+'">','Fallback rate for staff with no individual rate. Set per-staff rates (admin only) on the Staff page.')+
      '<button class="btn ghost" onclick="saveShop()">Save</button></div>'+

    '<div class="card"><h2>Parts Database (server)</h2>'+
      field('Source','<select id="shSource"><option value="local"'+(sh.partsSource==='local'?' selected':'')+'>Local</option><option value="server"'+(sh.partsSource==='server'?' selected':'')+'>Server API</option></select>')+
      field('Parts API endpoint (JSON)','<input id="shApi" value="'+attr(sh.partsApi||'')+'" placeholder="https://shop.local/api/parts.json">')+
      '<div class="row gap"><button class="btn ghost" onclick="saveShop()">Save</button><button class="btn ghost" onclick="syncPartsNow()">Sync now</button><button class="btn ghost" onclick="importPartsDialog()">Import CSV/JSON</button></div>'+
      '<details class="mt8"><summary class="muted small">Expected JSON shape & sample SQL</summary>'+
      '<pre class="codeblk">'+esc(sampleJSON)+'</pre><pre class="codeblk">'+esc(sampleQuery)+'</pre>'+
      '<p class="muted small">Browsers can\'t open raw SQL — expose this query as a JSON HTTP endpoint. Field names are mapped tolerantly (sku, srp, buying_price, quantity, min…).</p></details></div>'+

    sqlServerCard()+

  '</div><div class="colside">'+
    '<div class="card"><h2>Service Bays</h2><div class="tags">'+bays+'</div>'+
      '<div class="row gap mt8"><input id="bayNew" placeholder="Bay name"><button class="btn sm" onclick="addBay()">Add</button></div></div>'+
    '<div class="card"><h2>Clipboard checkpoints</h2><div class="tags">'+cps+'</div>'+
      '<div class="row gap mt8"><input id="cpNew" type="time" value="14:00"><button class="btn sm" onclick="addCheckpoint()">Add</button></div>'+
      '<p class="muted small">Units not updated since the latest checkpoint show an amber flag.</p></div>'+
    '<div class="card"><h2>Data</h2>'+
      '<button class="btn ghost full" onclick="exportBackup()">⬇ Export JSON backup</button>'+
      (((typeof dataLocal==='function')&&dataLocal()&&isAdminUser())
        ? '<label class="btn ghost full mt8"><input type="file" accept=".json,application/json" style="display:none" onchange="importBranchBackup(this.files)">⬆ Import JSON backup to this branch</label>'
        : '')+
      '<button class="btn danger full mt8" onclick="clearAllData()">Clear all data</button>'+
      '<p class="muted small">Backup downloads the full state. Clear wipes to a blank shop.'+
      (((typeof dataLocal==='function')&&dataLocal())?' Import replaces this branch server’s data with a backup (use it to move a shop off the cloud).':'')+'</p></div>'+
  '</div></div></div>';
};

function saveShop(){
  var sh=S.shop;
  if(document.getElementById('shName')){ sh.name=val('shName'); sh.businessStyle=val('shStyle'); sh.address=val('shAddr');
    sh.contact=val('shContact'); sh.tin=val('shTin');
    sh.vatRate=Number(val('shVatRate'))||12; sh.vatReg=checked('shVatReg'); }
  if(document.getElementById('shPortal')) sh.portalUrl=val('shPortal');
  if(document.getElementById('shPinReq')) sh.portalPinRequired=checked('shPinReq');
  if(document.getElementById('shComm')) sh.mechCommissionRate=Number(val('shComm'))||0;
  if(document.getElementById('shSource')){ sh.partsSource=val('shSource'); sh.partsApi=val('shApi'); }
  persist(); if(typeof publishPortalShop==='function') publishPortalShop();   // sync shop details to the portal
  toast('Settings saved'); render();
}
/* ---- Attach the parts catalog straight from SQL Server (branch server) ----
   Shown only on a local-parts branch build. The app never talks to SQL directly;
   it posts the connection details to this branch's parts server, which connects
   via .NET SqlClient (see branch-server/server.js) and syncs the catalog. */
var SQL_DEFAULTS = {
  server:'localhost\\MSSQLSERVER01', database:'jasRegaladoDB', auth:'integrated', user:'',
  query:'SELECT ap.fldStockCode AS sku, p.fldPartDesc AS part_name, ap.fldNetPrice AS net_price, ap.fldSRPExc AS srp FROM tblAutoPart ap WITH (NOLOCK) LEFT JOIN tblPart p WITH (NOLOCK) ON ap.fldPartNameCode = p.fldPartNameCode WHERE ap.fldIsActive = 1 ORDER BY ap.fldStockCode'
};
function partsServerBase(){ return (typeof BRANCH!=='undefined'&&BRANCH.partsUrl)?String(BRANCH.partsUrl).replace(/\/+$/,''):''; }
function sqlServerCard(){
  if (!(typeof BRANCH!=='undefined' && BRANCH && BRANCH.partsSource==='local')) return '';
  var d=SQL_DEFAULTS;
  return '<div class="card"><h2>Parts catalog — SQL Server</h2>'+
    '<p class="muted small">This branch’s parts server pulls the catalog directly from SQL Server. Values are pre-filled for JMSI — click <b>Test</b>, then <b>Attach</b>. A local snapshot is kept so parts keep working if SQL goes offline.</p>'+
    '<div id="sqlStatus" class="muted small mb8">Checking branch server…</div>'+
    field('SQL Server instance','<input id="sqlServer" value="'+attr(d.server)+'">')+
    field('Database','<input id="sqlDb" value="'+attr(d.database)+'">')+
    field('Authentication','<select id="sqlAuth"><option value="integrated">Windows (Integrated)</option><option value="sql">SQL login</option></select>')+
    '<div class="grid2">'+field('Username','<input id="sqlUser" value="" placeholder="SQL login only">')+
      field('Password','<input id="sqlPass" type="password" value="" placeholder="SQL login only">')+'</div>'+
    '<details class="mt8"><summary class="muted small">Advanced: query</summary>'+
      '<textarea id="sqlQuery" rows="5" class="full mono">'+esc(d.query)+'</textarea></details>'+
    '<div class="row gap mt8"><button class="btn ghost" onclick="sqlTest()">Test connection</button>'+
      '<button class="btn primary" onclick="sqlAttach()">Attach &amp; sync</button>'+
      '<button class="btn ghost" onclick="sqlSyncNow()">Re-sync now</button></div></div>';
}
function sqlCfgFromForm(){ return { server:val('sqlServer'), database:val('sqlDb'), auth:val('sqlAuth'), user:val('sqlUser'), password:val('sqlPass'), query:val('sqlQuery') }; }
function sqlSetStatus(html,cls){ var el=document.getElementById('sqlStatus'); if(el){ el.innerHTML=html; el.className=(cls||'muted')+' small mb8'; } }
async function sqlLoadStatus(){
  var base=partsServerBase(); if(!base){ sqlSetStatus('No parts server URL set for this branch.','err'); return; }
  try{
    var d=await (await fetch(base+'/admin/sql/status')).json();
    var cfg=d.config||d.defaults||SQL_DEFAULTS;
    if(document.getElementById('sqlServer')){ setVal('sqlServer',cfg.server||''); setVal('sqlDb',cfg.database||''); setVal('sqlAuth',cfg.auth||'integrated'); setVal('sqlUser',cfg.user||''); if(cfg.query) setVal('sqlQuery',cfg.query); }
    var src = d.configured ? ('SQL Server ('+esc(d.source||'')+')') : (d.source&&d.source.indexOf('tsv')===0?'file snapshot':'not attached');
    var cnt = Number(d.count||0);
    sqlSetStatus('Branch server online · '+cnt.toLocaleString()+' SKUs · source: <b>'+src+'</b>'+(d.lastError?' · <span class="err">last error: '+esc(d.lastError)+'</span>':''),'ok');
  }catch(e){ sqlSetStatus('Cannot reach branch parts server at '+esc(base)+' — is the mini-PC server running?','err'); }
}
async function sqlTest(){
  var base=partsServerBase(); if(!base){toast('No parts server URL','err');return;}
  sqlSetStatus('Testing connection…');
  try{
    var d=await (await fetch(base+'/admin/sql/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sqlCfgFromForm())})).json();
    if(d.ok){ var s=(d.sample||[]).map(function(x){return esc(x.sku)+' — '+esc(x.name);}).join('<br>'); sqlSetStatus('✓ Connected · '+Number(d.count).toLocaleString()+' rows.<br><span class="muted">'+s+'</span>','ok'); toast('SQL OK: '+d.count+' rows'); }
    else { sqlSetStatus('✗ '+esc(d.error||'failed'),'err'); toast('SQL test failed','err'); }
  }catch(e){ sqlSetStatus('✗ Cannot reach branch server.','err'); toast('Cannot reach server','err'); }
}
async function sqlAttach(){
  var base=partsServerBase(); if(!base){toast('No parts server URL','err');return;}
  sqlSetStatus('Attaching & syncing the full catalog…');
  try{
    var d=await (await fetch(base+'/admin/sql/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sqlCfgFromForm())})).json();
    if(d.ok){ sqlSetStatus('✓ Attached · '+Number(d.count).toLocaleString()+' SKUs synced from SQL Server.','ok'); toast('Parts attached: '+d.count+' SKUs'); if(typeof loadCatalog==='function') loadCatalog(true); }
    else { sqlSetStatus('✗ '+esc(d.error||'failed'),'err'); toast('Attach failed','err'); }
  }catch(e){ sqlSetStatus('✗ Cannot reach branch server.','err'); toast('Cannot reach server','err'); }
}
async function sqlSyncNow(){
  var base=partsServerBase(); if(!base) return;
  sqlSetStatus('Re-syncing from SQL Server…');
  try{
    var d=await (await fetch(base+'/admin/sql/sync',{method:'POST'})).json();
    if(d.ok){ sqlSetStatus('✓ Synced '+Number(d.count).toLocaleString()+' SKUs.','ok'); toast('Synced '+d.count+' SKUs'); if(typeof loadCatalog==='function') loadCatalog(true); }
    else { sqlSetStatus('✗ '+esc(d.error||'failed'),'err'); }
  }catch(e){ sqlSetStatus('✗ Cannot reach branch server.','err'); }
}
/* populate the SQL card status/fields whenever the Settings page renders */
if (typeof afterRender==='function'){
  var _settingsAfterRender = afterRender;
  afterRender = function(){ _settingsAfterRender(); if (typeof ROUTE!=='undefined' && ROUTE.view==='settings' && document.getElementById('sqlStatus')) sqlLoadStatus(); };
}

function addBay(){ var n=val('bayNew'); if(!n) return; S.bays.push({ id:uid('bay'), name:n }); persist(); render(); }
function delBay(id){ S.bays=S.bays.filter(function(b){return b.id!==id;}); persist(); render(); }
function renameBay(id){ var b=bayById(id); if(!b) return; var n=prompt('Rename service bay', b.name); if(n===null) return; n=n.trim(); if(!n) return; b.name=n; persist(); render(); }
function addCheckpoint(){ var t=val('cpNew'); if(!t) return; S.shop.checkpoints.push(t); S.shop.checkpoints.sort(); persist(); render(); }
function delCheckpoint(i){ S.shop.checkpoints.splice(i,1); persist(); render(); }

function exportBackup(){
  var data=JSON.stringify(S,null,2);
  if(typeof document==='undefined') return data;
  var blob=new Blob([data],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='basic_jmsi_backup_'+todayISO()+'.json'; a.click();
  toast('Backup downloaded');
}
/* Cutover: import a JSON backup (from the cloud app's Export) into THIS branch
   server, replacing its data. Admin + local only. */
function importBranchBackup(files){
  if(!((typeof dataLocal==='function')&&dataLocal())){ toast('Local branches only','err'); return; }
  var f=files&&files[0]; if(!f) return;
  var r=new FileReader();
  r.onload=function(){
    var st=null; try{ st=JSON.parse(r.result); }catch(e){ toast('Not a valid JSON backup','err'); return; }
    var cols=['staff','bays','parts','labor','vehicles','estimates','jobs','appointments','purchaseOrders'];
    var n=0; cols.forEach(function(c){ n+=((st&&st[c])||[]).length; });
    confirmModal('Import backup to this branch?','This REPLACES all data on this branch server with the backup ('+n+' records). The current branch data will be overwritten. This cannot be undone.', function(){
      _postJSON(branchBase()+'/data/import', st).then(function(d){
        if(d&&d.ok){ closeModal(); toast('Imported '+d.count+' records'); localLoadAll().then(function(){ if(typeof render==='function') render(); }); }
        else toast((d&&d.error==='admin_only')?'Admins only':'Import failed','err');
      }).catch(function(){ toast('Cannot reach branch server','err'); });
    },'Import & overwrite',true);
  };
  r.readAsText(f);
}
function clearAllData(){
  confirmModal('Clear all data?','This wipes every record to a blank shop. Export a backup first if needed.',function(){
    S=blankShop(); persist(); toast('All data cleared'); go('board');
  },'Clear everything',true);
}
function blankShop(){
  var s=seedState();
  s.staff=[]; s.bays=[]; s.parts=[]; s.labor=[]; s.vehicles=[]; s.estimates=[]; s.jobs=[]; s.appointments=[]; s.purchaseOrders=[];
  s.counters={ est:0, jo:0, or:1000, po:0 };
  return s;
}
