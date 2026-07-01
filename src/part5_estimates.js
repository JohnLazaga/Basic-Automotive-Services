/* ============================================================================
   PART 5 — Estimates: list, detail (line editor, approvers, signature, convert)
   ========================================================================== */

function createEstimateFrom(base){
  var v = vehicleByPlate(base.plate);
  var e = { id:uid('est'), no:nextNo('est','EST-',4), date:todayISO(),
    plate:base.plate||'', owner:base.owner||(v&&v.owner)||'', contactPerson:base.contactPerson||'', contactNumber:base.contactNumber||'',
    address:base.address||(v&&v.address)||'',
    year:base.year||(v&&v.year)||'', make:base.make||(v&&v.make)||'', model:base.model||(v&&v.model)||'',
    odometer:base.odometer||(v&&v.odometer)||0,
    lines:[], assessedBy:'', approvedSA:'', approvedSV:'', signature:null, signed:false, status:'Draft',
    notes:base.notes||'' };
  S.estimates.unshift(e); persist();
  return e;
}

var EST_Q='';
function estMatch(e){
  if(!EST_Q) return true; var q=EST_Q.toLowerCase();
  return [e.no,e.plate,e.owner,e.contactPerson,e.contactNumber,e.make+' '+e.model].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function estimatesBodyHTML(){
  var list=S.estimates.filter(estMatch);
  if(!list.length) return emptyState(EST_Q? 'No estimates match “'+esc(EST_Q)+'”.' : 'No estimates. Create one from Ingress.');
  var rows = list.map(function(e){
    return '<tr onclick="go(\'estimate\',\''+e.id+'\')"><td><b>'+esc(e.no)+'</b></td><td>'+esc(e.plate)+'</td>'+
      '<td>'+esc(e.make+' '+e.model)+'</td><td>'+chip(e.status, e.status==='Converted'?'ok':'')+'</td>'+
      '<td>'+esc(fmtDate(e.date))+'</td><td class="r">'+peso(estTotal(e))+'</td></tr>';
  }).join('');
  return '<div class="card pad0"><table class="tbl click"><thead><tr><th>EST #</th><th>Plate</th><th>Vehicle</th><th>Status</th><th>Date</th><th class="r">Total</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function estimatesSearch(v){ EST_Q=v; var el=document.getElementById('estBody'); if(el) el.innerHTML=estimatesBodyHTML(); }
VIEWS.estimates = function(){
  var search='<input class="searchbox" id="estSearch" value="'+attr(EST_Q)+'" oninput="estimatesSearch(this.value)" placeholder="Search EST# / plate / owner / contact…" autocomplete="off">';
  return '<div class="page"><div class="page-head"><h1>Estimates</h1><div class="row gap wrap">'+search+
    '<button class="btn primary" onclick="openIntake()">＋ New (via Ingress)</button></div></div>'+
    '<div id="estBody">'+estimatesBodyHTML()+'</div></div>';
};

function estTotal(e){ return sumLines(e.lines); }

VIEWS.estimate = function(id){
  var e = estById(id) || S.estimates[0];
  if(!e) return emptyState('Estimate not found.');
  var rows=(e.lines||[]).map(function(l){
    return '<tr><td>'+chip(l.type==='part'?'Part':'Labor', l.type==='part'?'':'gold')+'</td>'+
      '<td>'+esc((l.type==='part'&&l.sku)?l.sku:'—')+'</td><td>'+esc(l.desc)+'</td>'+
      '<td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.price)+'</td><td class="r">'+peso(lineTotal(l))+'</td>'+
      '<td class="r"><button class="ic" onclick="editEstLine(\''+e.id+'\',\''+l.id+'\')">✎</button><button class="ic" onclick="delEstLine(\''+e.id+'\',\''+l.id+'\')">✕</button></td></tr>';
  }).join('')||'<tr><td colspan="7" class="muted center">No lines.</td></tr>';
  var vs=vatSplit(estTotal(e),S);
  return '<div class="page">'+
    '<div class="page-head"><div><a class="back" onclick="go(\'estimates\')">‹ Estimates</a><h1>'+esc(e.no)+' · '+esc(e.plate)+'</h1></div>'+
      '<div class="row gap"><button class="btn ghost" onclick="printEstimate(\''+e.id+'\')">⎙ Print (2 copies)</button>'+
      (e.status!=='Converted'?'<button class="btn primary" onclick="convertEstimate(\''+e.id+'\')">Convert to Job Order →</button>':'<span>'+chip('Converted','ok')+'</span>')+'</div></div>'+
    '<div class="cols"><div class="colmain">'+
      '<div class="card"><div class="card-head"><h2>Parts & Labor</h2><button class="btn sm primary" onclick="addEstLine(\''+e.id+'\')">＋ Add line</button></div>'+
      '<table class="tbl"><thead><tr><th>Type</th><th>SKU</th><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div class="estsum">'+(vs.exempt?line2('VAT-Exempt Sales',peso(vs.gross)):line2('VATable Sales',peso(vs.vatable))+line2('VAT ('+(S.shop.vatRate||12)+'%)',peso(vs.vat)))+line2('<b>Estimated total</b>','<b>'+peso(vs.gross)+'</b>','tot')+'</div></div>'+
    '</div><div class="colside">'+
      '<div class="card"><h2>Approvals</h2>'+
        field('Assessed by (Senior Mechanic)','<select onchange="setEstField(\''+e.id+'\',\'assessedBy\',this.value)">'+optionList(staffByRole('SM'),e.assessedBy,true)+'</select>')+
        field('Approved by (SA)','<select onchange="setEstField(\''+e.id+'\',\'approvedSA\',this.value)">'+optionList(staffByRole('SA'),e.approvedSA,true)+'</select>')+
        field('Approved by (SV)','<select onchange="setEstField(\''+e.id+'\',\'approvedSV\',this.value)">'+optionList(staffByRole('SV'),e.approvedSV,true)+'</select>')+
      '</div>'+
      '<div class="card"><h2>Customer / Vehicle</h2><div class="ksmall">'+
        kv('Owner',esc(e.owner))+kv('Contact person',esc(e.contactPerson))+kv('Contact #',esc(e.contactNumber))+
        kv('Address',esc(e.address||(vehicleByPlate(e.plate)||{}).address||''))+
        kv('Vehicle',esc(e.year+' '+e.make+' '+e.model))+kv('Odometer',num(e.odometer)+' km')+'</div></div>'+
    '</div></div></div>';
};

function setEstField(id,f,v){ var e=estById(id); e[f]=v; persist(); }
function addEstLine(id){ openModal('Add line', lineForm(), { onOk:'saveEstLine', okText:'Add' }); setTimeout(function(){estLineCtx={est:id,line:null};},10); }
function editEstLine(id,lid){ var e=estById(id); var l=e.lines.find(function(x){return x.id===lid;}); openModal('Edit line', lineForm(l), { onOk:'saveEstLine' }); setTimeout(function(){estLineCtx={est:id,line:lid};},10); }
var estLineCtx=null;
function saveEstLine(){
  var e=estById(estLineCtx.est); var data=readLine();
  if(!data.desc){ toast(data.type==='part'?'Part name required':'Description required','err'); return; }
  if(estLineCtx.line){ var l=e.lines.find(function(x){return x.id===estLineCtx.line;}); Object.assign(l,data); }
  else { data.id=uid('ln'); e.lines.push(data); }
  persist(); closeModal(); render();
}
function delEstLine(id,lid){ var e=estById(id); e.lines=e.lines.filter(function(x){return x.id!==lid;}); persist(); render(); }

function convertEstimate(id){
  var e=estById(id);
  var job=createJob({ plate:e.plate, owner:e.owner, contactPerson:e.contactPerson, contactNumber:e.contactNumber,
    year:e.year, make:e.make, model:e.model, odometer:e.odometer, assessedBy:e.assessedBy, saId:e.approvedSA, notes:e.notes,
    lines: e.lines.map(function(l){ return { id:uid('ln'), type:l.type, ref:l.ref, desc:l.desc, qty:l.qty, price:l.price }; }) });
  e.status='Converted'; persist();
  toast('Converted to '+job.no); go('job', job.id);
}
