/* ============================================================================
   PART 6 — Records: Vehicles, Parts, Labor, Purchase Orders, Staff
   ========================================================================== */

/* ---- QR code (optional cdnjs lib, graceful fallback) ---------------------- */
var QR_LIB_URL='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
var _qrLoading=false, _qrReady=false;
function loadQR(cb){
  if (_qrReady || (typeof window!=='undefined' && window.QRCode)){ _qrReady=true; return cb(true); }
  if (typeof document==='undefined') return cb(false);
  if (_qrLoading){ setTimeout(function(){cb(_qrReady);},400); return; }
  _qrLoading=true;
  var s=document.createElement('script'); s.src=QR_LIB_URL;
  s.onload=function(){ _qrReady=true; cb(true); };
  s.onerror=function(){ _qrReady=false; cb(false); };
  document.head.appendChild(s);
}
function renderQR(elId, text){
  loadQR(function(ok){
    var el=document.getElementById(elId); if(!el) return;
    el.innerHTML='';
    if (ok && window.QRCode){ try{ new window.QRCode(el,{ text:text, width:180, height:180, colorDark:'#1D1D1F', colorLight:'#ffffff' }); return; }catch(e){} }
    el.innerHTML='<div class="qr-fallback"><div class="qr-x">QR</div><div class="muted small">Offline — encode this URL:</div><code class="qr-url">'+esc(text)+'</code></div>';
  });
}
function portalLink(vid){ return (S.shop.portalUrl||'').replace(/\/+$/,'')+'/#v='+vid; }

