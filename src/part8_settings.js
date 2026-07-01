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
      '<button class="btn ghost" onclick="saveShop()">Save</button></div>'+

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

  '</div><div class="colside">'+
    '<div class="card"><h2>Service Bays</h2><div class="tags">'+bays+'</div>'+
      '<div class="row gap mt8"><input id="bayNew" placeholder="Bay name"><button class="btn sm" onclick="addBay()">Add</button></div></div>'+
    '<div class="card"><h2>Clipboard checkpoints</h2><div class="tags">'+cps+'</div>'+
      '<div class="row gap mt8"><input id="cpNew" type="time" value="14:00"><button class="btn sm" onclick="addCheckpoint()">Add</button></div>'+
      '<p class="muted small">Units not updated since the latest checkpoint show an amber flag.</p></div>'+
    '<div class="card"><h2>Data</h2>'+
      '<button class="btn ghost full" onclick="exportBackup()">⬇ Export JSON backup</button>'+
      '<button class="btn danger full mt8" onclick="clearAllData()">Clear all data</button>'+
      '<p class="muted small">Backup downloads the full state. Clear wipes to a blank shop.</p></div>'+
  '</div></div></div>';
};

function saveShop(){
  var sh=S.shop;
  if(document.getElementById('shName')){ sh.name=val('shName'); sh.businessStyle=val('shStyle'); sh.address=val('shAddr');
    sh.contact=val('shContact'); sh.tin=val('shTin');
    sh.vatRate=Number(val('shVatRate'))||12; sh.vatReg=checked('shVatReg'); }
  if(document.getElementById('shPortal')) sh.portalUrl=val('shPortal');
  if(document.getElementById('shComm')) sh.mechCommissionRate=Number(val('shComm'))||0;
  if(document.getElementById('shSource')){ sh.partsSource=val('shSource'); sh.partsApi=val('shApi'); }
  persist(); toast('Settings saved'); render();
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
