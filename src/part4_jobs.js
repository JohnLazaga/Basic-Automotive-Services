/* ============================================================================
   PART 4 — Job Orders (MASTER): list, detail, pipeline, inventory, payments
   ========================================================================== */

/* ---- Vehicle auto-create -------------------------------------------------- */
function ensureVehicle(snap){
  var v = vehicleByPlate(snap.plate);
  if (v){
    // refresh light fields
    if (snap.odometer) v.odometer = snap.odometer;
    return v;
  }
  v = { id:uid('vh'), plate:(snap.plate||'').trim().toUpperCase(), owner:snap.owner||snap.contactPerson||'',
    address:snap.address||'', contactPerson:snap.contactPerson||'', contactNumber:snap.contactNumber||'',
    chassis:snap.chassis||'', year:snap.year||'', make:snap.make||'', model:snap.model||'', variant:snap.variant||'',
    odometer:snap.odometer||0, nextServiceDate:'', nextServiceOdo:'' };
  S.vehicles.push(v);
  return v;
}

function blankJob(){
  return { id:uid('job'), no:'', stage:'Job Order',
    plate:'', vehicleId:null, owner:'', address:'', contactPerson:'', contactNumber:'', chassis:'',
    year:'', make:'', model:'', variant:'', customerTin:'',
    dateIn:todayISO(), etd:'', odometer:0, lastServiceOdo:'', jobHours:0,
    assessedBy:'', saId:'', mechanicIds:[], bayId:'TBA',
    lines:[], partsSalesman:'', siRef:'', pmsRef:'', notes:'',
    inspection:{ odometer:0, fuel:'', lights:'', condition:'', testDrive:'' },
    checklist:{ created:false, leaveUnit:false, items:{}, bodyNotes:'' },
    status:'A1', statusLog:[], addlWork:[], approvedReleaseBy:null, paymentReceivedBy:null,
    discount:{ parts:0, labor:0, other:0, otherNote:'' }, payments:[], orNumber:null, billedAt:null, releaseSignature:null,
    photos:[], inventoryDeducted:false };
}

async function createJob(base){
  var j = Object.assign(blankJob(), base||{});
  j.no = await allocateSeriesNumber('jo','JO-',4);          // atomic, unique
  if (!j.statusLog.length) j.statusLog=[{ time:new Date().toISOString(), code:j.status||'A1', by:j.saId||'', note:'Job Order created.' }];
  var v = ensureVehicle(j);
  j.vehicleId = v.id;
  ['owner','address','contactPerson','contactNumber','chassis','year','make','model','variant'].forEach(function(k){
    if(!j[k]) j[k]=v[k];
  });
  S.jobs.unshift(j); persist();
  return j;
}
function createJobFromAppt(a){
  var v = vehicleByPlate(a.plate);
  return createJob({
    plate:a.plate||(v&&v.plate)||'', owner:(v&&v.owner)||a.customer, contactPerson:(v&&v.contactPerson)||a.customer,
    contactNumber:a.contactNumber, address:(v&&v.address)||'', chassis:(v&&v.chassis)||'',
    year:(v&&v.year)||'', make:(v&&v.make)||'', model:(v&&v.model)||'',
    saId:a.assignedTo!=='TBA'?a.assignedTo:'', bayId:a.bayId||'TBA', notes:a.service?('Booked service: '+a.service):'',
    odometer:(v&&v.odometer)||0
  });
}

/* ---- Ingress (front-desk intake) ------------------------------------------ */
/* Fields that must be filled for a complete ingress. The Job Order can be created
   with gaps (finish later), but a Post Job Report can NOT be created until these
   are all complete. */
/* Variant is OPTIONAL — not every vehicle has a named variant. */
var INGRESS_REQUIRED = [
  ['plate','Plate'],['owner','Registered owner'],['contactPerson','Contact person'],
  ['contactNumber','Contact #'],['address','Address'],['chassis','Chassis #'],
  ['year','Year'],['make','Make'],['model','Model'],
  ['odometer','Ingress odometer'] ];
function jobMissingFields(j){
  return INGRESS_REQUIRED.filter(function(f){
    var v=j[f[0]];
    if(f[0]==='odometer') return !(Number(v)>0);
    return !String(v==null?'':v).trim();
  }).map(function(f){ return f[1]; });
}
/* Everything that must be complete before a Post Job Report can be created:
   the ingress fields plus dates, both odometers, check-in condition and the
   assignment (Service Adviser + mechanics). */
function postJobMissingFields(j){
  var missing = jobMissingFields(j);
  var insp = j.inspection||{};
  if(!String(j.dateIn||'').trim()) missing.push('Date in');
  if(!String(j.etd||'').trim()) missing.push('ETD');
  if(!(Number(j.lastServiceOdo)>0)) missing.push('Last service odometer');
  if(insp.fuel===''||insp.fuel===null||insp.fuel===undefined) missing.push('Fuel level');
  if(!String(insp.condition||'').trim()) missing.push('Condition');
  if(!j.saId||j.saId==='TBA') missing.push('Service Adviser');
  if(!(j.mechanicIds||[]).filter(function(id){return id&&id!=='TBA';}).length) missing.push('Mechanic(s)');
  return missing;
}
/* Map each "missing field" label to the input it corresponds to in the Ingress
   form and the Edit-Job-Details form, so a gate prompt can visually highlight
   the exact boxes still to fill. Fields captured elsewhere (Service Adviser /
   Mechanics live on the Assignment tab) have no entry here — they still appear
   in the checklist, just without an input to outline. */
var INGRESS_FIELD_INPUT = {
  'Plate':'inPlate','Registered owner':'inOwner','Contact person':'inCP','Contact #':'inContact',
  'Address':'inAddr','Chassis #':'inChassis','Year':'inYear','Make':'inMake','Model':'inModel',
  'Ingress odometer':'inOdo' };
var JOBDETAIL_FIELD_INPUT = {
  'Registered owner':'jdOwner','Contact person':'jdCP','Contact #':'jdContact','Address':'jdAddr',
  'Chassis #':'jdChassis','Year':'jdYear','Make':'jdMake','Model':'jdModel','Ingress odometer':'jdOdo',
  'Date in':'jdDateIn','ETD':'jdEtd','Last service odometer':'jdLastOdo','Fuel level':'jdFuel','Condition':'jdCond' };
/* A scannable checklist of the still-missing fields (replaces a comma list). */
function missingChecklist(missing){
  return '<ul class="misslist">'+missing.map(function(m){
    return '<li><span class="mx">✕</span>'+esc(m)+'</li>'; }).join('')+'</ul>';
}
/* After a gate form renders, outline the empty required boxes and jump to the
   first, so the user sees exactly what to complete. The outline clears itself as
   each box is filled. `map` is label→input-id. */