/* ---- Vehicles ------------------------------------------------------------- */
var VEH_Q='';
function vehMatch(v){
  if(!VEH_Q) return true; var q=VEH_Q.toLowerCase();
  return [v.plate,v.owner,v.contactPerson].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function vehBodyHTML(){
  var list=S.vehicles.filter(vehMatch);
  if(!list.length) return emptyState(VEH_Q? 'No vehicles match “'+esc(VEH_Q)+'”.' : 'No vehicles.');
  var rows=list.map(function(v){
    var due = v.nextServiceDate && v.nextServiceDate<=todayISO();
    var soon = v.nextServiceDate && v.nextServiceDate<=todayISO(new Date(Date.now()+14*86400000));
    return '<tr onclick="go(\'vehicle\',\''+v.id+'\')"><td><b>'+esc(v.plate)+'</b></td><td>'+esc(v.owner)+'</td>'+
      '<td>'+esc((v.year+' '+v.make+' '+v.model).trim()+(v.variant?' '+v.variant:''))+'</td><td class="r">'+odo(v.odometer)+'</td>'+
      '<td>'+(v.nextServiceDate? (due?chip('Overdue','due'):soon?chip('Due soon','gold'):fmtDate(v.nextServiceDate)) : '—')+'</td></tr>';
  }).join('');
  return '<div class="card pad0"><table class="tbl click"><thead><tr><th>Plate</th><th>Owner</th><th>Vehicle</th><th class="r">Odometer</th><th>Next service</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function vehSearch(v){ VEH_Q=v; var el=document.getElementById('vehBody'); if(el) el.innerHTML=vehBodyHTML(); }
VIEWS.vehicles = function(){
  var search='<input class="searchbox" id="vehSearch" value="'+attr(VEH_Q)+'" oninput="vehSearch(this.value)" placeholder="Search plate / owner / contact…" autocomplete="off">';
  return '<div class="page"><div class="page-head"><h1>Vehicles</h1><div class="row gap wrap">'+search+'<button class="btn primary" onclick="editVehicle()">＋ Add vehicle</button></div></div>'+
    '<div id="vehBody">'+vehBodyHTML()+'</div></div>';
};

VIEWS.vehicle = function(id){
  var v=vehicleById(id); if(!v) return emptyState('Vehicle not found.');
  var hist=S.jobs.filter(function(j){return j.vehicleId===v.id||(j.plate||'').toUpperCase()===(v.plate||'').toUpperCase();})
    .sort(function(a,b){return (b.dateIn||'')<(a.dateIn||'')?-1:1;});
  var timeline=hist.length? hist.map(function(j){
    return '<div class="tl-item"><div class="tl-dot"></div><div class="tl-body"><div class="tl-top"><b>'+esc(j.no)+'</b> '+chip(j.stage,j.stage==='Released'?'ok':'')+' <span class="muted">'+esc(fmtDate(j.dateIn))+'</span></div>'+
      '<div class="muted small">'+esc((j.lines||[]).map(function(l){return l.desc;}).join(', ')||'—')+'</div>'+
      '<div class="tl-amt">'+peso(jobGross(j))+'</div></div></div>';
  }).join('') : emptyState('No service history yet.');
  var due = v.nextServiceDate && v.nextServiceDate<=todayISO();
  return '<div class="page"><div class="page-head"><div><a class="back" onclick="go(\'vehicles\')">‹ Vehicles</a><h1>'+esc(v.plate)+'</h1></div>'+
    '<div class="row gap"><button class="btn ghost" onclick="editVehicle(\''+v.id+'\')">Edit</button><button class="btn ghost" onclick="sendReminder(\''+v.id+'\')">Send reminder</button></div></div>'+
    '<div class="cols"><div class="colmain"><div class="card"><h2>Service history</h2><div class="timeline">'+timeline+'</div></div></div>'+
    '<div class="colside">'+
      '<div class="card"><h2>Next service / PMS</h2>'+
        '<div class="nextsvc '+(due?'due':'')+'">'+(v.nextServiceDate? (due?'⚠ Overdue · ':'')+fmtDate(v.nextServiceDate) : 'Not scheduled')+
        (v.nextServiceOdo?'<div class="muted small">or at '+odo(v.nextServiceOdo)+' (now '+odo(v.odometer)+')</div>':'')+'</div></div>'+
      '<div class="card center"><h2>Customer QR portal</h2><div id="vehQR" class="qrbox"></div>'+
        '<div class="row gap center mt8"><button class="btn sm ghost" onclick="printQRSticker(\''+v.id+'\')">⎙ Print sticker</button>'+
        '<button class="btn sm ghost" onclick="previewPortal(\''+v.id+'\')">Preview portal</button></div>'+
        '<div class="muted small mt8">Scans resolve once hosted at:<br><code class="qr-url">'+esc(portalLink(v.id))+'</code></div></div>'+
      '<div class="card"><h2>Owner / Vehicle</h2><div class="ksmall">'+
        kv('Owner',esc(v.owner))+kv('Address',esc(v.address||'—'))+kv('Contact',esc(v.contactPerson+' · '+v.contactNumber))+
        kv('Chassis #',esc(v.chassis||'—'))+kv('Year/Make/Model',esc(v.year+' '+v.make+' '+v.model))+kv('Variant',esc(v.variant||'—'))+kv('Last service odo',odo(v.odometer))+'</div></div>'+
    '</div></div></div>';
};

/* extend afterRender to draw QR */
var _afterRenderPrev = afterRender;
afterRender = function(){
  _afterRenderPrev();
  if (document.getElementById('vehQR') && ROUTE.view==='vehicle'){ renderQR('vehQR', portalLink(ROUTE.arg)); }
};

function editVehicle(id){
  var v=id?vehicleById(id):{};
  openModal(id?'Edit vehicle':'Add vehicle',
    '<div class="grid2">'+
    field('Plate','<input id="vehPlate" value="'+attr(v.plate||'')+'">')+
    field('Registered owner','<input id="vehOwner" value="'+attr(v.owner||'')+'">')+
    field('Contact person','<input id="vehCP" value="'+attr(v.contactPerson||'')+'">')+
    field('Contact #','<input id="vehContact" value="'+attr(v.contactNumber||'')+'">')+
    field('Address','<input id="vehAddr" value="'+attr(v.address||'')+'">')+
    field('Chassis #','<input id="vehChassis" value="'+attr(v.chassis||'')+'">')+
    field('Year','<input id="vehYear" type="number" value="'+attr(v.year||'')+'">')+
    field('Make','<input id="vehMake" value="'+attr(v.make||'')+'">')+
    field('Model','<input id="vehModel" value="'+attr(v.model||'')+'">')+
    field('Variant','<input id="vehVariant" value="'+attr(v.variant||'')+'">')+
    field('Last service odometer','<input id="vehOdo" type="number" value="'+attr(v.odometer||0)+'">')+
    field('Next service odometer','<input id="vehNextOdo" type="number" value="'+attr(v.nextServiceOdo||'')+'">')+
    field('Next service date','<input id="vehNextDate" type="date" value="'+attr(v.nextServiceDate||'')+'">')+
    '</div>',
    vehicleModalOpts(id));
  vehCtx=id||null;
}
function vehicleModalOpts(id){
  var isAdmin = (typeof isAdminUser!=='function') || isAdminUser();
  if (id && isAdmin){
    return { width:'700px', footer:
      '<button class="btn danger ghost" onclick="deleteVehicleConfirm(\''+id+'\')">🗑 Delete vehicle</button>'+
      '<span style="flex:1"></span>'+
      '<button class="btn ghost" onclick="closeModal()">Cancel</button>'+
      '<button class="btn primary" onclick="saveVehicle()">Save</button>' };
  }
  return { onOk:'saveVehicle', width:'700px' };
}
function deleteVehicleConfirm(id){
  if (typeof isAdminUser==='function' && !isAdminUser()){ toast('Admins only','err'); return; }
  var v=vehicleById(id); if(!v) return;
  confirmModal('Delete this vehicle?',
    'This permanently removes '+(v.plate||'this vehicle')+' ('+(v.year+' '+v.make+' '+v.model).trim()+') from your records for everyone. Existing job orders keep their own copy of the details. This cannot be undone.',
    function(){
      S.vehicles=S.vehicles.filter(function(x){return x.id!==id;});
      persist(); closeModal(); toast('Vehicle deleted'); go('vehicles');
    },'Delete vehicle', true);
}
var vehCtx=null;
function saveVehicle(){
  var data={ plate:(val('vehPlate')||'').toUpperCase(), owner:val('vehOwner'), contactPerson:val('vehCP'), contactNumber:val('vehContact'),
    chassis:val('vehChassis'), year:val('vehYear'), make:val('vehMake'), model:val('vehModel'), variant:val('vehVariant'),
    odometer:Number(val('vehOdo'))||0, nextServiceDate:val('vehNextDate'), nextServiceOdo:Number(val('vehNextOdo'))||'', address:val('vehAddr') };
  if(vehCtx){ Object.assign(vehicleById(vehCtx),data); } else { data.id=uid('vh'); S.vehicles.push(data); }
  persist(); closeModal(); toast('Vehicle saved'); render();
}
function sendReminder(id){
  var v=vehicleById(id);
  var msg='Hi '+(v.contactPerson||v.owner)+'! This is '+S.shop.name+'. Your '+v.year+' '+v.make+' '+v.model+' (plate '+v.plate+
    ') is due for '+(v.nextServiceDate?('PMS on '+fmtDate(v.nextServiceDate)):'its next service')+'. Please call '+S.shop.contact+' to book. Thank you!';
  var sms='sms:'+(v.contactNumber||'').replace(/\s/g,'')+'?&body='+encodeURIComponent(msg);
  var mail='mailto:?subject='+encodeURIComponent('Service reminder — '+v.plate)+'&body='+encodeURIComponent(msg);
  openModal('Service reminder', '<p class="muted small">A static file can\'t auto-send. Choose a channel or copy the message.</p>'+
    '<textarea id="remMsg" rows="5" class="full">'+esc(msg)+'</textarea>',
    { footer:'<button class="btn ghost" onclick="copyRem()">Copy</button>'+
      '<a class="btn ghost" href="'+attr(mail)+'">Email</a>'+
      '<a class="btn primary" href="'+attr(sms)+'">Open SMS</a>' });
}
function copyRem(){ var t=val('remMsg'); if(navigator.clipboard) navigator.clipboard.writeText(t); toast('Copied'); }

/* ---- Parts catalog -------------------------------------------------------- */
VIEWS.parts = function(){
  var showCost = (typeof can!=='function') || can('part_cost');
  var rows=S.parts.map(function(p){
    var margin = p.price? Math.round((p.price-p.cost)/p.price*100) : 0;
    var low=(p.stock||0)<=(p.reorder||0);
    return '<tr><td><b>'+esc(p.partNo)+'</b></td><td>'+esc(p.name)+'</td>'+
      (showCost?'<td class="r">'+peso(p.cost)+'</td>':'')+
      '<td class="r">'+peso(p.price)+'</td>'+(showCost?'<td class="r">'+margin+'%</td>':'')+
      '<td class="r">'+num(p.stock)+(low?' <span class="lowpill">low</span>':'')+'</td>'+
      '<td class="r"><button class="ic" onclick="editPart(\''+p.id+'\')">✎</button><button class="ic" onclick="delPart(\''+p.id+'\')">✕</button></td></tr>';
  }).join('');
  var inv=S.parts.reduce(function(s,p){return s+(p.cost||0)*(p.stock||0);},0);
  return '<div class="page"><div class="page-head"><h1>Parts Catalog</h1>'+
    '<div class="row gap"><button class="btn ghost" onclick="go(\'settings\')">Server sync</button>'+
    '<button class="btn ghost" onclick="importPartsDialog()">Import CSV/JSON</button>'+
    '<button class="btn primary" onclick="editPart()">＋ Add part</button></div></div>'+
    (showCost?'<div class="muted small mb8">Inventory value at cost: <b>'+peso(inv)+'</b>'+(S.shop.partsSyncedAt?' · last synced '+fmtDateTime(S.shop.partsSyncedAt):'')+'</div>':'')+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Part #</th><th>Name</th>'+(showCost?'<th class="r">Cost</th>':'')+'<th class="r">Price</th>'+(showCost?'<th class="r">Margin</th>':'')+'<th class="r">Stock</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
};
function editPart(id){
  var p=id?partById(id):{};
  openModal(id?'Edit part':'Add part','<div class="grid2">'+
    field('Part #','<input id="ptNo" value="'+attr(p.partNo||'')+'">')+
    field('Name','<input id="ptName" value="'+attr(p.name||'')+'">')+
    field('Cost','<input id="ptCost" type="number" step="0.01" value="'+attr(p.cost||0)+'">')+
    field('Price (SRP)','<input id="ptPrice" type="number" step="0.01" value="'+attr(p.price||0)+'">')+
    field('Stock','<input id="ptStock" type="number" value="'+attr(p.stock||0)+'">')+
    field('Reorder level','<input id="ptReorder" type="number" value="'+attr(p.reorder||0)+'">')+'</div>',
    { onOk:'savePart' }); setTimeout(function(){ptCtx=id||null;},10);
}
var ptCtx=null;
function savePart(){
  var data={ partNo:val('ptNo'), name:val('ptName'), cost:Number(val('ptCost'))||0, price:Number(val('ptPrice'))||0,
    stock:Number(val('ptStock'))||0, reorder:Number(val('ptReorder'))||0, source:'local' };
  if(!data.name){toast('Name required','err');return;}
  if(ptCtx){ Object.assign(partById(ptCtx),data); } else { data.id=uid('pt'); S.parts.push(data); }
  persist(); closeModal(); render();
}
function delPart(id){ S.parts=S.parts.filter(function(p){return p.id!==id;}); persist(); render(); }

/* tolerant field mapping for sync/import */
function mapPartRow(r){
  function pick(){ for(var i=0;i<arguments.length;i++){ var k=arguments[i]; if(r[k]!==undefined&&r[k]!=='') return r[k]; } return undefined; }
  var no=pick('partNo','part_no','sku','code','itemcode');
  var name=pick('name','description','desc','itemname','item');
  if(name===undefined&&no===undefined) return null;
  return { id:uid('pt'), partNo:String(no||name||''), name:String(name||no||''),
    price:Number(pick('price','srp','sellingprice','retail'))||0,
    cost:Number(pick('cost','buying_price','buyingprice','wholesale'))||0,
    stock:Number(pick('stock','quantity','qty','onhand'))||0,
    reorder:Number(pick('reorder','min','minimum','reorderpoint'))||0, source:'server' };
}
function importPartsFromArray(arr){
  var mapped=arr.map(mapPartRow).filter(Boolean);
  if(!mapped.length) return 0;
  S.parts=mapped; persist(); return mapped.length;
}
function parseCSV(text){
  var lines=text.split(/\r?\n/).filter(function(l){return l.trim();});
  if(!lines.length) return [];
  var head=lines[0].split(',').map(function(h){return h.trim().toLowerCase().replace(/\s+/g,'');});
  return lines.slice(1).map(function(l){
    var cells=l.split(','); var o={}; head.forEach(function(h,i){ o[h]=(cells[i]||'').trim(); }); return o;
  });
}
function importPartsText(text){
  text=text.trim();
  try { var j=JSON.parse(text); if(Array.isArray(j)) return importPartsFromArray(j); }
  catch(e){}
  return importPartsFromArray(parseCSV(text));
}
function importPartsDialog(){
  openModal('Import parts (CSV or JSON)',
    '<p class="muted small">Paste JSON array or CSV. Columns are mapped tolerantly (part_no/sku, description, srp, buying_price, quantity, min…).</p>'+
    '<textarea id="impText" rows="8" class="full mono" placeholder=\'[{"partNo":"OF-1","name":"Oil Filter","srp":220,"cost":120,"stock":10}]\'></textarea>'+
    '<label class="btn sm mt8"><input type="file" accept=".csv,.json,.txt" style="display:none" onchange="impFile(this.files)">Load file…</label>',
    { onOk:'doImportParts', okText:'Import' });
}
function impFile(files){ var f=files[0]; if(!f) return; var r=new FileReader(); r.onload=function(){ setVal('impText',r.result); }; r.readAsText(f); }
function doImportParts(){ var n=importPartsText(val('impText')); if(n){ S.shop.partsSource='server'; persist(); closeModal(); toast('Imported '+n+' parts'); render(); } else toast('Could not parse','err'); }

function syncPartsNow(){
  var url=S.shop.partsApi; if(!url){toast('Set parts API URL in Settings','err');return;}
  toast('Syncing…');
  fetch(url).then(function(r){return r.json();}).then(function(data){
    var arr=Array.isArray(data)?data:(data.parts||data.data||[]);
    var n=importPartsFromArray(arr);
    if(n){ S.shop.partsSyncedAt=new Date().toISOString(); persist(); toast('Synced '+n+' parts'); render(); }
    else toast('No parts in response','err');
  }).catch(function(e){ toast('Sync failed (offline/CORS). '+e.message,'err'); });
}

/* ---- Labor catalog -------------------------------------------------------- */
VIEWS.labor = function(){
  var rows=S.labor.map(function(l){
    return '<tr><td>'+esc(l.name)+'</td><td class="r">'+peso(l.price)+'</td><td class="r">'+peso(l.cost||0)+'</td>'+
      '<td class="r"><button class="ic" onclick="editLabor(\''+l.id+'\')">✎</button><button class="ic" onclick="delLabor(\''+l.id+'\')">✕</button></td></tr>';
  }).join('');
  return '<div class="page"><div class="page-head"><h1>Labor Catalog</h1><button class="btn primary" onclick="editLabor()">＋ Add labor</button></div>'+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Service</th><th class="r">Rate</th><th class="r">Internal cost</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
};
function editLabor(id){ var l=id?S.labor.find(function(x){return x.id===id;}):{};
  openModal(id?'Edit labor':'Add labor', field('Service name','<input id="lbName" value="'+attr(l.name||'')+'">')+
    '<div class="grid2">'+field('Rate','<input id="lbPrice" type="number" step="0.01" value="'+attr(l.price||0)+'">')+
    field('Internal cost','<input id="lbCost" type="number" step="0.01" value="'+attr(l.cost||0)+'">')+'</div>',
    { onOk:'saveLabor' }); setTimeout(function(){lbCtx=id||null;},10); }
var lbCtx=null;
function saveLabor(){ var data={ name:val('lbName'), price:Number(val('lbPrice'))||0, cost:Number(val('lbCost'))||0 };
  if(!data.name){toast('Name required','err');return;}
  if(lbCtx){ Object.assign(S.labor.find(function(x){return x.id===lbCtx;}),data); } else { data.id=uid('lb'); S.labor.push(data); }
  persist(); closeModal(); render(); }
function delLabor(id){ S.labor=S.labor.filter(function(x){return x.id!==id;}); persist(); render(); }

/* ---- Purchase Orders ------------------------------------------------------ */
VIEWS.purchaseorders = function(){
  var rows=S.purchaseOrders.map(function(po){
    var tot=po.lines.reduce(function(s,l){return s+(l.qty||0)*(l.cost||0);},0);
    return '<tr onclick="go(\'po\',\''+po.id+'\')"><td><b>'+esc(po.no)+'</b></td><td>'+esc(po.supplier)+'</td>'+
      '<td>'+chip(po.status, po.status==='Received'?'ok':po.status==='Cancelled'?'':'gold')+'</td>'+
      '<td>'+esc(fmtDate(po.date))+'</td><td class="r">'+peso(tot)+'</td></tr>';
  }).join('');
  return '<div class="page"><div class="page-head"><h1>Purchase Orders</h1>'+
    '<div class="row gap"><button class="btn ghost" onclick="suggestReorder()">Suggest reorder</button>'+
    '<button class="btn primary" onclick="newPO()">＋ New PO</button></div></div>'+
    (S.purchaseOrders.length?'<div class="card pad0"><table class="tbl click"><thead><tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Date</th><th class="r">Total</th></tr></thead><tbody>'+rows+'</tbody></table></div>':emptyState('No purchase orders.'))+'</div>';
};
function newPO(){ allocateSeriesNumber('po','PO-',4).then(function(no){
  var po={ id:uid('po'), no:no, date:todayISO(), supplier:'', status:'Draft', lines:[], notes:'', receivedDate:null };
  S.purchaseOrders.unshift(po); persist(); go('po', po.id); }); }
function suggestReorder(){
  var low=S.parts.filter(function(p){return (p.stock||0)<=(p.reorder||0);});
  if(!low.length){ toast('Nothing below reorder level'); return; }
  allocateSeriesNumber('po','PO-',4).then(function(no){
    var po={ id:uid('po'), no:no, date:todayISO(), supplier:'', status:'Draft',
      lines:low.map(function(p){ return { partId:p.id, name:p.name, qty:Math.max((p.reorder||0)*2-(p.stock||0),(p.reorder||0)), cost:p.cost||0 }; }),
      notes:'Auto-generated from low-stock parts.', receivedDate:null };
    S.purchaseOrders.unshift(po); persist(); toast('Draft PO built from '+low.length+' low-stock parts'); go('po', po.id);
  });
}
VIEWS.po = function(id){
  var po=S.purchaseOrders.find(function(x){return x.id===id;})||S.purchaseOrders[0];
  if(!po) return emptyState('PO not found.');
  var locked=po.status==='Received'||po.status==='Cancelled';
  var tot=po.lines.reduce(function(s,l){return s+(l.qty||0)*(l.cost||0);},0);
  var rows=po.lines.map(function(l,i){
    return '<tr><td>'+esc(l.name)+'</td><td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.cost)+'</td><td class="r">'+peso((l.qty||0)*(l.cost||0))+'</td>'+
      '<td class="r">'+(locked?'':'<button class="ic" onclick="delPOLine(\''+po.id+'\','+i+')">✕</button>')+'</td></tr>';
  }).join('')||'<tr><td colspan="5" class="muted center">No lines.</td></tr>';
  return '<div class="page"><div class="page-head"><div><a class="back" onclick="go(\'purchaseorders\')">‹ Purchase Orders</a><h1>'+esc(po.no)+'</h1></div>'+
    '<div class="row gap"><button class="btn ghost" onclick="printPO(\''+po.id+'\')">⎙ Print</button>'+
    (po.status==='Draft'?'<button class="btn ghost" onclick="setPOStatus(\''+po.id+'\',\'Ordered\')">Mark Ordered</button>':'')+
    (po.status!=='Received'&&po.status!=='Cancelled'?'<button class="btn primary" onclick="receivePO(\''+po.id+'\')">Receive →</button>':'')+
    '</div></div>'+
    '<div class="cols"><div class="colmain"><div class="card"><div class="card-head"><h2>Lines</h2>'+(locked?'':'<button class="btn sm primary" onclick="addPOLine(\''+po.id+'\')">＋ Add</button>')+'</div>'+
      '<table class="tbl"><thead><tr><th>Part</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Total</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div class="estsum">'+line2('<b>PO total</b>','<b>'+peso(tot)+'</b>','tot')+'</div></div></div>'+
    '<div class="colside"><div class="card"><h2>Details</h2>'+
      field('Supplier','<input value="'+attr(po.supplier)+'" '+(locked?'disabled':'')+' onchange="setPOField(\''+po.id+'\',\'supplier\',this.value)">')+
      field('Date','<input type="date" value="'+attr(po.date)+'" '+(locked?'disabled':'')+' onchange="setPOField(\''+po.id+'\',\'date\',this.value)">')+
      field('Status','<input value="'+attr(po.status)+'" disabled>')+
      (po.receivedDate?field('Received',  '<input value="'+attr(fmtDate(po.receivedDate))+'" disabled>'):'')+
      field('Notes','<textarea rows="3" '+(locked?'disabled':'')+' onchange="setPOField(\''+po.id+'\',\'notes\',this.value)">'+esc(po.notes||'')+'</textarea>')+'</div></div></div></div>';
};
function setPOField(id,f,v){ var po=S.purchaseOrders.find(function(x){return x.id===id;}); po[f]=v; persist(); }
function setPOStatus(id,st){ var po=S.purchaseOrders.find(function(x){return x.id===id;}); po.status=st; persist(); render(); }
function addPOLine(id){
  var po=S.purchaseOrders.find(function(x){return x.id===id;});
  var opts='<option value="">— custom —</option>'+S.parts.map(function(p){return '<option value="'+p.id+'" data-name="'+attr(p.name)+'" data-cost="'+p.cost+'">'+esc(p.partNo+' · '+p.name)+'</option>';}).join('');
  openModal('Add PO line', field('Part','<select id="polRef" onchange="polPick()">'+opts+'</select>')+
    field('Name','<input id="polName">')+'<div class="grid2">'+field('Qty','<input id="polQty" type="number" value="1">')+field('Unit cost','<input id="polCost" type="number" step="0.01" value="0">')+'</div>',
    { onOk:'savePOLine', okText:'Add' }); setTimeout(function(){poCtx=id;},10);
}
var poCtx=null;
function polPick(){ var s=document.getElementById('polRef'); var o=s.options[s.selectedIndex]; if(o&&o.value){ setVal('polName',o.getAttribute('data-name')); setVal('polCost',o.getAttribute('data-cost')); } }
function savePOLine(){ var po=S.purchaseOrders.find(function(x){return x.id===poCtx;});
  po.lines.push({ partId:val('polRef')||null, name:val('polName'), qty:Number(val('polQty'))||0, cost:Number(val('polCost'))||0 });
  persist(); closeModal(); render(); }
function delPOLine(id,i){ var po=S.purchaseOrders.find(function(x){return x.id===id;}); po.lines.splice(i,1); persist(); render(); }
function receivePO(id){
  var po=S.purchaseOrders.find(function(x){return x.id===id;});
  if(po.status==='Received') return;
  po.lines.forEach(function(l){ if(l.partId){ var p=partById(l.partId); if(p) p.stock=round2((p.stock||0)+(Number(l.qty)||0)); } });
  po.status='Received'; po.receivedDate=todayISO(); persist(); toast('Stock replenished'); render();
}

/* ---- Staff ---------------------------------------------------------------- */
var ROLES=['SV','SA','SM','Mechanic','Parts Salesman','Secretary'];
VIEWS.staff = function(){
  var dflt = (S.shop.mechCommissionRate||0);
  var admin = (typeof isAdminUser!=='function') || isAdminUser();
  var rows=S.staff.map(function(s){
    var hasOwn = !(s.commissionRate===undefined||s.commissionRate===null||s.commissionRate==='');
    var eff = hasOwn ? Number(s.commissionRate)||0 : dflt;
    var rateCell = admin
      ? '<input type="number" step="0.1" min="0" value="'+attr(eff)+'" style="width:72px" onchange="setStaffCommissionRate(\''+s.id+'\',this.value)">% '+(hasOwn?'':'<span class="muted small">(default)</span>')
      : esc(eff+'% of labor'+(hasOwn?'':' (default)'));
    return '<tr><td><b>'+esc(s.name)+'</b>'+(s.nickname?' <span class="muted small">“'+esc(s.nickname)+'”</span>':'')+'</td><td>'+chip(roleLabel(s.role))+'</td><td>'+rateCell+'</td>'+
      '<td class="r"><button class="ic" onclick="editStaff(\''+s.id+'\')">✎</button><button class="ic" onclick="delStaff(\''+s.id+'\')">✕</button></td></tr>';
  }).join('');
  var ruleCard = '<div class="card"><div class="card-head"><h2>Commission</h2></div>'+
    '<p class="muted small">Commission is set <b>per staff member</b> below — each earns their own rate × the job\'s labor on jobs they\'re assigned to. '+(admin?'Only admins can change rates.':'Rates are set by an admin.')+'</p>'+
    '<div class="row gap" style="align-items:center">'+
      '<span>Default rate for staff with no rate set:</span>'+
      (admin? '<input id="shopCommRate" type="number" step="0.1" min="0" value="'+attr(dflt)+'" style="width:90px" onchange="setShopCommissionRate(this.value)">%'
            : '<b>'+esc(dflt)+'%</b>')+
    '</div></div>';
  return '<div class="page"><div class="page-head"><h1>Staff</h1><button class="btn primary" onclick="editStaff()">＋ Add staff</button></div>'+
    ruleCard+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Commission rate</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
};
function setShopCommissionRate(v){ if(typeof isAdminUser==='function'&&!isAdminUser()){toast('Admins only','err');return;} S.shop.mechCommissionRate=Math.max(0,Number(v)||0); persist(); toast('Default rate set to '+S.shop.mechCommissionRate+'%'); render(); }
function setStaffCommissionRate(id,v){ if(typeof isAdminUser==='function'&&!isAdminUser()){toast('Admins only','err');return;} var s=staffById(id); if(!s) return; s.commissionRate=Math.max(0,Number(v)||0); persist(); toast(esc(s.name)+' → '+s.commissionRate+'%'); render(); }
function toggleStaffCommission(id,on){ var s=staffById(id); if(!s) return; s.commission=!!on; persist(); toast(on?'Included in payout':'Excluded from payout'); render(); }
function editStaff(id){ var s=id?staffById(id):{};
  var admin = (typeof isAdminUser!=='function') || isAdminUser();
  var rateField = admin ? field('Commission rate % of labor','<input id="stRate" type="number" step="0.1" min="0" value="'+attr(s.commissionRate!==undefined&&s.commissionRate!==''?s.commissionRate:'')+'" placeholder="leave blank for default ('+(S.shop.mechCommissionRate||0)+'%)">','Admin-set. Each person earns this rate × labor on jobs they\'re assigned to.') : '';
  openModal(id?'Edit staff':'Add staff',
    '<div class="grid2">'+field('Name','<input id="stName" value="'+attr(s.name||'')+'">')+
    field('Nickname','<input id="stNick" value="'+attr(s.nickname||'')+'" placeholder="optional">')+'</div>'+
    field('Role','<select id="stRole">'+ROLES.map(function(r){return '<option value="'+r+'"'+(s.role===r?' selected':'')+'>'+esc(roleLabel(r))+'</option>';}).join('')+'</select>')+
    rateField,
    { onOk:'saveStaff' }); setTimeout(function(){stCtx=id||null;},10); }
var stCtx=null;
function saveStaff(){ var data={ name:val('stName'), nickname:val('stNick'), role:val('stRole') };
  if(!data.name){toast('Name required','err');return;}
  var admin = (typeof isAdminUser!=='function') || isAdminUser();
  if(admin && document.getElementById('stRate')){ var rv=val('stRate'); data.commissionRate = (rv===''||rv===null||rv===undefined) ? '' : Math.max(0,Number(rv)||0); }
  if(stCtx){ Object.assign(staffById(stCtx),data); } else { data.id=uid('st'); S.staff.push(data); }
  persist(); closeModal(); render(); }
function delStaff(id){ S.staff=S.staff.filter(function(s){return s.id!==id;}); persist(); render(); }