function highlightMissing(map, missing){
  if(typeof document==='undefined' || !missing || !missing.length) return;
  setTimeout(function(){
    var first=null;
    missing.forEach(function(label){
      var id=map[label]; if(!id) return;
      var el=document.getElementById(id); if(!el) return;
      var box=(el.closest && el.closest('.fld')) || el;
      box.classList.add('needfill');
      var clear=function(){ if(String(el.value||'').trim()){ box.classList.remove('needfill');
        el.removeEventListener('input',clear); el.removeEventListener('change',clear); } };
      el.addEventListener('input',clear); el.addEventListener('change',clear);
      if(!first) first=el;
    });
    if(first){ try{ first.focus(); first.scrollIntoView({block:'center'}); }catch(e){} }
  }, 30);
}
function openIntake(draft){
  openModal('Ingress — front desk', intakeForm(draft||{}), {
    footer:'<button class="btn ghost" onclick="closeModal()">Cancel</button>'+
      '<button class="btn ghost" onclick="intakeSubmit(\'estimate\')">Create Estimate</button>'+
      '<button class="btn primary" onclick="intakeSubmit(\'job\')">Create Job Order</button>', width:'680px' });
}
function intakeForm(d){
  return '<div class="grid2">'+
    field('Plate','<input id="inPlate" value="'+attr(d.plate||'')+'" oninput="intakeLookup()" placeholder="ABC 1234">')+
    field('Registered owner','<input id="inOwner" value="'+attr(d.owner||'')+'">')+
    field('Contact person','<input id="inCP" value="'+attr(d.contactPerson||'')+'">')+
    field('Contact #','<input id="inContact" value="'+attr(d.contactNumber||'')+'">')+
    field('Address','<input id="inAddr" value="'+attr(d.address||'')+'">')+
    field('Chassis #','<input id="inChassis" value="'+attr(d.chassis||'')+'">')+
    field('Year','<input id="inYear" type="number" value="'+attr(d.year||'')+'">')+
    field('Make','<input id="inMake" value="'+attr(d.make||'')+'">')+
    field('Model','<input id="inModel" value="'+attr(d.model||'')+'">')+
    field('Variant','<input id="inVariant" value="'+attr(d.variant||'')+'">')+
    field('Ingress odometer','<input id="inOdo" type="number" value="'+attr(d.odometer||'')+'">')+
    '</div>'+
    field('Concerns / reported issues','<textarea id="inNotes" rows="3">'+esc(d.notes||'')+'</textarea>');
}
function intakeLookup(){ var v=vehicleByPlate(val('inPlate')); if(v){ setVal('inCP',v.contactPerson); setVal('inContact',v.contactNumber);
  setVal('inOwner',v.owner); setVal('inAddr',v.address); setVal('inChassis',v.chassis); setVal('inYear',v.year); setVal('inMake',v.make); setVal('inModel',v.model); setVal('inVariant',v.variant); setVal('inOdo',v.odometer);
  toast('Existing vehicle found — prefilled'); } }
function intakeSubmit(kind){
  var base={ plate:val('inPlate'), contactPerson:val('inCP'), contactNumber:val('inContact'), owner:val('inOwner'),
    address:val('inAddr'), chassis:val('inChassis'), year:val('inYear'), make:val('inMake'), model:val('inModel'), variant:val('inVariant'),
    odometer:Number(val('inOdo'))||0, notes:val('inNotes') };
  if (!base.plate){ toast('Plate is required','err'); return; }
  if (kind==='estimate'){ closeModal(); createEstimateFrom(base).then(function(e){ go('estimate', e.id); }); return; }
  // Job Order: if ingress is incomplete, prompt to finish now or proceed and complete later.
  var missing = jobMissingFields(base);
  if (missing.length){ _ingressDraft=base; promptIncompleteIngress(missing); return; }
  closeModal(); createJob(base).then(function(j){ toast('Job Order '+j.no+' created'); go('job', j.id); });
}
var _ingressDraft=null;
function promptIncompleteIngress(missing){
  openModal('Complete ingress details?',
    '<p class="muted small">These required fields are still blank:</p>'+
    missingChecklist(missing)+
    '<p class="muted small">You can create the Job Order now and finish them later in Job Details — '+
    'but the <b>Post Job Report cannot be created</b> until every field is complete.</p>',
    { footer:'<button class="btn ghost" onclick="reopenIngress()">‹ Go back &amp; complete</button>'+
      '<span style="flex:1"></span>'+
      '<button class="btn primary" onclick="createJobAnyway()">Create, finish later</button>', width:'520px' });
}
function reopenIngress(){ var d=_ingressDraft||{}; openIntake(d); highlightMissing(INGRESS_FIELD_INPUT, jobMissingFields(d)); }
function createJobAnyway(){ var b=_ingressDraft||{}; _ingressDraft=null; closeModal(); createJob(b).then(function(j){ toast('Job Order '+j.no+' created — complete the remaining details later'); go('job', j.id); }); }

/* ---- Job Orders list ------------------------------------------------------ */
var JOB_Q='';
function jobMatch(j){
  if(!JOB_Q) return true; var q=JOB_Q.toLowerCase();
  var staffTxt=staffSearchStr((j.mechanicIds||[]).concat([j.saId,j.assessedBy,j.partsSalesman]));
  return [j.no,j.plate,j.owner,j.contactPerson,j.make+' '+j.model,j.siRef,j.pmsRef,staffTxt].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function jobsBodyHTML(){
  var jobs=S.jobs.filter(jobMatch);
  if(!jobs.length) return emptyState(JOB_Q? 'No job orders match “'+esc(JOB_Q)+'”.' : 'No job orders yet. Click New Ingress.');
  var rows = jobs.map(function(j){
    var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
    return '<tr onclick="go(\'job\',\''+j.id+'\')">'+
      '<td><b>'+esc(j.no)+'</b></td>'+
      '<td><b>'+esc(j.plate)+'</b>'+(veh?' <span class="muted small">'+esc(veh)+'</span>':'')+'</td>'+
      '<td>'+chip(j.stage, j.stage==='Released'?'ok':j.stage==='Job Order'?'':'gold')+'</td>'+
      '<td>'+statusBadge(j.status)+'</td>'+
      '<td>'+esc(fmtDate(j.dateIn))+'</td>'+
      '<td class="r">'+peso(jobGross(j))+'</td>'+
      '<td class="r">'+(jobBalance(j)>0?'<span class="amber">'+peso(jobBalance(j))+'</span>':'—')+'</td></tr>';
  }).join('');
  return '<div class="card pad0"><table class="tbl click"><thead><tr>'+
    '<th>JO #</th><th>Plate / Vehicle</th><th>Stage</th><th>Status</th><th>Date in</th><th class="r">Bill</th><th class="r">Balance</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function jobsSearch(v){ JOB_Q=v; var el=document.getElementById('jobsBody'); if(el) el.innerHTML=jobsBodyHTML(); }
VIEWS.jobs = function(){
  var search='<input class="searchbox" id="jobsSearch" value="'+attr(JOB_Q)+'" oninput="jobsSearch(this.value)" placeholder="Search JO# / plate / owner / contact…" autocomplete="off">';
  return '<div class="page"><div class="page-head"><h1>Job Orders</h1><div class="row gap wrap">'+search+
    '<button class="btn primary" onclick="openIntake()">＋ New Ingress</button></div></div>'+
    '<div id="jobsBody">'+jobsBodyHTML()+'</div>'+
  '</div>';
};

/* ---- Job detail ----------------------------------------------------------- */
function stageStep(job){
  var stages=['Job Order','Post Job Report','Final Billing','Released'];
  var idx=stages.indexOf(job.stage);
  return '<div class="stepper">'+stages.map(function(s,i){
    var cls=i<idx?'done':i===idx?'cur':'';
    return '<div class="step '+cls+'"><span class="dot">'+(i<idx?'✓':(i+1))+'</span>'+esc(s)+'</div>';
  }).join('<span class="step-line"></span>')+'</div>';
}

VIEWS.job = function(id){
  var j = jobById(id) || S.jobs[0];
  if (!j) return emptyState('Job not found.');
  var bill = runningBill(j);
  return '<div class="page">'+
    '<div class="page-head"><div><a class="back" onclick="go(\'jobs\')">‹ Job Orders</a>'+
      '<h1>'+esc(j.no)+' · '+esc(j.plate)+((j.year+' '+j.make+' '+j.model).trim()?' · '+esc((j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'')):'')+' '+statusBadge(j.status)+'</h1></div>'+
      '<div class="row gap">'+jobPrintButtons(j)+
        (((typeof isAdminUser!=='function')||isAdminUser())?'<button class="btn danger ghost" onclick="deleteJobConfirm(\''+j.id+'\')">🗑 Delete</button>':'')+
      '</div></div>'+
    stageStep(j)+
    '<div class="cols">'+
      '<div class="colmain">'+
        jobStatusPanel(j)+
        jobLinesPanel(j)+
        (typeof pmsReportPanel==='function'?pmsReportPanel(j):'')+
        jobInspectionPanel(j)+
        jobPhotosPanel(j)+
      '</div>'+
      '<div class="colside">'+
        jobBillPanel(j,bill)+
        jobAssignPanel(j)+
        jobDetailsPanel(j)+
        jobStagePanel(j,bill)+
      '</div>'+
    '</div>'+
  '</div>';
};

function jobPrintButtons(j){
  var btns='<button class="btn ghost" onclick="printJobOrder(\''+j.id+'\')">⎙ Job Order</button>';
  if (j.stage!=='Job Order') btns+='<button class="btn ghost" onclick="printPostJob(\''+j.id+'\')">⎙ Post Job Report</button>';
  if (j.stage==='Final Billing'||j.stage==='Released') btns+='<button class="btn ghost" onclick="printBilling(\''+j.id+'\')">⎙ Final Billing</button>';
  return btns;
}

/* ---- Status / clipboard panel --------------------------------------------- */
function jobStatusPanel(j){
  var log = (j.statusLog||[]).slice().reverse().map(function(e){
    return '<div class="log-row">'+statusBadge(e.code)+'<div class="log-body"><div class="log-note">'+esc(e.note||'')+'</div>'+
      '<div class="log-meta">'+esc(staffName(e.by))+' · '+esc(fmtDateTime(e.time))+'</div></div></div>';
  }).join('') || emptyState('No updates logged yet.');
  var due = isUpdateDue(j) ? '<span class="amber">⚑ Update due (clipboard checkpoint passed)</span>' : '';
  return '<div class="card"><div class="card-head"><h2>Status & Clipboard Log</h2>'+
    '<button class="btn sm primary" onclick="logUpdate(\''+j.id+'\')">＋ Log update</button></div>'+
    (due?'<div class="due-banner">'+due+'</div>':'')+
    '<div class="curstat">Current: '+statusBadge(j.status)+' <span class="muted">'+esc(STATUS[j.status]||'')+'</span></div>'+
    '<div class="log">'+log+'</div></div>';
}
function logUpdate(id){
  var j=jobById(id);
  var opts = STATUS_ORDER.map(function(c){return '<option value="'+c+'"'+(c===j.status?' selected':'')+'>'+c+' — '+esc(STATUS[c])+'</option>';}).join('');
  // No preselection — the person logging must deliberately pick who is updating,
  // so every entry carries a real, accountable name.
  var who = optionList(S.staff, '', false);
  openModal('Log clipboard update',
    field('Status code','<select id="luCode">'+opts+'</select>')+
    field('Updated by','<select id="luBy">'+who+'</select>','Required — records who made this update')+
    field('Note','<textarea id="luNote" rows="2" placeholder="e.g. Brake pads installed, bleeding lines."></textarea>'),
    { onOk:'saveUpdate', okText:'Log' });
  setTimeout(function(){ openModalCtx=id; },10);
}
var openModalCtx=null;
function saveUpdate(){
  var j=jobById(openModalCtx); if(!j) return;
  // Gate: no "Updated by" → the log is NOT saved. Highlight the box and stop.
  var by=val('luBy');
  if(!by || !staffById(by)){
    toast('Select who is logging this update — it won’t be saved without it','err');
    var el=document.getElementById('luBy');
    var box=(el && el.closest) ? el.closest('.fld') : null;
    if(box){ box.classList.add('needfill');
      var clr=function(){ if(val('luBy')){ box.classList.remove('needfill'); el.removeEventListener('change',clr); } };
      el.addEventListener('change',clr);
    }
    if(el){ try{ el.focus(); }catch(e){} }
    return;
  }
  var code=val('luCode');
  j.status=code;
  j.statusLog.push({ time:new Date().toISOString(), code:code, by:by, note:val('luNote') });
  persist(); closeModal(); toast('Update logged'); render();
}

/* ---- Lines panel ---------------------------------------------------------- */
function runningBill(j){
  var parts=partsTotal(j.lines), labor=laborTotal(j.lines), addl=addlTotal(j);
  var base=round2(parts+labor+addl);          // VATable base = SRP total
  var vs=vatSplit(base,S);                      // exclusive: vat added on top
  var subtotal=vs.gross;                        // VATable + VAT (before discount)
  var disc=discountAmount(j);                    // taken off the total
  var gross=round2(subtotal-disc);              // Total Amount Due
  return { parts:parts, labor:labor, addl:addl, base:base, subtotal:subtotal, disc:disc, gross:gross,
    vatable:vs.vatable, vat:vs.vat, exempt:vs.exempt, paid:jobPaid(j), balance:jobBalance(j) };
}
function jobLinesPanel(j){
  // Once Final Billing is issued (OR # assigned) lines lock — but a user with the
  // 'billing_edit' permission can still edit them even after billing is done.
  var billed = (j.stage==='Final Billing' || j.stage==='Released');
  var locked = billed && !can('billing_edit');
  function tbl(type, title){
    var list=(j.lines||[]).filter(function(l){return l.type===type;});
    var rows = list.map(function(l){
      return '<tr>'+
        '<td>'+(type==='part'&&l.sku?'<span class="muted small">'+esc(l.sku)+'</span> ':'')+esc(l.desc)+'</td><td class="r">'+num(l.qty)+'</td>'+
        '<td class="r">'+peso(l.price)+'</td><td class="r">'+peso(lineTotal(l))+'</td>'+
        '<td class="r">'+(locked?'':'<button class="ic" onclick="editLine(\''+j.id+'\',\''+l.id+'\')">✎</button>'+
          '<button class="ic" onclick="delLine(\''+j.id+'\',\''+l.id+'\')">✕</button>')+'</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted center">No '+(type==='part'?'parts':'labor')+' yet.</td></tr>';
    return '<div class="card"><div class="card-head"><h2>'+title+'</h2>'+
      (locked?'':'<button class="btn sm primary" onclick="addLine(\''+j.id+'\',\''+type+'\')">＋ Add '+(type==='part'?'part':'labor')+'</button>')+'</div>'+
      '<table class="tbl"><thead><tr><th>'+(type==='part'?'Part':'Description')+'</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th><th></th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>';
  }
  return tbl('part','Parts') + tbl('labor','Labor');
}
/* Line editor. Part lines: Qty → SKU (auto-fills Part Name / Net Price / SRP from
   the parts catalog, all editable) with full manual entry when no SKU is used.
   Labor lines: pick from the labor menu or free-text. */
function lineForm(l){
  l=l||{type:'part',qty:1,price:0,desc:''};
  // Parts and labor are encoded separately — the type is fixed by which panel's
  // Add button opened the dialog, so no Type selector is shown.
  return '<input type="hidden" id="lnType" value="'+(l.type==='labor'?'labor':'part')+'">'+
    '<div id="lnFields">'+ (l.type==='labor' ? laborFields(l) : partFields(l)) +'</div>';
}
/* Numeric line fields are type="text" + inputmode so the value can be SELECTED
   on focus (number inputs can't be text-selected) — the default "1" highlights
   and the first keystroke overwrites it, for a keyboard-only add flow. */
function partFields(l){
  return '<div class="grid2">'+
    field('Qty','<input id="lnQty" type="text" inputmode="decimal" value="'+attr(l.qty||1)+'" onfocus="this.select()">')+
    field('SKU','<input id="lnSku" value="'+attr(l.sku||'')+'" oninput="skuLookup()" placeholder="type SKU…" autocomplete="off">')+
    '</div>'+
    field('Part name','<input id="lnDesc" value="'+attr(l.desc||'')+'" placeholder="auto-fills from SKU, or type">')+
    '<div class="grid2">'+
    field('Net price','<input id="lnNet" type="text" inputmode="decimal" value="'+attr(l.netPrice||0)+'" onfocus="this.select()">')+
    field('SRP','<input id="lnPrice" type="text" inputmode="decimal" value="'+attr(l.price||0)+'" onfocus="this.select()">')+
    '</div><div id="skuMsg" class="muted small">'+catalogHint()+'</div>';
}
function laborFields(l){
  var laborOpts='<option value="">— free text —</option>'+laborList().map(function(p){return '<option value="'+p.id+'" data-price="'+p.price+'" data-name="'+attr(p.name)+'"'+(l.ref===p.id?' selected':'')+'>'+esc(p.name)+'</option>';}).join('');
  return field('From menu','<select id="lnRef" onchange="laborPick()">'+laborOpts+'</select>')+
    field('Description','<input id="lnDesc" value="'+attr(l.desc||'')+'">')+
    '<div class="grid2">'+field('Qty','<input id="lnQty" type="text" inputmode="decimal" value="'+attr(l.qty||1)+'" onfocus="this.select()">')+
    field('Price','<input id="lnPrice" type="text" inputmode="decimal" value="'+attr(l.price||0)+'" onfocus="this.select()">')+'</div>'+
    '<div id="pmsLaborBtn">'+(typeof pmsLaborBtnHTML==='function'?pmsLaborBtnHTML(l.ref):'')+'</div>';
}
function catalogHint(){
  if (typeof CATALOG_STATE==='undefined') return '';
  if (CATALOG_STATE==='ready') return 'Catalog ready — type a SKU to auto-fill.';
  if (CATALOG_STATE==='loading') return 'Loading parts catalog…';
  return '';
}
function skuLookup(){
  var sku=(val('lnSku')||'').trim(); var msg=document.getElementById('skuMsg');
  if(!sku){ if(msg) msg.textContent=catalogHint(); return; }
  var hit = (typeof catalogLookup==='function') ? catalogLookup(sku) : null;
  if(hit){ setVal('lnDesc',hit.name); setVal('lnNet',hit.net); setVal('lnPrice',hit.srp); if(msg){ msg.textContent='✓ '+hit.name; msg.className='ok small'; } }
  else if(msg){ msg.textContent = (typeof CATALOG_STATE!=='undefined'&&CATALOG_STATE==='loading')?'Loading catalog…':'No match — enter the details manually.'; msg.className='muted small'; }
}
function laborPick(){ var sel=document.getElementById('lnRef'); var o=sel.options[sel.selectedIndex];
  if(o&&o.value){ setVal('lnDesc',o.getAttribute('data-name')); setVal('lnPrice',o.getAttribute('data-price')); }
  var box=document.getElementById('pmsLaborBtn'); if(box&&typeof pmsLaborBtnHTML==='function') box.innerHTML=pmsLaborBtnHTML(o?o.value:''); }
var _pmsLineJob=null;   // job id when a JOB add-labor dialog is open (gates the "Perform PMS" button)
function addLine(id,type){
  lineCtx={job:id,line:null,type:type||'part'};
  _pmsLineJob=id;
  openModal(type==='labor'?'Add labor':'Add parts', lineForm({type:type||'part'}), {
    footer:'<button class="btn ghost" onclick="closeModal()">Done</button>'+
      '<span style="flex:1"></span>'+
      '<button class="btn primary" onclick="saveLineMore()">Add line</button>' });
  refocusLineForm();   // land on Qty (parts) / menu (labor), value selected
}
/* Save the line but KEEP the dialog open, reset for the next line — so you can
   add line after line without leaving the box. (Enter on the last field does this.) */
function saveLineMore(){
  var j=jobById(lineCtx.job); if(!j) return;
  var data=readLine();
  if(!data.desc){ toast(data.type==='part'?'Part name required':'Description required','err'); return; }
  data.id=uid('ln'); j.lines.push(data); persist();
  toast('Added · '+data.desc);
  render();                                   // refresh the lines table behind the dialog
  var body=document.querySelector('#modalRoot .modal-body');
  if(body){ body.innerHTML=lineForm({type:data.type}); }   // fresh form, same Type for fast repeats
  refocusLineForm();
}
/* Return focus to the FIRST real field of the line form — Qty for parts, the
   labor menu for labor — and select its value so the next keystroke overwrites.
   Must skip the hidden #lnType input, which is first in the DOM but unfocusable. */
function refocusLineForm(){
  setTimeout(function(){
    var f=document.querySelector('#modalRoot .modal-body input:not([type=hidden]),#modalRoot .modal-body select');
    if(f&&f.focus){ f.focus(); if(f.select){ try{f.select();}catch(_){} } }
  }, 20);
}
function editLine(id,lid){ var j=jobById(id); var l=j.lines.find(function(x){return x.id===lid;}); _pmsLineJob=null;
  openModal('Edit line', lineForm(l), { onOk:'saveLine' }); setTimeout(function(){lineCtx={job:id,line:lid};},10); }
var lineCtx=null;
function readLine(){
  var type=val('lnType');
  if(type==='labor'){
    return { type:'labor', ref:val('lnRef')||null, sku:'', netPrice:0, desc:val('lnDesc'), qty:Number(val('lnQty'))||0, price:Number(val('lnPrice'))||0 };
  }
  return { type:'part', ref:null, sku:(val('lnSku')||'').trim(), desc:val('lnDesc'),
    netPrice:Number(val('lnNet'))||0, qty:Number(val('lnQty'))||0, price:Number(val('lnPrice'))||0 };
}
function saveLine(){
  var j=jobById(lineCtx.job); var data=readLine();
  if(!data.desc){ toast(data.type==='part'?'Part name required':'Description required','err'); return; }
  if(lineCtx.line){ var l=j.lines.find(function(x){return x.id===lineCtx.line;}); Object.assign(l,data); }
  else { data.id=uid('ln'); j.lines.push(data); }
  persist(); closeModal(); render();
}
function delLine(id,lid){
  var j=jobById(id); var l=(j.lines||[]).find(function(x){return x.id===lid;});
  // Removing the PMS LABOR line while a PMS is still queued/in-progress:
  // confirm once, and if the user is sure also cancel & remove that PMS queue ticket.
  // A job line points at its catalog item via .ref (its own .id is a line uid),
  // so match PMS LABOR on the ref — isPmsLabor() alone is for catalog items.
  var lineIsPms = l && l.type==='labor' && typeof PMS_LABOR_ID!=='undefined' && l.ref===PMS_LABOR_ID;
  if(lineIsPms && typeof jobHasOpenPMS==='function' && jobHasOpenPMS(j)){
    confirmModal('Remove PMS LABOR?',
      'A PMS inspection is currently in the queue for this vehicle. Deleting this line will also cancel that PMS and remove it from the queue. Continue?',
      function(){
        j.lines=j.lines.filter(function(x){return x.id!==lid;});
        j.pms=null;                       // cancel & clear the queued PMS ticket
        persist(); render();
        toast('PMS LABOR removed · PMS queue cancelled');
      },'Delete', true);
    return;
  }
  j.lines=j.lines.filter(function(x){return x.id!==lid;}); persist(); render();
}

/* Admin-only: delete an entire job order (with warning). */
function deleteJobConfirm(id){
  if (typeof isAdminUser==='function' && !isAdminUser()){ toast('Admins only','err'); return; }
  var j=jobById(id); if(!j) return;
  confirmModal('Delete this job order?',
    'This permanently deletes '+(j.no||'')+' ('+(j.plate||'')+') and everything in it — line items, status log, billing, payments and photos. This cannot be undone.',
    function(){
      S.jobs=S.jobs.filter(function(x){return x.id!==id;});
      persist(); closeModal(); toast('Job order deleted'); go('jobs');
    },'Delete job order', true);
}

/* Additional Work panel removed — extra work discovered mid-job is added
   directly to the Parts / Labor lines of the ongoing job order. Legacy
   addlWork entries on old jobs still render in bills and printouts. */

/* ---- Inspection / check-in panel ------------------------------------------ */
var CHECKLIST_ITEMS=['Spare tire','Jack & wrench','Stereo / head unit','Floor mats','Valuables','OR/CR','Tools','Fire extinguisher','Early warning device'];
function jobInspectionPanel(j){
  var insp=j.inspection||{}; var cl=j.checklist||{items:{}};
  var items = CHECKLIST_ITEMS.map(function(it){
    var on = cl.items&&cl.items[it];
    return '<label class="chk small"><input type="checkbox" disabled '+(on?'checked':'')+'> '+esc(it)+'</label>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Vehicle Check-in</h2>'+
    '<button class="btn sm" onclick="editInspection(\''+j.id+'\')">Edit check-in</button></div>'+
    '<div class="grid2 ksmall">'+
      kv('Ingress odometer', odo(insp.odometer))+ kv('Fuel level', fmtFuel(insp.fuel))+
      kv('Dash lights / DTC', insp.lights||'None')+ kv('Condition', insp.condition||'—')+
    '</div>'+
    (cl.created? '<div class="checklist"><div class="cl-title">Items left in vehicle '+(cl.leaveUnit?'':'(unit not left)')+'</div>'+
      '<div class="cl-items">'+items+'</div>'+
      (cl.bodyNotes?'<div class="muted small">Body notes: '+esc(cl.bodyNotes)+'</div>':'')+'</div>'
      : '<p class="muted small">No items checklist (customer did not leave the unit).</p>')+
  '</div>';
}
function kv(k,v){ return '<div class="kv"><span class="kv-k">'+esc(k)+'</span><span class="kv-v">'+v+'</span></div>'; }
function editInspection(id){
  var j=jobById(id); var insp=j.inspection||{}; var cl=j.checklist||{items:{}};
  var items=CHECKLIST_ITEMS.map(function(it){ var on=cl.items&&cl.items[it];
    return '<label class="chk small"><input type="checkbox" id="ck_'+btoa(it).replace(/=/g,'')+'" '+(on?'checked':'')+'> '+esc(it)+'</label>'; }).join('');
  openModal('Vehicle check-in inspection',
    '<div class="grid2">'+field('Ingress odometer','<input id="isOdo" type="number" value="'+attr(insp.odometer||j.odometer)+'">')+
    field('Fuel level %','<input id="isFuel" type="number" min="0" max="100" value="'+attr(isFinite(insp.fuel)?insp.fuel:'')+'" placeholder="e.g. 50">')+
    field('Dash lights / DTC','<input id="isLights" value="'+attr(insp.lights||'')+'">')+
    field('General condition','<input id="isCond" value="'+attr(insp.condition||'')+'">')+'</div>'+
    '<label class="chk"><input type="checkbox" id="isLeave" '+(cl.leaveUnit?'checked':'')+'> Customer is leaving the unit (create items checklist)</label>'+
    '<div class="cl-title">Items left in vehicle</div><div class="cl-items">'+items+'</div>'+
    field('Body condition notes','<textarea id="isBody" rows="2">'+esc(cl.bodyNotes||'')+'</textarea>'),
    { onOk:'saveInspection', width:'680px' });
  setTimeout(function(){isCtx=id;},10);
}
var isCtx=null;
function saveInspection(){
  var j=jobById(isCtx);
  j.inspection={ odometer:Number(val('isOdo'))||0, fuel:(val('isFuel')===''?'':Number(val('isFuel'))||0), lights:val('isLights'), condition:val('isCond'), testDrive:j.inspection&&j.inspection.testDrive||'' };
  var leave=checked('isLeave'); var items={};
  CHECKLIST_ITEMS.forEach(function(it){ items[it]=checked('ck_'+btoa(it).replace(/=/g,'')); });
  j.checklist={ created:leave, leaveUnit:leave, items:items, bodyNotes:val('isBody') };
  persist(); closeModal(); toast('Check-in saved'); render();
}

/* ---- Photos panel --------------------------------------------------------- */
function jobPhotosPanel(j){
  var grid=(j.photos||[]).map(function(p){
    return '<div class="thumb"><img src="'+(p.url||p.data)+'" onclick="openLightbox(_photoSrc(\''+j.id+'\',\''+p.id+'\'))"/>'+
      '<button class="thumb-x" onclick="delPhoto(\''+j.id+'\',\''+p.id+'\')">✕</button></div>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Photos <span class="muted small">('+(j.photos||[]).length+'/12)</span></h2>'+
    '<div class="row gap">'+
      '<button class="btn sm ghost" onclick="showPhotoQR(\''+j.id+'\')">📱 Add by phone</button>'+
      '<label class="btn sm"><input type="file" accept="image/*" multiple style="display:none" onchange="addPhotos(\''+j.id+'\',this.files)">＋ Add photos</label>'+
    '</div></div>'+
    '<div class="thumbs">'+(grid||emptyState('No photos attached.'))+'</div></div>';
}
function _photoSrc(jid,pid){ var j=jobById(jid); var p=(j.photos||[]).find(function(x){return x.id===pid;}); return p?(p.url||p.data):''; }

/* ---- "Add photos by phone" QR + mobile uploader --------------------------- */
/* Must encode the branch's PUBLIC URL (S.shop.portalUrl — the same base the
   customer QR stickers use), NOT location.href: staff often view the app on
   localhost / a LAN IP / a file:// path that a phone can't reach. Falls back to
   the current origin only if no public URL is configured. */
function photoUploadBase(){
  var pu = (S.shop && S.shop.portalUrl) ? String(S.shop.portalUrl).trim() : '';
  if (pu) return pu.replace(/\/+$/,'');
  if (typeof location!=='undefined' && location.origin && location.origin.indexOf('http')===0){
    return (location.origin + location.pathname).replace(/\/+$/,'');
  }
  return '';
}
function photoUploadLink(jobId){ return photoUploadBase() + '/#addphoto=' + encodeURIComponent(jobId); }
function showPhotoQR(jobId){
  var j=jobById(jobId); if(!j) return;
  var base=photoUploadBase();
  if(!base){
    openModal('Add photos by phone',
      '<div class="photoqr"><p class="muted">Set your public app address first: <b>Settings → Portal URL</b>. That’s the link a phone scans — without it, the QR points at this computer, which the phone can’t reach.</p></div>',
      { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>', width:'360px' });
    return;
  }
  var url=photoUploadLink(jobId);
  openModal('Add photos by phone',
    '<div class="photoqr">'+
      '<p class="muted">Scan with a phone to snap photos straight into <b>'+esc(j.no||'')+' · '+esc(j.plate||'')+'</b>.</p>'+
      '<div id="photoQRbox" class="qr-box"></div>'+
      '<p class="muted small">First scan asks the phone to sign in once; after that, scanning opens the camera uploader instantly.</p>'+
      '<p class="muted" style="font-size:10.5px;word-break:break-all;opacity:.7">'+esc(url)+'</p>'+
    '</div>',
    { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>', width:'360px' });
  renderQR('photoQRbox', url);
}
/* Stripped-down, mobile-first uploader reached from the QR deep link. Big camera
   button + gallery option, live thumbnails, then straight into the job order. */
VIEWS.photoup = function(jobId){
  var j = jobById(jobId);
  if(!j){
    return '<div class="page photoup"><div class="pu-card">'+
      '<h1>Add photos</h1>'+
      '<p class="muted">Looking for this job order. If this keeps showing, the link may belong to a different branch, or the job was removed.</p>'+
      '<button class="btn" onclick="go(\'board\')">Go to Board</button></div></div>';
  }
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  var n=(j.photos||[]).length;
  var grid=(j.photos||[]).map(function(p){
    return '<div class="thumb"><img src="'+(p.url||p.data)+'" onclick="openLightbox(_photoSrc(\''+j.id+'\',\''+p.id+'\'))"/>'+
      '<button class="thumb-x" onclick="delPhoto(\''+j.id+'\',\''+p.id+'\')">✕</button></div>';
  }).join('');
  return '<div class="page photoup"><div class="pu-card">'+
    '<div class="pu-head"><div class="pu-plate">'+esc(j.plate)+'</div>'+
      '<div class="muted small">'+esc(veh||'—')+' · JO '+esc(j.no)+'</div></div>'+
    '<label class="btn primary pu-shoot"><input type="file" accept="image/*" capture="environment" multiple style="display:none" onchange="addPhotos(\''+j.id+'\',this.files)">📷 Take photo</label>'+
    '<label class="btn ghost pu-pick"><input type="file" accept="image/*" multiple style="display:none" onchange="addPhotos(\''+j.id+'\',this.files)">🖼 Choose from gallery</label>'+
    '<div class="pu-count muted small">'+n+'/12 attached</div>'+
    '<div class="thumbs pu-thumbs">'+(grid||emptyState('No photos yet — tap “Take photo” above.'))+'</div>'+
    '<button class="btn ghost full" onclick="go(\'job\',\''+j.id+'\')">Done — open job order</button>'+
  '</div></div>';
};
function addPhotos(id,files){
  var j=jobById(id);
  handlePhotoFiles(files, function(datas){
    datas.forEach(function(d){ if((j.photos||[]).length>=12) return; j.photos.push({ id:uid('ph'), data:d, caption:'', ts:new Date().toISOString() }); });
    persist(); toast('Photos added'); render();
  });
}
function delPhoto(id,pid){ var j=jobById(id); j.photos=j.photos.filter(function(x){return x.id!==pid;}); persist(); render(); }

/* ---- Running bill panel --------------------------------------------------- */
function jobBillPanel(j,b){
  return '<div class="card billcard"><h2>Running Bill</h2>'+
    line2('Parts', peso(b.parts))+ line2('Labor', peso(b.labor))+
    (b.addl?line2('Additional work', peso(b.addl)):'')+
    '<div class="bill-sep"></div>'+
    (b.exempt? line2('VAT-Exempt Sales', peso(b.vatable))
      : line2('VATable Sales', peso(b.vatable))+line2('VAT ('+(S.shop.vatRate||12)+'%)', peso(b.vat)))+
    (b.disc?line2('Discount', '−'+peso(b.disc), 'disc'):'')+
    line2('<b>Total due</b>', '<b>'+peso(b.gross)+'</b>','tot')+
    (b.paid? line2('Paid', peso(b.paid))+line2('<b>Balance</b>','<b>'+peso(b.balance)+'</b>','tot'):'')+
    '<div class="muted small mt8">Prices are visible in-app only. The Job Order print carries no prices.</div>'+
  '</div>';
}
function line2(k,v,cls){ return '<div class="l2 '+(cls||'')+'"><span>'+k+'</span><span>'+v+'</span></div>'; }

/* ---- Assignment panel ----------------------------------------------------- */
function jobAssignPanel(j){
  var mechBoxes = mechanicStaff().map(function(m){
    var on=(j.mechanicIds||[]).indexOf(m.id)>=0;
    return '<label class="chk small"><input type="checkbox" '+(on?'checked':'')+' onchange="toggleMech(\''+j.id+'\',\''+m.id+'\')"> '+esc(m.name)+'</label>';
  }).join('');
  return '<div class="card"><h2>Assignment</h2>'+
    field('Service Adviser','<select onchange="setJobField(\''+j.id+'\',\'saId\',this.value)">'+optionList(staffByRole('SA'),j.saId,true)+'</select>')+
    '<div class="fld"><span class="fld-l">Mechanic(s)</span><div class="mechbox">'+(mechBoxes||'<span class="muted small">No mechanics</span>')+
      '<label class="chk small"><input type="checkbox" '+((j.mechanicIds||[]).indexOf('TBA')>=0?'checked':'')+' onchange="toggleMech(\''+j.id+'\',\'TBA\')"> TBA</label></div></div>'+
    field('Service Bay','<select onchange="setJobField(\''+j.id+'\',\'bayId\',this.value)">'+optionList(S.bays,j.bayId,true)+'</select>')+
    field('Parts Salesman','<select onchange="setJobField(\''+j.id+'\',\'partsSalesman\',this.value)">'+optionList(staffByRole('Parts Salesman'),j.partsSalesman,true)+'</select>')+
    field('Job hours','<input type="number" step="0.5" min="0" value="'+attr(j.jobHours||0)+'" onchange="setJobField(\''+j.id+'\',\'jobHours\',Number(this.value)||0)">')+
  '</div>';
}
function toggleMech(id,mid){ var j=jobById(id); var arr=j.mechanicIds||[]; var i=arr.indexOf(mid);
  if(i>=0) arr.splice(i,1); else arr.push(mid); j.mechanicIds=arr.filter(function(x){return x;}); persist(); render(); }
function setJobField(id,f,v){ var j=jobById(id); j[f]=v; persist(); }

/* ---- Job details / notes panel --------------------------------------------
   Auto-filled summary — every value is sourced from the Ingress form, the
   Vehicle Check-in and the Assignment tab; nothing is entered here directly
   (Edit is available for corrections). Missing required ingress fields are
   flagged so staff know what still blocks the Post Job Report. */
function jobDetailsPanel(j){
  var insp=j.inspection||{};
  var missing=jobMissingFields(j);
  var banner = missing.length
    ? '<div class="due-banner"><span class="amber">⚑ Incomplete ingress — finish before Post Job Report: '+missing.map(esc).join(', ')+'</span></div>'
    : '';
  return '<div class="card"><div class="card-head"><h2>Job Details</h2><button class="btn sm" onclick="editJobDetails(\''+j.id+'\')">Edit</button></div>'+
    banner+
    '<div class="ksmall">'+
      /* from Ingress */
      kv('Owner', esc(j.owner||'—'))+ kv('Contact', esc((j.contactPerson||'')+' · '+(j.contactNumber||'')))+
      kv('Address', esc(j.address||'—'))+ kv('Chassis #', esc(j.chassis||'—'))+
      kv('Vehicle', esc((j.year+' '+j.make+' '+j.model).trim()||'—'))+ kv('Variant', esc(j.variant||'—'))+
      kv('Date in', fmtDate(j.dateIn))+ kv('ETD', fmtDate(j.etd))+
      kv('Ingress odometer', odo(j.odometer))+
      (j.lastServiceOdo? kv('Last service odometer', odo(j.lastServiceOdo)) : '')+
      /* from Vehicle Check-in */
      kv('Fuel level', fmtFuel(insp.fuel))+ kv('Condition', esc(insp.condition||'—'))+
      /* from Assignment */
      kv('Service Adviser', esc(staffName(j.saId)))+ kv('Mechanic(s)', esc(mechName(j.mechanicIds)))+
      kv('Service Bay', esc(bayName(j.bayId)))+ kv('Parts Salesman', esc(staffName(j.partsSalesman)))+
      kv('Job hours', num(j.jobHours))+ kv('Assessed by', esc(staffName(j.assessedBy)))+
      kv('SI ref', esc(j.siRef||'—'))+ kv('PMS ref', esc(j.pmsRef||'—'))+
    '</div>'+
    (j.notes? '<div class="notes"><b>Concerns / reported issues</b><p>'+esc(j.notes)+'</p></div>':'')+
  '</div>';
}
function editJobDetails(id){
  var j=jobById(id);
  openModal('Edit job details',
    '<div class="grid2">'+
    field('Owner','<input id="jdOwner" value="'+attr(j.owner)+'">')+
    field('Address','<input id="jdAddr" value="'+attr(j.address)+'">')+
    field('Contact person','<input id="jdCP" value="'+attr(j.contactPerson)+'">')+
    field('Contact #','<input id="jdContact" value="'+attr(j.contactNumber)+'">')+
    field('Customer TIN','<input id="jdTin" value="'+attr(j.customerTin||'')+'">')+
    field('Chassis #','<input id="jdChassis" value="'+attr(j.chassis)+'">')+
    field('Year','<input id="jdYear" type="number" value="'+attr(j.year||'')+'">')+
    field('Make','<input id="jdMake" value="'+attr(j.make||'')+'">')+
    field('Model','<input id="jdModel" value="'+attr(j.model||'')+'">')+
    field('Variant','<input id="jdVariant" value="'+attr(j.variant||'')+'">')+
    field('Date in','<input id="jdDateIn" type="date" value="'+attr(j.dateIn)+'">')+
    field('ETD','<input id="jdEtd" type="date" value="'+attr(j.etd)+'">'+
      '<label class="chk small"><input type="checkbox" id="jdEtdSame" onchange="if(this.checked){setVal(\'jdEtd\',val(\'jdDateIn\'));}"'+(j.etd&&j.etd===j.dateIn?' checked':'')+'> Same as Date in</label>')+
    field('Ingress odometer','<input id="jdOdo" type="number" value="'+attr(j.odometer)+'">')+
    field('Last service odometer','<input id="jdLastOdo" type="number" value="'+attr(j.lastServiceOdo||'')+'" placeholder="set on release">'+
      '<label class="chk small"><input type="checkbox" id="jdLastOdoSame" onchange="if(this.checked){setVal(\'jdLastOdo\',val(\'jdOdo\'));}"'+(j.lastServiceOdo&&Number(j.lastServiceOdo)===Number(j.odometer)?' checked':'')+'> Same as Ingress</label>')+
    field('Job hours','<input id="jdHours" type="number" step="0.5" value="'+attr(j.jobHours)+'">')+
    field('Fuel level %','<input id="jdFuel" type="number" min="0" max="100" value="'+attr(isFinite((j.inspection||{}).fuel)?(j.inspection||{}).fuel:'')+'" placeholder="e.g. 50">')+
    field('Condition','<input id="jdCond" value="'+attr((j.inspection||{}).condition||'')+'">')+
    field('Assessed by (Senior Mechanic)','<select id="jdAssess">'+optionList(staffByRole('SM'),j.assessedBy,true)+'</select>')+
    field('SI reference #','<input id="jdSI" value="'+attr(j.siRef||'')+'">')+
    field('PMS reference #','<input id="jdPMS" value="'+attr(j.pmsRef||'')+'">')+
    '</div>'+ field('Service notes','<textarea id="jdNotes" rows="3">'+esc(j.notes||'')+'</textarea>'),
    { onOk:'saveJobDetails', width:'700px' });
  setTimeout(function(){jdCtx=id;},10);
  highlightMissing(JOBDETAIL_FIELD_INPUT, postJobMissingFields(j));
}
var jdCtx=null;
function saveJobDetails(){
  var j=jobById(jdCtx);
  j.owner=val('jdOwner'); j.address=val('jdAddr'); j.contactPerson=val('jdCP'); j.contactNumber=val('jdContact');
  j.customerTin=val('jdTin'); j.chassis=val('jdChassis'); j.year=val('jdYear'); j.make=val('jdMake'); j.model=val('jdModel'); j.variant=val('jdVariant'); j.dateIn=val('jdDateIn'); j.etd=val('jdEtd');
  j.odometer=Number(val('jdOdo'))||0; j.lastServiceOdo=val('jdLastOdo')===''?'':Number(val('jdLastOdo'))||0; j.jobHours=Number(val('jdHours'))||0; j.assessedBy=val('jdAssess');
  j.inspection=j.inspection||{}; j.inspection.fuel=(val('jdFuel')===''?'':Number(val('jdFuel'))||0); j.inspection.condition=val('jdCond');
  j.siRef=val('jdSI'); j.pmsRef=val('jdPMS'); j.notes=val('jdNotes');
  persist(); closeModal(); render();
}

/* ---- Stage advancement panel ---------------------------------------------- */
function jobStagePanel(j,b){
  var html='<div class="card"><h2>Pipeline</h2>';
  if (j.stage==='Job Order'){
    var canPost = j.status==='C3';
    html+='<p class="muted small">Advance to <b>Post Job Report</b> once status is <b>C3 (Release cleared)</b>. This deducts consumed parts from inventory and reveals prices on the printout.</p>'+
      (canPost? '<div class="grid2">'+field('Approved for release by (Supervisor)','<select id="apvRel">'+optionList(staffByRole('SV'),j.approvedReleaseBy,false)+'</select>')+'</div>'+
        '<button class="btn primary full" onclick="advancePostJob(\''+j.id+'\')">Create Post Job Report →</button>'
        : '<div class="lock">🔒 Locked until C3. Current: '+statusBadge(j.status)+'</div>'+
          '<button class="btn sm full" onclick="quickC3(\''+j.id+'\')">Mark C3 (Release cleared)</button>');
  } else if (j.stage==='Post Job Report'){
    html+='<p class="muted small">Apply discounts and issue the BIR VAT invoice in <b>Final Billing</b>.</p>'+
      discountEditor(j,'dsc')+
      '<button class="btn ghost sm" onclick="applyDiscount(\''+j.id+'\')">Apply discount</button>'+
      '<div class="grid2 mt8">'+
      field('Approved for release by (Supervisor)','<select onchange="setJobField(\''+j.id+'\',\'approvedReleaseBy\',this.value)">'+optionList(staffByRole('SV'),j.approvedReleaseBy,true)+'</select>')+
      field('Payment received by (Secretary)','<select onchange="setJobField(\''+j.id+'\',\'paymentReceivedBy\',this.value)">'+optionList(staffByRole('Secretary'),j.paymentReceivedBy,true)+'</select>')+'</div>'+
      '<button class="btn primary full mt8" onclick="advanceBilling(\''+j.id+'\')">Create Final Billing (assign OR #) →</button>';
  } else if (j.stage==='Final Billing'){
    html+= billingEditBlock(j) + jobPaymentBlock(j,b);
  } else {
    html+='<div class="released">✓ Released'+(j.orNumber?' · OR '+esc(j.orNumber):'')+'<div class="muted small">'+esc(fmtDateTime(j.billedAt))+'</div></div>'+
      billingEditBlock(j);
  }
  html+='</div>';
  return html;
}
/* Re-open billing: discount, SI reference and (via the lines panel) line items can
   be edited even after Final Billing is issued — gated by the 'billing_edit' cap. */
function billingEditBlock(j){
  if(!can('billing_edit')) return '';
  return '<details class="billedit"'+(j.stage==='Final Billing'?' open':'')+'><summary>✎ Edit billing &amp; discount</summary>'+
    '<div class="grid2 mt8">'+
    field('Approved for release by (Supervisor)','<select onchange="setJobField(\''+j.id+'\',\'approvedReleaseBy\',this.value)">'+optionList(staffByRole('SV'),j.approvedReleaseBy,true)+'</select>')+
    field('Payment received by (Secretary)','<select onchange="setJobField(\''+j.id+'\',\'paymentReceivedBy\',this.value)">'+optionList(staffByRole('Secretary'),j.paymentReceivedBy,true)+'</select>')+'</div>'+
    discountEditor(j,'bd')+
    field('SI reference #','<input id="bdSI" value="'+attr(j.siRef||'')+'" placeholder="appears on Final Billing">')+
    '<button class="btn primary sm" onclick="saveBillingEdits(\''+j.id+'\')">Apply changes</button>'+
    '<p class="muted small">Recomputes the Total Amount Due; the balance updates to match. Edit line items above with the ✎ buttons.</p>'+
  '</details>';
}
function saveBillingEdits(id){
  if(!can('billing_edit')){ toast('Not permitted','err'); return; }
  var j=jobById(id);
  j.discount=readDiscount('bd');
  j.siRef=val('bdSI');
  persist(); toast('Billing updated'); render();
}
/* Value-based discount editor: consolidated Parts, Labor and Other buckets
   plus a free-text reference note. `pre` is the input-id prefix. */
function discountEditor(j, pre){
  var d=j.discount||{};
  return '<div class="grid2">'+
    field('Discount on Parts (₱)','<input id="'+pre+'Parts" type="number" step="0.01" value="'+attr(Number(d.parts)||0)+'">')+
    field('Discount on Labor (₱)','<input id="'+pre+'Labor" type="number" step="0.01" value="'+attr(Number(d.labor)||0)+'">')+'</div>'+
    '<div class="grid2">'+
    field('Other discounts (₱)','<input id="'+pre+'Other" type="number" step="0.01" value="'+attr(Number(d.other)||0)+'">')+
    field('Other — reference','<input id="'+pre+'Note" value="'+attr(d.otherNote||'')+'" placeholder="e.g. senior citizen, promo">')+'</div>';
}
function readDiscount(pre){
  return { parts:Number(val(pre+'Parts'))||0, labor:Number(val(pre+'Labor'))||0,
    other:Number(val(pre+'Other'))||0, otherNote:val(pre+'Note')||'' };
}
function quickC3(id){ var j=jobById(id); j.status='C3'; j.statusLog.push({time:new Date().toISOString(),code:'C3',by:j.saId,note:'Release cleared, forward to billing.'}); persist(); toast('Status → C3'); render(); }

function advancePostJob(id){
  var j=jobById(id);
  var missing=postJobMissingFields(j);
  if(missing.length){
    openModal('Complete job details first',
      '<p class="muted small">The Post Job Report can’t be created until these fields are complete. Still missing:</p>'+
      missingChecklist(missing)+
      '<p class="muted small">Fill these in <b>Job Details → Edit</b> (or Check-in / Assignment), then try again.</p>',
      { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>'+
        '<button class="btn primary" onclick="closeModal();editJobDetails(\''+j.id+'\')">Edit Job Details</button>', width:'520px' });
    return;
  }
  var sup=staffById(val('apvRel'));
  if(!sup || sup.role!=='SV'){ toast('Select the approving Supervisor first','err'); return; }
  j.approvedReleaseBy = sup.id;
  deductInventory(j);
  j.stage='Post Job Report';
  persist(); toast('Post Job Report created · inventory deducted'); render();
}
function deductInventory(j){
  if (j.inventoryDeducted) return; // idempotent
  (j.lines||[]).forEach(function(l){ if(l.type==='part'&&l.ref){ var p=partById(l.ref); if(p){ p.stock=round2((p.stock||0)-(Number(l.qty)||0)); } } });
  j.inventoryDeducted=true;
}
function applyDiscount(id){ var j=jobById(id); j.discount=readDiscount('dsc'); persist(); toast('Discount applied'); render(); }
/* Lowest OR number that may still be issued — never below any already-issued OR,
   so a fresh allocator can never reuse a number. */
function orSeed(){
  var hi=0;
  (S.jobs||[]).forEach(function(x){ if(x&&x.orNumber){ var m=/(\d+)/.exec(String(x.orNumber)); if(m){ var v=Number(m[1]); if(v>hi) hi=v; } } });
  return Math.max(hi+1, Number(S.shop.orNext)||0, (Number((S.counters||{}).or)||0)+1, 1001);
}
/* Allocate the next OR number ATOMICALLY. In cloud mode a Firestore transaction on
   meta/orcounter hands out each number exactly once — even with several cashiers
   billing at the same instant there can be NO duplicates. Offline falls back to a
   local monotonic counter. */
function allocateOrNumber(){
  var seed = orSeed();
  if (typeof cloudOn==='function' && cloudOn() && typeof FB!=='undefined' && FB && FB.ready && FB.db && FB.user){
    var ref = bcol('meta').doc('orcounter');
    return FB.db.runTransaction(function(t){
      return t.get(ref).then(function(doc){
        var stored = (doc.exists && Number(doc.data().next)>0) ? Number(doc.data().next) : 0;
        var issue = Math.max(stored, seed);                 // never reuse / never go backward
        t.set(ref, { next: issue+1, updatedAt:new Date().toISOString() }, { merge:true });
        return issue;
      });
    }).then(function(issue){
      if(S.counters) S.counters.or=issue;                   // keep local mirrors current
      S.shop.orNext = issue+1;
      return 'OR-'+String(issue);
    });
  }
  if(!S.counters) S.counters={};
  var n = Math.max(Number(S.counters.or)||0, seed);
  S.counters.or = n; S.shop.orNext = n+1;
  return Promise.resolve('OR-'+String(n));
}
var _issuingOR={};
function advanceBilling(id){
  var j=jobById(id);
  if(!j || j.stage!=='Post Job Report' || j.orNumber) return;   // already issued / wrong stage
  var sup=staffById(j.approvedReleaseBy);
  if(!sup || sup.role!=='SV'){ toast('Select the approving Supervisor first','err'); return; }
  var sec=staffById(j.paymentReceivedBy);
  if(!sec || sec.role!=='Secretary'){ toast('Enter the Secretary who received payment first','err'); return; }
  if(_issuingOR[id]) return;                                     // in-flight guard (prevents double-click gaps)
  _issuingOR[id]=true;
  if(document.getElementById('dscParts')) j.discount=readDiscount('dsc');
  allocateOrNumber().then(function(orNo){
    j.orNumber=orNo; j.billedAt=new Date().toISOString(); j.stage='Final Billing';
    delete _issuingOR[id]; persist(); toast('Final Billing issued · '+orNo); render();
  }).catch(function(err){
    delete _issuingOR[id];
    toast('Could not assign OR number — please try again.'+(err&&err.message?' ('+err.message+')':''),'err');
  });
}

function jobPaymentBlock(j,b){
  var pays=(j.payments||[]).map(function(p){return '<div class="l2"><span>'+esc(fmtDate(p.date))+' · '+esc(p.method)+'</span><span>'+peso(p.amount)+'</span></div>';}).join('');
  var paid = b.balance<=0;
  return '<div class="bill-mini">'+line2('Total due', peso(b.gross),'tot')+line2('Paid', peso(b.paid))+line2('<b>Balance</b>','<b>'+peso(b.balance)+'</b>','tot')+'</div>'+
    '<div class="grid2 mt8">'+
      field('Approved for release by (Supervisor)','<select onchange="setJobField(\''+j.id+'\',\'approvedReleaseBy\',this.value)">'+optionList(staffByRole('SV'),j.approvedReleaseBy,true)+'</select>')+
      field('Payment received by (Secretary)','<select onchange="setJobField(\''+j.id+'\',\'paymentReceivedBy\',this.value)">'+optionList(staffByRole('Secretary'),j.paymentReceivedBy,true)+'</select>')+
    '</div>'+
    pays+
    (paid? '' : '<div class="grid2 mt8">'+field('Amount','<input id="pyAmt" type="number" step="0.01" value="'+attr(b.balance)+'">')+
      field('Method','<select id="pyMethod"><option>Cash</option><option>GCash</option><option>Card</option><option>Bank transfer</option><option>Charge account</option></select>')+'</div>'+
      '<button class="btn sm" onclick="recordPayment(\''+j.id+'\')">Record payment</button>')+
    field('Last service odometer','<input id="relOdo" type="number" value="'+attr(j.lastServiceOdo||j.odometer||'')+'" placeholder="reading at release">','Recorded on release; updates the vehicle’s last service odometer.')+
    '<button class="btn primary full mt8" '+(paid?'':'disabled title="Balance must be fully paid"')+' onclick="releaseJob(\''+j.id+'\')">Release vehicle →</button>'+
    (paid?'':'<div class="muted small center">Balance must be fully paid to release.</div>');
}
function recordPayment(id){
  var j=jobById(id); var amt=Number(val('pyAmt'))||0; if(amt<=0){toast('Enter amount','err');return;}
  j.payments.push({ amount:amt, method:val('pyMethod'), date:new Date().toISOString() });
  persist(); toast('Payment recorded'); render();
}
function releaseJob(id){
  var j=jobById(id);
  if (jobBalance(j)>0.001){ toast('Balance must be fully paid','err'); return; }
  var lso=Number(val('relOdo'))||0; if(lso) j.lastServiceOdo=lso;   // odometer reading at release
  j.stage='Released';
  // record the last service odometer on the vehicle and schedule next service
  var v=vehicleById(j.vehicleId); if(v){ var reading=Number(j.lastServiceOdo)||(j.inspection&&j.inspection.odometer)||j.odometer||0;
    v.odometer=Math.max(v.odometer||0, reading);
    // Next service: 3 months after the last service (release) date, and 5,000 km after the last service odometer.
    var nd=new Date(); nd.setMonth(nd.getMonth()+3); v.nextServiceDate=todayISO(nd); v.nextServiceOdo=(reading||v.odometer||0)+5000; }
  persist(); if(v && typeof publishPortalDoc==='function') publishPortalDoc(v.id);   // refresh public portal
  toast('Vehicle released ✓'); render();
}

/* afterRender hook (kept as a base no-op; part12_rbac.js chains onto it). */
function afterRender(){}
