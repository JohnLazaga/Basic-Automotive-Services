/* ============================================================================
   PART 14 — PMS Multipoint Inspection (tablet/kiosk checklist).

   Flow: in a Job Order's Add-labor dialog, selecting the standard PMS LABOR item
   reveals a "Perform PMS" button. Pressing it opens a PMS ticket on the job
   (job.pms.status='open'). Any device logged into the branch — typically the
   shop tablet on the "PMS Queue" view — sees the open ticket live (jobs sync in
   real time), taps it, and fills the multipoint checklist. On submit, a
   structured report is saved onto the job, viewable in-app, on a printable
   report, and (full checklist) in the customer portal.

   The whole form renders generically from PMS_TEMPLATE, so the item list lives
   in one place (mirrors PMS_CHECKLIST_SPEC.md / the shop's paper form).
   Rating states: ok (green) · attention (yellow) · replace (red).
   ========================================================================== */

var PMS_RATINGS = [
  { s:'ok', label:'OK', cls:'r-ok' },
  { s:'attention', label:'Attention', cls:'r-att' },
  { s:'replace', label:'Replace', cls:'r-rep' },
  { s:'na', label:'Not applicable', cls:'r-na' }
];

/* Build helper: a rating block from "Label" list. */
function pmsRate(items){ return { kind:'rating', items:items.map(function(l){ return { key:pmsKey(l), label:l }; }) }; }
function pmsCheck(items){ return { kind:'check', items:items.map(function(l){ return { key:pmsKey(l), label:l }; }) }; }
function pmsLR(items){ return { kind:'lr', items:items.map(function(l){ return { key:pmsKey(l), label:l }; }) }; }
function pmsMeasure(items){ return { kind:'measure', items:items.map(function(m){ return { key:pmsKey(m[0]), label:m[0], unit:m[1] }; }) }; }
function pmsText(label){ return { kind:'text', key:pmsKey(label), label:label }; }
/* Tread-depth selector: each tire shows four boxes (25/50/75/100%). */
function pmsDepth(items){ return { kind:'depth', items:items.map(function(l){ return { key:pmsKey('tire depth '+l), label:l }; }) }; }
/* Per-tire general condition (4-colour rating) + a "Tire DOT" year dropdown. */
function pmsCondition(items){ return { kind:'condition', items:items.map(function(l){ return { key:pmsKey('tire condition '+l), dotKey:pmsKey('tire dot '+l), label:l }; }) }; }
/* Yes / No selector: two gray boxes per row. */
function pmsYesNo(items){ return { kind:'yesno', items:items.map(function(l){ return { key:pmsKey(l), label:l }; }) }; }
/* <option> list of years from ~20 years back up to the present year (year only). */
function pmsYearOptions(sel){
  var cur=parseInt(String(typeof todayISO==='function'?todayISO():'2026-01-01').slice(0,4),10)||2026;
  var opts='<option value="">—</option>';
  for(var y=cur;y>=cur-20;y--){ opts+='<option value="'+y+'"'+(String(sel)===String(y)?' selected':'')+'>'+y+'</option>'; }
  return opts;
}
/* stable, id-safe key from a label */
function pmsKey(l){ return String(l).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
/* Flatten a section's blocks, expanding 2-column ('cols') containers into their
   left+right sub-blocks — used by every value reader and report renderer. */
function pmsLeafBlocks(sec){
  var out=[]; (sec.blocks||[]).forEach(function(b){
    if(b && b.kind==='cols'){ (b.left||[]).forEach(function(x){out.push(x);}); (b.right||[]).forEach(function(x){out.push(x);}); }
    else out.push(b);
  });
  return out;
}

var PMS_TEMPLATE = [
  { title:'Pre-PMS Test Drive Notes', blocks:[
    { kind:'text', key:pmsKey('Pre-PMS Test Drive Notes'), label:'Pre-PMS Test Drive Notes', yn:{ key:pmsKey('Test driven'), label:'Test Driven?' } },
    { kind:'faultcode', key:pmsKey('Fault Code'), label:'Fault Code' },
    { kind:'condphoto', key:pmsKey('General Condition of Vehicle'), label:'General Condition of Vehicle' } ] },

  { title:'Interior', blocks:[ pmsRate([
    'Horn','Gauge','Seats','Seat belts','Shift knob','Matting','Windows interior','AC control','Radio system',
    'Wiper controls','Map/dome light','Hood release','Trunk release' ]) ] },

  { title:'Exterior', blocks:[ pmsRate([
    'Park lights front','Headlight Low beam','Headlight High beam','Fog lights','Signal lights front',
    'Front Windshield','Wiper Front','Wiper Blades Front','Wiper Washer Front','Headlight Washers',
    'Brake Lights','Third brake light','Signal lights Rear','Reverse Lights','Park lights Rear',
    'Fog Lights rear','Plate Lights','Rear Windshield','Wiper rear','Wiper blade rear','Wiper washer rear',
    'Door Handles','Door locks','Fender Lights','Side Mirror','Side Mirror Lights','Other Signal Lights','Windows' ]),
    pmsText('Exterior notes') ] },

  { title:'Brakes', blocks:[
    pmsRate(['Brake pads/shoe FR','Brake pads/shoe FL','Brake pads/shoe RR','Brake pads/shoe RL']),
    pmsRate(['Rotor/drum FR','Rotor/drum FL','Rotor/drum RR','Rotor/drum RL']),
    pmsRate(['Brake caliper/cylinder FR','Brake caliper/cylinder FL','Brake caliper/cylinder RR','Brake caliper/cylinder RL']),
    pmsRate(['Brake hose FR','Brake hose FL','Brake hose RR','Brake hose RL']),
    pmsRate(['Brake fluid condition']),
    pmsYesNo(['Brakes cleaned','Parking brake adjusted']) ] },

  { title:'Engine Bay — Systems', blocks:[
    pmsRate(['Air filter','Fuel filter','Cabin filter',
      'Radiator cap','Radiator hoses','Bypass hoses','Reservoir','Clutch fan/motor',
      'Ignition coil','Spark plugs','Distributor','Spark plug cable',
      'Engine mount','Trans mount','Torque mount',
      'Alternator','Water pump','Power steering pump','Vacuum pump','Aircon compressor']),
    pmsRate(['Main belt','Auxiliary belts']),
    pmsYesNo(['Performed cooling system pressure test','Performed spark plug cleaning','Performed hose retightening']) ] },

  { title:'Engine Bay and Underchassis Fluids', blocks:[
    pmsRate(['Engine oil','Coolant','Brake fluid (engine)','Clutch fluid','PS fluid','Transmission oil','Differential oil','Transfer case oil','Washer fluid']),
    pmsYesNo(['Performed top-up of all fluids']) ] },

  { title:'Oil / Fluid Leaks', blocks:[ pmsRate([
    'Valve cover gasket','Intake hose','Turbo hose','Intercooler','Spool valve','Oil pan gasket','Axle oil seals',
    'Camshaft oil seal','Front crank seal','Rear crank seal','Trans oil seal','Diff oil seal' ]) ] },

  { title:'Drivetrain', blocks:[ pmsRate([
    'Clutch pedal','Shifter linkage/cable','Inner CV joint front','Inner CV joint rear','Outer CV joint front',
    'Outer CV joint rear','CV boots & straps','Clutch master','Clutch slave','Wheel bearing FL','Wheel bearing FR',
    'Wheel bearing RL','Wheel bearing RR','Cross joint','Differential','Center bearing' ]) ] },

  { title:'Steering & Suspension', blocks:[
    pmsLR(['Stabilizer link front','Stabilizer link rear','Stabilizer bar bushing front','Stabilizer bar bushing rear',
      'Lower arm big bushing (front)','Lower arm small bushing (front)','Lower arm ball joint (front)','Caster bar bushing',
      'Upper arm big bushing','Upper arm small bushing','Upper arm ball joint',
      'Shock piston front','Shock boots front','Shock mounting front','Shock bushing front',
      'Shock piston rear','Shock boots rear','Shock mounting rear','Shock bushing rear']),
    pmsRate(['Rear suspension bushings','Torsion bar front','Torsion beam','Trailing arms','Panhard rod','Leaf springs',
      'Leaf spring bushings','Coil springs','Coil spring pads','Lateral links','Rear ball joints']),
    pmsLR(['Outer tie rod','Inner tie rod/rack end','Steering boots']),
    pmsRate(['Steering rack assembly','Steering gear box','Center link','Idler arm','Center post','Pitman arm','Power steering hoses']),
    pmsYesNo(['Performed steering and suspension retightening']) ] },

  { title:'Tires', note:'Do tire pressure reading AFTER rotation and balancing!', blocks:[
    { kind:'cols',
      leftTitle:'Tire Pressure', rightTitle:'Tire Depth (tread remaining)',
      left:[ pmsMeasure([['Front Left Pressure','PSI'],['Front Right Pressure','PSI'],['Rear Left Pressure','PSI'],['Rear Right Pressure','PSI'],['Spare Tire Pressure','PSI']]) ],
      right:[ pmsDepth(['Front Left','Front Right','Rear Left','Rear Right','Spare']) ] },
    pmsCondition(['Front Left','Front Right','Rear Left','Rear Right','Spare']),
    pmsYesNo(['Tires rotated','Tires balanced']),
    pmsRate(['Hub bolts','Lug nuts']),
    pmsYesNo(['Performed wheel tightening to torque specs']) ] },

  { title:'Battery/Alternator', blocks:[
    { kind:'text', key:pmsKey('Resting battery voltage'), label:'Resting batt voltage (engine off, ref: 12.4V & up)', labeled:true, required:true },
    { kind:'text', key:pmsKey('Alternator output'), label:'Alternator output (engine on, ref: 13.5–14.5V)', labeled:true, required:true },
    { kind:'text', key:pmsKey('Load test'), label:'Load test (engine on, heavy load, ref: 13.0V)', labeled:true, required:true },
    pmsRate(['General charging condition']),
    pmsText('Battery notes') ] },

  { title:'Post PMS Notes', blocks:[
    { kind:'text', key:pmsKey('Post-PMS Drive Test Notes'), label:'Post-PMS Drive Test Notes', yn:{ key:pmsKey('Post-PMS test driven'), label:'Test Driven?' } },
    pmsText('General PMS Notes') ] }
];

/* Give every section a free-text notes field at its end — skip sections whose
   last block is already a free-text area (Exterior, Test drive, Notes). */
PMS_TEMPLATE.forEach(function(sec){
  var blocks=sec.blocks||[]; var last=blocks[blocks.length-1];
  if(!blocks.length || (last.kind!=='text' && last.kind!=='faultcode' && last.kind!=='condphoto')){ blocks.push(pmsText(sec.title+' notes')); }
});

/* ---- Ticket lifecycle (embedded on the job) ------------------------------- */
function jobHasOpenPMS(j){ return !!(j && j.pms && j.pms.status && j.pms.status!=='done'); }
function pmsReport(j){ return (j && j.pms && j.pms.report) || null; }

/* "Perform PMS" — open a ticket for this job (from the add-labor dialog). An
   optional scheduledAt (datetime-local string) is shown on the queue card. */
function requestPMS(id, scheduledAt){
  var j=jobById(id); if(!j){ toast('Job not found','err'); return; }
  if(!j.pms) j.pms={};
  if(j.pms.status && j.pms.status!=='done'){ toast('A PMS is already queued for this vehicle','err'); return; }
  j.pms={ status:'open', requestedAt:new Date().toISOString(), scheduledAt:scheduledAt||null, requestedBy:(typeof CURRENT_USER!=='undefined'&&CURRENT_USER?CURRENT_USER.name:null), report:(j.pms&&j.pms.report)||null };
  persist(); closeModal();
  toast('PMS ticket sent to the tablet queue');
  render();
}
/* Who may remove a PMS queue ticket: Admin or Supervisor (SV). Local / pre-auth
   (dev build, mini-PC) allows it too, matching the app's can() convention. */
function canDeletePMS(){ return (typeof isAdminOrSV==='function') ? isAdminOrSV() : true; }
function deletePMSQueueItem(id){
  if(!canDeletePMS()){ toast('Only a supervisor or admin can remove PMS tickets','err'); return; }
  var j=jobById(id); if(!j) return;
  confirmModal('Remove PMS ticket',
    'Remove the PMS ticket for '+j.plate+' (JO '+j.no+') from the queue? Any in-progress inspection on it will be discarded.',
    function(){ pmsLog(j, 'PMS ticket removed from the queue.'); j.pms=null; persist(); toast('PMS ticket removed'); render(); },
    'Remove', true);
}

/* Jobs with a live PMS ticket, newest first (the kiosk queue). */
function pmsQueue(){
  return (S.jobs||[]).filter(jobHasOpenPMS)
    .sort(function(a,b){ return ((b.pms.requestedAt||'')<(a.pms.requestedAt||''))?1:-1; });
}

/* ---- Kiosk: PMS Queue view ------------------------------------------------ */
VIEWS.pms = function(){
  var q=pmsQueue();
  var cards=q.length? q.map(function(j){
    var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
    var st=j.pms.status==='in_progress'?'<span class="chip gold">In progress</span>':'<span class="chip due">Waiting</span>';
    var del=canDeletePMS()?'<button class="pms-q-del" title="Remove from queue" onclick="event.stopPropagation();deletePMSQueueItem(\''+j.id+'\')">✕</button>':'';
    var sched=j.pms.scheduledAt?'<div class="pms-q-sched">🕑 Scheduled '+esc(fmtDateTime(j.pms.scheduledAt))+'</div>':'';
    return '<div class="pms-q" onclick="startPMS(\''+j.id+'\')">'+
      '<div class="pms-q-top"><b>'+esc(j.plate)+'</b> '+st+del+'</div>'+
      '<div class="muted small">'+esc(veh||'—')+' · JO '+esc(j.no)+'</div>'+
      sched+
      '<div class="muted small">Requested '+esc(fmtDateTime(j.pms.requestedAt))+'</div>'+
      '<button class="btn primary full mt8">Perform inspection →</button></div>';
  }).join('') : emptyState('No PMS in the queue. Tickets appear here when a Job Order sends a "Perform PMS".');
  return '<div class="page"><div class="page-head"><h1>PMS Queue</h1><div class="muted small">'+q.length+' waiting</div></div>'+
    '<div class="pms-qgrid">'+cards+'</div></div>';
};

/* ---- Kiosk: fill the checklist (section-by-section wizard) ---------------- */
/* One section per page with a completion gate: the tech must rate every row in a
   section before "Done" advances. A stepper lets them jump back and forth to any
   section for editing. Values autosave into j.pms.report on every navigation. */
var _pmsCtx=null;   // { jobId, step }  step: 0..N-1 = sections, N = sign-off page
function startPMS(id){
  var j=jobById(id); if(!j) return;
  if(!j.pms) j.pms={status:'open'};
  if(j.pms.status==='open'){ j.pms.status='in_progress'; persist(); }
  _pmsCtx={ jobId:id, step:0 };
  go('pmsform', id);
}
/* Append a Job Order clipboard-log entry from the PMS flow (start / complete).
   "By" is the PMS mechanic once picked, else the job's first mechanic / SA. */
function pmsLog(j, note){
  if(!j) return;
  j.statusLog=j.statusLog||[];
  var by=(j.pms&&j.pms.report&&j.pms.report.mechanicId)||((j.mechanicIds||[]).filter(function(x){return x&&x!=='TBA';})[0])||j.saId||'';
  j.statusLog.push({ time:new Date().toISOString(), code:j.status||'', by:by, note:note });
}
/* "Start Job" (section 1) — stamps the start time and logs it on the Job Order. */
function pmsStartJob(id){
  var j=jobById(id); if(!j) return;
  if(j.pms&&j.pms.startedAt){ toast('Job already started'); return; }
  j.pms=j.pms||{status:'in_progress'};
  j.pms.startedAt=new Date().toISOString();
  pmsLog(j, 'PMS inspection started.');
  persist(); toast('Job started — logged on the Job Order'); render();
}
/* Rows still needing a value in this section (rating, L/R, and numeric measures
   are all required; free-text notes stay optional). */
function pmsSectionMissing(sec, vals){
  var miss=[];
  pmsLeafBlocks(sec).forEach(function(b){
    if(b.kind==='text'){ if(b.yn){ var tyv=vals[b.yn.key]; if(!tyv||!tyv.v) miss.push(b.yn.key); }   // Test driven? Yes/No required when present
      if(b.required){ var trv=vals[b.key]; if(!trv||!String(trv).trim()) miss.push(b.key); } return; }    // required note box must have text
    if(b.kind==='faultcode'){ var fv=vals[b.key]; if(!fv||!fv.v) miss.push(b.key); return; }   // Yes/No required; note + photo optional
    if(b.kind==='condphoto'){ var cv=vals[b.key]; if(!cv||!cv.s) miss.push(b.key); return; }   // rating required; note + photo optional
    (b.items||[]).forEach(function(it){
    var v=vals[it.key];
    if(b.kind==='rating'){ if(!v||!v.s) miss.push(it.key); }
    else if(b.kind==='condition'){ if(!v||!v.s) miss.push(it.key); }   // condition rating required; Tire DOT year optional
    else if(b.kind==='lr'){ if(!v||!v.l||!v.r) miss.push(it.key); }
    else if(b.kind==='depth'){ if(!v||!v.d) miss.push(it.key); }
    else if(b.kind==='yesno'){ if(!v||!v.v) miss.push(it.key); }
    else if(b.kind==='measure'){ if(v==null||String(v).trim()==='') miss.push(it.key); }
  }); });
  return miss;
}
function pmsSectionDone(sec, vals){ return pmsSectionMissing(sec, vals||{}).length===0; }
/* Per-section rating tally — how many of the section's items are in each state. */
function pmsSectionCounts(sec, vals){
  var c={ok:0,attention:0,replace:0,na:0}; vals=vals||{};
  pmsLeafBlocks(sec).forEach(function(b){
    if(b.kind==='condphoto'){ var cv=vals[b.key]; if(cv&&cv.s&&c[cv.s]!=null) c[cv.s]++; return; }
    (b.items||[]).forEach(function(it){ var v=vals[it.key]; if(!v) return;
      if((b.kind==='rating'||b.kind==='condition') && v.s && c[v.s]!=null) c[v.s]++;
      else if(b.kind==='lr'){ if(v.l&&c[v.l]!=null) c[v.l]++; if(v.r&&c[v.r]!=null) c[v.r]++; }
    });
  });
  return c;
}
/* The colour legend at the top of a section, with a live count beside each colour. */
function pmsLegend(sec, vals){
  var c=pmsSectionCounts(sec, vals);
  function item(s,cls,label){ return '<span class="pms-leg"><span class="r-swatch pms-legsw '+cls+'"><b id="pmsLeg-'+s+'">'+c[s]+'</b></span>'+label+'</span>'; }
  return '<div class="pms-legend">'+item('ok','r-ok','OK')+item('attention','r-att','Requires attention')+
    item('replace','r-rep','Needs replacement')+item('na','r-na','Not applicable')+'</div>';
}
/* Recompute the legend counts live from the current section's rating swatches. */
function pmsUpdateLegend(){
  var c={ok:0,attention:0,replace:0,na:0};
  Array.prototype.forEach.call(document.querySelectorAll('.pms-form .pms-rate input[type="hidden"]'), function(h){ if(c[h.value]!=null) c[h.value]++; });
  ['ok','attention','replace','na'].forEach(function(s){ var el=document.getElementById('pmsLeg-'+s); if(el) el.textContent=c[s]; });
}

VIEWS.pmsform = function(id){
  var j=jobById(id||(_pmsCtx&&_pmsCtx.jobId)); if(!j) return '<div class="page">'+emptyState('Job not found.')+'</div>';
  if(!_pmsCtx || _pmsCtx.jobId!==j.id) _pmsCtx={ jobId:j.id, step:0 };
  if(_pmsCtx.step==null) _pmsCtx.step=0;
  // Preserve any unsaved on-screen picks before repainting — a background cloud
  // snapshot can trigger render() mid-section and would otherwise reset the boxes.
  if(_pmsCtx.jobId===j.id) pmsCaptureCurrent();
  var r=(j.pms&&j.pms.report)||{ values:{} }; var vals=r.values||{};
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  var N=PMS_TEMPLATE.length;
  var step=Math.max(0, Math.min(_pmsCtx.step, N));

  var chips=PMS_TEMPLATE.map(function(sec,i){
    var cls='pms-chip'+(i===step?' cur':'')+(pmsSectionDone(sec,vals)?' done':'');
    return '<button type="button" class="'+cls+'" onclick="pmsGoto('+i+')" title="'+esc(sec.title)+'">'+(pmsSectionDone(sec,vals)?'✓':(i+1))+'</button>';
  }).join('')+'<button type="button" class="pms-chip'+(step>=N?' cur':'')+'" onclick="pmsGoto('+N+')" title="Sign-off">⎘</button>';
  var head='<div class="page-head"><div><a class="back" onclick="pmsSaveExit()">‹ PMS Queue</a>'+
      '<h1>PMS · '+esc(j.plate)+'</h1><div class="muted small">'+esc(veh)+' · JO '+esc(j.no)+'</div></div></div>'+
    '<div class="pms-stepper">'+chips+'</div>';

  if(step<N){
    var sec=PMS_TEMPLATE[step];
    var marker='<div class="pms-stepmark"><b>'+(step+1)+' / '+N+'</b> · '+esc(sec.title)+'</div>';
    var startBar = step!==0 ? '' : ((j.pms&&j.pms.startedAt)
      ? '<div class="pms-startbar started">✓ Job started · '+esc(fmtDateTime(j.pms.startedAt))+' · logged on the Job Order</div>'
      : '<div class="pms-startbar"><button class="btn primary" onclick="pmsStartJob(\''+j.id+'\')">▶ Start Job</button>'+
        '<span class="muted small">Records the PMS start time on the Job Order.</span></div>');
    var nav='<div class="pms-nav">'+
      (step>0?'<button class="btn ghost" onclick="pmsPrev()">‹ Back</button>':'<span></span>')+
      '<button class="btn primary" onclick="pmsNext()">'+(step===N-1?'Done — Review & sign-off →':'Done — next section →')+'</button></div>';
    return '<div class="page pms-form">'+head+marker+pmsLegend(sec, vals)+startBar+
      '<div class="card">'+pmsSectionHTML(sec, vals)+'</div>'+nav+'</div>';
  }

  // sign-off page (step === N)
  var picked=pmsMechIds(r);
  var mechBoxes=mechanicStaff().map(function(m){
    return '<label class="chk small"><input type="checkbox" class="pmsMechChk" value="'+m.id+'"'+(picked.indexOf(m.id)>=0?' checked':'')+'> '+esc(m.name)+'</label>';
  }).join('')||'<span class="muted small">No mechanics on staff</span>';
  var saOpts=optionList(S.staff, r.saId||j.saId||'', false);
  var doneCount=PMS_TEMPLATE.filter(function(sec){ return pmsSectionDone(sec, vals); }).length;
  return '<div class="page pms-form">'+head+
    '<div class="pms-stepmark"><b>Sign-off</b> · Review & complete</div>'+
    '<div class="muted small" style="margin:-4px 0 10px">'+doneCount+' / '+N+' sections complete</div>'+
    pmsSummaryHTML(j)+
    '<div class="card"><h2>Sign-off</h2><div class="grid2">'+
      '<div class="fld"><span class="fld-l">Performed by (Mechanic/s)</span><div class="mechbox" id="pmsMechBox">'+mechBoxes+'</div></div>'+
      field('Service Adviser','<select id="pmsSA">'+saOpts+'</select>')+'</div></div>'+
    '<div class="pms-nav"><button class="btn ghost" onclick="pmsPrev()">‹ Back</button>'+
      '<button class="btn primary" onclick="submitPMS(\''+j.id+'\')">✓ Complete PMS</button></div>'+
  '</div>';
};
/* Save whatever fields are in the DOM right now (current section OR sign-off page)
   into the report, without clobbering the other sections. */
/* Read whatever's on screen right now (current section OR sign-off page) into the
   report — WITHOUT persisting. Called before every pmsform repaint so a background
   re-render (e.g. a cloud snapshot) can't wipe unsaved on-screen selections. */
function pmsCaptureCurrent(){
  var j=_pmsCtx&&jobById(_pmsCtx.jobId); if(!j) return null;
  j.pms=j.pms||{status:'in_progress'};
  j.pms.report=j.pms.report||{values:{}};
  j.pms.report.values=readPmsValues(j.pms.report.values||{});
  if(document.getElementById('pmsSA')){
    var picked=pmsReadMechChecks();
    j.pms.report.mechanicIds=picked; j.pms.report.mechanicId=picked[0]||'';
    j.pms.report.saId=val('pmsSA')||j.pms.report.saId||'';
    var st=pmsReadSig('pmsSigTech'); if(st) j.pms.report.sigTech=st;
    var sc=pmsReadSig('pmsSigClient'); if(sc) j.pms.report.sigClient=sc;
  }
  return j;
}
function pmsCurrentSave(){ var j=pmsCaptureCurrent(); if(j) persist(); return j; }
function pmsGoto(i){ pmsCurrentSave(); _pmsCtx.step=i; render(); if(typeof window!=='undefined') window.scrollTo(0,0); }
function pmsPrev(){ pmsCurrentSave(); if(_pmsCtx.step>0) _pmsCtx.step--; render(); if(typeof window!=='undefined') window.scrollTo(0,0); }
function pmsNext(){
  var j=pmsCurrentSave(); if(!j) return;
  var N=PMS_TEMPLATE.length, step=_pmsCtx.step;
  if(step<N){
    var miss=pmsSectionMissing(PMS_TEMPLATE[step], (j.pms.report.values)||{});
    if(miss.length){ pmsHighlightMissing(miss); toast(miss.length+' item'+(miss.length>1?'s':'')+' still need a rating in this section','err'); return; }
  }
  _pmsCtx.step=Math.min(step+1, N); render(); if(typeof window!=='undefined') window.scrollTo(0,0);
}
function pmsSaveExit(){ pmsCurrentSave(); go('pms'); }
function pmsHighlightMissing(keys){
  Array.prototype.forEach.call(document.querySelectorAll('.pms-row.needpick,.fld.needpick'), function(el){ el.classList.remove('needpick'); });
  var first=null;
  keys.forEach(function(k){
    var input=document.getElementById('pf_'+k)||document.getElementById('pf_'+k+'_l');
    var cell=(input&&input.closest)?(input.closest('.pms-row')||input.closest('.fld')):null;   // rating row OR measure field
    if(cell){ cell.classList.add('needpick'); if(!first) first=cell; }
  });
  if(first&&first.scrollIntoView) first.scrollIntoView({block:'center'});
}
/* Clear a measure field's "needs a value" flag as soon as the tech types in it. */
function pmsClearFld(el){ var f=(el&&el.closest)?el.closest('.fld'):null; if(f) f.classList.remove('needpick'); }
function pmsThumbsHTML(j){
  var grid=(j.photos||[]).map(function(p){
    return '<div class="thumb"><img src="'+(p.url||p.data)+'" onclick="openLightbox(_photoSrc(\''+j.id+'\',\''+p.id+'\'))"/>'+
      '<button class="thumb-x" onclick="delPhoto(\''+j.id+'\',\''+p.id+'\')">✕</button></div>';
  }).join('');
  return grid||emptyState('No photos yet.');
}

/* Section → HTML (renders each block type). */
function pmsSectionHTML(sec, vals){
  var body=sec.blocks.map(function(b){ return pmsBlockHTML(b, vals); }).join('');
  var note=sec.note?'<span class="pms-secnote">⚠ '+esc(sec.note)+'</span>':'';
  // Skip the section-level photo when the section already has its own photo
  // blocks (Fault Code / General Condition) — otherwise it's a redundant row.
  var hasOwnPhotos=(sec.blocks||[]).some(function(b){ return b.kind==='faultcode'||b.kind==='condphoto'; });
  var photoBlk='';
  if(!hasOwnPhotos){ var pk=pmsSecPhotoKey(sec); photoBlk='<div class="pms-secphoto">'+pmsPhotoBlock(pk, (vals[pk]&&vals[pk].photos)||[])+'</div>'; }
  return '<div class="card pms-sec"><div class="pms-sec-head"><h2>'+esc(sec.title)+'</h2>'+note+'</div>'+body+photoBlk+'</div>';
}
function pmsBlockHTML(b, vals){
  if(b.kind==='text'){ var tv=vals[b.key]||'';
    if(b.yn){ var yc=(vals[b.yn.key]&&vals[b.yn.key].v)||'';
      var ynb=['Yes','No'].map(function(o){ var on=(yc===o)?' on':'';
        return '<button type="button" class="pms-ynbox'+on+'" onclick="pmsSetYN(\''+b.yn.key+'\',\''+o+'\',this)">'+o+'</button>'; }).join('');
      return '<div class="fld pms-textfld"><div class="pms-texthead"><span class="fld-l">'+esc(b.label)+'</span>'+
        '<span class="pms-textyn"><span class="pms-textyn-lbl">'+esc(b.yn.label)+'</span>'+
        '<span class="pms-ynset"><input type="hidden" id="pf_'+b.yn.key+'" value="'+attr(yc)+'">'+ynb+'</span></span></div>'+
        '<textarea id="pf_'+b.key+'" rows="3" oninput="pmsClearFld(this)">'+esc(tv)+'</textarea></div>';
    }
    return field(b.label,'<textarea id="pf_'+b.key+'" rows="3" oninput="pmsClearFld(this)">'+esc(tv)+'</textarea>'); }
  if(b.kind==='measure'){
    return '<div class="pms-grid">'+b.items.map(function(it){
      var v=vals[it.key]; v=(v==null?'':v);
      return field(it.label+(it.unit?' ('+it.unit+')':''),'<input id="pf_'+it.key+'" type="text" inputmode="decimal" value="'+attr(v)+'" onfocus="this.select()" oninput="pmsClearFld(this)">');
    }).join('')+'</div>';
  }
  if(b.kind==='check'){
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=vals[it.key]||{}; var on=cur.c?' checked':'';
      return '<div class="pms-row"><label class="pms-chk"><input type="checkbox" id="pf_'+it.key+'_c"'+on+'> '+esc(it.label)+'</label>'+
        '<input class="pms-note" id="pf_'+it.key+'_n" value="'+attr(cur.n||'')+'" placeholder="note" onfocus="this.select()"></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='rating'){
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=vals[it.key]||{}; return '<div class="pms-row"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        pmsRatingSwitch('pf_'+it.key, cur.s)+'</div>';
    }).join('')+'</div>';
  }
  if(b.kind==='lr'){
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=vals[it.key]||{};
      return '<div class="pms-row pms-lr"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        '<span class="pms-side">L'+pmsRatingSwitch('pf_'+it.key+'_l', cur.l)+'</span>'+
        '<span class="pms-side">R'+pmsRatingSwitch('pf_'+it.key+'_r', cur.r)+'</span></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='depth'){
    var DOPTS=['25','50','75','100'];
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=(vals[it.key]&&vals[it.key].d)||'';
      var boxes=DOPTS.map(function(o){ var on=(cur===o)?' on':'';
        return '<button type="button" class="pms-depthbox'+on+'" onclick="pmsSetDepth(\''+it.key+'\',\''+o+'\',this)">'+o+'%</button>'; }).join('');
      return '<div class="pms-row pms-depth"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        '<span class="pms-depthset"><input type="hidden" id="pf_'+it.key+'" value="'+attr(cur)+'">'+boxes+'</span></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='yesno'){
    var YN=['Yes','No'];
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=(vals[it.key]&&vals[it.key].v)||'';
      var boxes=YN.map(function(o){ var on=(cur===o)?' on':'';
        return '<button type="button" class="pms-ynbox'+on+'" onclick="pmsSetYN(\''+it.key+'\',\''+o+'\',this)">'+o+'</button>'; }).join('');
      return '<div class="pms-row pms-ynrow"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        '<span class="pms-ynset"><input type="hidden" id="pf_'+it.key+'" value="'+attr(cur)+'">'+boxes+'</span></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='faultcode'){
    var cur=vals[b.key]||{}; var YN=['Yes','No'];
    var boxes=YN.map(function(o){ var on=(cur.v===o)?' on':'';
      return '<button type="button" class="pms-ynbox'+on+'" onclick="pmsSetYN(\''+b.key+'\',\''+o+'\',this)">'+o+'</button>'; }).join('');
    return '<div class="pms-fault">'+
      '<div class="pms-row pms-ynrow"><span class="pms-lbl">'+esc(b.label)+'</span>'+
        '<span class="pms-ynset"><input type="hidden" id="pf_'+b.key+'" value="'+attr(cur.v||'')+'">'+boxes+'</span></div>'+
      field('Fault code notes','<textarea id="pf_'+b.key+'_note" rows="3" placeholder="Describe the fault code(s) read during the test drive" onfocus="this.select()">'+esc(cur.n||'')+'</textarea>')+
      pmsPhotoBlock(b.key, cur.photos)+
    '</div>';
  }
  if(b.kind==='condphoto'){
    var cc=vals[b.key]||{};
    return '<div class="pms-fault">'+
      '<div class="pms-row"><span class="pms-lbl">'+esc(b.label)+'</span>'+pmsRatingSwitch('pf_'+b.key, cc.s)+'</div>'+
      field(b.label+' notes','<textarea id="pf_'+b.key+'_note" rows="3" placeholder="Notes on the general condition of the vehicle" onfocus="this.select()">'+esc(cc.n||'')+'</textarea>')+
      pmsPhotoBlock(b.key, cc.photos)+
    '</div>';
  }
  if(b.kind==='condition'){
    var head='<div class="pms-row pms-cond pms-cond-head"><span class="pms-lbl"></span>'+
      '<span class="pms-cond-rate">General Tire Condition</span><span class="pms-cond-dot">Tire DOT</span></div>';
    return '<div class="pms-rows">'+head+b.items.map(function(it){
      var cur=vals[it.key]||{}; var dot=(vals[it.dotKey]!=null?vals[it.dotKey]:'');
      return '<div class="pms-row pms-cond"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        '<span class="pms-cond-rate">'+pmsRatingSwitch('pf_'+it.key, cur.s)+'</span>'+
        '<span class="pms-cond-dot"><select id="pf_'+it.dotKey+'">'+pmsYearOptions(dot)+'</select></span></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='cols'){
    function pmsCol(list,title){ var inner=(list||[]).map(function(x){return pmsBlockHTML(x,vals);}).join('');
      return '<div class="pms-col">'+(title?'<div class="pms-coltitle">'+esc(title)+'</div>':'')+inner+'</div>'; }
    return '<div class="pms-2col">'+pmsCol(b.left,b.leftTitle)+pmsCol(b.right,b.rightTitle)+'</div>';
  }
  return '';
}
/* A 3-state rating switch: radio-like swatches. Stored via a hidden input value. */
function pmsRatingSwitch(id, cur){
  var btns=PMS_RATINGS.map(function(r){
    var on=(cur===r.s)?' on':'';
    return '<button type="button" class="r-swatch '+r.cls+on+'" title="'+r.label+'" onclick="pmsSetRating(\''+id+'\',\''+r.s+'\',this)"></button>';
  }).join('');
  return '<span class="pms-rate" data-id="'+id+'"><input type="hidden" id="'+id+'" value="'+attr(cur||'')+'">'+btns+'</span>';
}
function pmsSetRating(id, s, el){
  var h=document.getElementById(id); if(!h) return;
  var toggled = h.value===s ? '' : s;   // click the active one again to clear
  h.value=toggled;
  var wrap=el.parentNode; var sw=wrap.querySelectorAll('.r-swatch');
  for(var i=0;i<sw.length;i++) sw[i].classList.remove('on');
  if(toggled) el.classList.add('on');
  var row=(el.closest)?el.closest('.pms-row'):null; if(row) row.classList.remove('needpick');   // clear the "needs a rating" flag once picked
  if(typeof pmsUpdateLegend==='function') pmsUpdateLegend();   // keep the per-colour counts live
}
function pmsSetDepth(key, d, el){
  var h=document.getElementById('pf_'+key); if(!h) return;
  var toggled = h.value===d ? '' : d;   // tap the active box again to clear
  h.value=toggled;
  var wrap=el.parentNode; var bx=wrap.querySelectorAll('.pms-depthbox');
  for(var i=0;i<bx.length;i++) bx[i].classList.remove('on');
  if(toggled) el.classList.add('on');
  var row=(el.closest)?el.closest('.pms-row'):null; if(row) row.classList.remove('needpick');
}
function pmsSetYN(key, v, el){
  var h=document.getElementById('pf_'+key); if(!h) return;
  var toggled = h.value===v ? '' : v;
  h.value=toggled;
  var wrap=el.parentNode; var bx=wrap.querySelectorAll('.pms-ynbox');
  for(var i=0;i<bx.length;i++) bx[i].classList.remove('on');
  if(toggled) el.classList.add('on');
  var row=(el.closest)?(el.closest('.pms-row')||el.closest('.fld')):null; if(row) row.classList.remove('needpick');   // row (Fault Code) OR fld (Test driven header)
}

/* ---- Row photos (fault code, general condition) --------------------------- */
/* Photos attach to the report value (values[key].photos), not the job's photo
   grid, so they travel with the checklist into the report + portal. Capture the
   current fields first (pmsCurrentSave) so a re-render doesn't lose them. Shared
   by any composite row that offers "Take / add photo" (keyed by the row's key). */
function pmsAddRowPhoto(key, files){
  var j=_pmsCtx&&jobById(_pmsCtx.jobId); if(!j) return;
  if(typeof _photosLoaded!=='undefined') _photosLoaded[j.id]=true;   // own this job's PMS photo set for the write-diff
  pmsCurrentSave();
  handlePhotoFiles(files, function(datas){
    j.pms=j.pms||{status:'in_progress'}; j.pms.report=j.pms.report||{values:{}}; j.pms.report.values=j.pms.report.values||{};
    var cur=j.pms.report.values[key]||{}; cur.photos=cur.photos||[];
    datas.forEach(function(d){ if(cur.photos.length>=6) return; cur.photos.push(d); });
    j.pms.report.values[key]=cur; persist(); toast('Photo added'); render();
  });
}
function pmsDelRowPhoto(key, i){
  var j=_pmsCtx&&jobById(_pmsCtx.jobId); if(!j) return;
  pmsCurrentSave();
  var cur=(j.pms.report.values||{})[key];
  if(cur&&cur.photos){ cur.photos.splice(i,1); persist(); render(); }
}
function pmsRowPhotoOpen(key, i){
  var j=_pmsCtx&&jobById(_pmsCtx.jobId);
  var cur=j&&j.pms&&j.pms.report&&j.pms.report.values&&j.pms.report.values[key];
  if(cur&&cur.photos&&cur.photos[i]) openLightbox(cur.photos[i]);
}

/* ---- Photo retention: auto-delete PMS photos N days after the PMS was created.
   PMS photos are heavy base64 stored inside the job doc (fault code, general
   condition, and per-section photos). This client-side sweep strips expired ones
   and persists, syncing the deletion to the server to save space. Runs shortly
   after boot and hourly while the app is open. Only removes photos — ratings,
   notes, and everything else in the report stay. */
var PMS_PHOTO_TTL_DAYS = 10;
/* When the PMS was created (ticket raised); falls back to completion time. */
function pmsCreatedAt(j){ return (j&&j.pms&&(j.pms.requestedAt||(j.pms.report&&j.pms.report.completedAt)))||null; }
function pmsPurgeExpiredPhotos(){
  if(typeof S==='undefined' || !S || !S.jobs) return;
  var now=Date.now(), ttl=PMS_PHOTO_TTL_DAYS*86400000, changed=false;
  S.jobs.forEach(function(j){
    var vals=j&&j.pms&&j.pms.report&&j.pms.report.values; if(!vals) return;
    var created=pmsCreatedAt(j); if(!created) return;
    if(now - new Date(created).getTime() < ttl) return;          // not yet expired
    var hit=false;
    Object.keys(vals).forEach(function(k){ var v=vals[k];
      if(v && typeof v==='object' && v.photos && v.photos.length){ v.photos=[]; hit=true; } });
    if(hit){ j.pms.photosPurgedAt=new Date().toISOString(); changed=true; }
  });
  if(changed && typeof persist==='function') persist();
}
function pmsRunPhotoPurges(){
  try{ pmsPurgeExpiredPhotos(); }catch(e){}
  try{ if(typeof purgeExpiredJobPhotos==='function') purgeExpiredJobPhotos(); }catch(e){}   // job photos: same 10-day policy
}
if(typeof window!=='undefined'){
  setTimeout(pmsRunPhotoPurges, 15000);      // once data has loaded
  setInterval(pmsRunPhotoPurges, 3600000);   // hourly for long sessions
}
/* Per-section photo key (the section-level "Take / add photo" at each section end). */
function pmsSecPhotoKey(sec){ return pmsKey('section photos '+sec.title); }
/* Photo thumbnails for the printable report / portal (read-only <img> row). */
function pmsPhotoImgs(photos){ return (photos||[]).map(function(s){ return '<img src="'+s+'" style="max-width:130px;max-height:100px;margin:4px 6px 0 0;border-radius:6px;vertical-align:top"/>'; }).join(''); }
/* Shared "Take / add photo" block — one renderer so every composite row (Fault
   Code, General Condition, …) and every section end looks identical. Keyed by key. */
function pmsPhotoBlock(key, photos){
  var thumbs=(photos||[]).map(function(src,i){
    return '<div class="thumb"><img src="'+src+'" onclick="pmsRowPhotoOpen(\''+key+'\','+i+')"/>'+
      '<button class="thumb-x" onclick="pmsDelRowPhoto(\''+key+'\','+i+')">✕</button></div>'; }).join('');
  return '<div class="pms-fault-photos"><div class="pms-fault-head"><span class="lbl">Photo</span>'+
    '<label class="btn sm"><input type="file" accept="image/*" capture="environment" multiple style="display:none" onchange="pmsAddRowPhoto(\''+key+'\',this.files)">📷 Take / add photo</label></div>'+
    (thumbs ? '<div class="thumbs">'+thumbs+'</div>' : '<div class="pms-photo-empty">No photo yet — tap “Take / add photo”.</div>')+
    '<div class="pms-photo-note">⚠ All photos will be deleted from the server '+PMS_PHOTO_TTL_DAYS+' days after this PMS was created. Please take a screenshot for your personal record.</div>'+
  '</div>';
}

/* ---- Signature pad -------------------------------------------------------- */
function pmsSigField(label, id, existing){
  var shown = existing ? '<img class="sig-show" id="'+id+'_img" src="'+existing+'">' : '';
  return '<div class="fld"><span class="fld-l">'+esc(label)+'</span>'+
    '<canvas class="sigpad" id="'+id+'" width="440" height="150" data-sig="'+attr(existing||'')+'"></canvas>'+shown+
    '<div class="row gap"><button type="button" class="btn sm ghost" onclick="pmsClearSig(\''+id+'\')">Clear</button></div></div>';
}
var _pmsSigBound={};
function pmsInitSigPads(){
  ['pmsSigTech','pmsSigClient'].forEach(function(id){
    var c=document.getElementById(id); if(!c || _pmsSigBound[id]===c) return; _pmsSigBound[id]=c;
    var ctx=c.getContext('2d'); ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.strokeStyle='#1D1D1F';
    var drawing=false, last=null;
    function pos(e){ var r=c.getBoundingClientRect(); var t=(e.touches&&e.touches[0])||e;
      return { x:(t.clientX-r.left)*(c.width/r.width), y:(t.clientY-r.top)*(c.height/r.height) }; }
    function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!drawing) return; var p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; c.setAttribute('data-sig','1'); e.preventDefault(); }
    function end(){ drawing=false; }
    c.addEventListener('mousedown',start); c.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',end);
  });
}
function pmsClearSig(id){ var c=document.getElementById(id); if(c){ c.getContext('2d').clearRect(0,0,c.width,c.height); c.setAttribute('data-sig',''); }
  var img=document.getElementById(id+'_img'); if(img) img.remove(); }
function pmsReadSig(id){ var c=document.getElementById(id); if(!c) return '';
  if(c.getAttribute('data-sig')){ try{ return c.toDataURL('image/png'); }catch(e){} }
  var img=document.getElementById(id+'_img'); return img?img.src:''; }

/* ---- Read + submit -------------------------------------------------------- */
/* Merge the fields currently in the DOM into `into` (only those present), so the
   wizard can save one section at a time without wiping the others. */
function readPmsValues(into){
  var vals=into||{};
  PMS_TEMPLATE.forEach(function(sec){ pmsLeafBlocks(sec).forEach(function(b){
    if(b.kind==='text'){ var te=document.getElementById('pf_'+b.key); if(te) vals[b.key]=te.value;
      if(b.yn){ var ty=document.getElementById('pf_'+b.yn.key); if(ty) vals[b.yn.key]={ v:ty.value }; } return; }
    if(b.kind==='faultcode'){ var fv=document.getElementById('pf_'+b.key), fn=document.getElementById('pf_'+b.key+'_note');
      if(fv||fn){ var prev=vals[b.key]||{}; vals[b.key]={ v: fv?fv.value:(prev.v||''), n: fn?fn.value:(prev.n||''), photos: prev.photos||[] }; } return; }
    if(b.kind==='condphoto'){ var cs=document.getElementById('pf_'+b.key), cn=document.getElementById('pf_'+b.key+'_note');
      if(cs||cn){ var cprev=vals[b.key]||{}; vals[b.key]={ s: cs?cs.value:(cprev.s||''), n: cn?cn.value:(cprev.n||''), photos: cprev.photos||[] }; } return; }
    (b.items||[]).forEach(function(it){
      if(b.kind==='measure'){ var em=document.getElementById('pf_'+it.key); if(em) vals[it.key]=em.value; }
      else if(b.kind==='rating'){ var er=document.getElementById('pf_'+it.key); if(er) vals[it.key]={ s:er.value }; }
      else if(b.kind==='depth'){ var ed=document.getElementById('pf_'+it.key); if(ed) vals[it.key]={ d:ed.value }; }
      else if(b.kind==='yesno'){ var ey=document.getElementById('pf_'+it.key); if(ey) vals[it.key]={ v:ey.value }; }
      else if(b.kind==='condition'){ var ec=document.getElementById('pf_'+it.key); if(ec) vals[it.key]={ s:ec.value }; var edot=document.getElementById('pf_'+it.dotKey); if(edot) vals[it.dotKey]=edot.value; }
      else if(b.kind==='lr'){ var l=document.getElementById('pf_'+it.key+'_l'); if(l){ var rr=document.getElementById('pf_'+it.key+'_r'); vals[it.key]={ l:l.value, r:rr?rr.value:'' }; } }
    });
  }); });
  return vals;
}
/* PMS mechanics — more than one mechanic can perform a PMS. Read the sign-off
   checkboxes, format the names, and tolerate old single-`mechanicId` reports. */
function pmsMechIds(r){
  if(r && Array.isArray(r.mechanicIds)) return r.mechanicIds.filter(Boolean);
  if(r && r.mechanicId) return [r.mechanicId];
  return [];
}
function pmsMechNames(r){ return pmsMechIds(r).map(function(id){ return staffName(id); }).filter(function(x){ return x && x!=='—' && x!=='TBA'; }).join(', '); }
function pmsReadMechChecks(){ return Array.prototype.map.call(document.querySelectorAll('.pmsMechChk:checked'), function(c){ return c.value; }); }
function submitPMS(id){
  var j=jobById(id); if(!j) return;
  pmsCurrentSave();                                  // capture the sign-off fields + persist
  var mechs=pmsReadMechChecks();
  if(!mechs.length){ toast('Select who performed the PMS','err'); var mb=document.getElementById('pmsMechBox'); if(mb){ mb.classList.add('needfill'); if(mb.scrollIntoView) mb.scrollIntoView({block:'center'}); } return; }
  var vals=(j.pms&&j.pms.report&&j.pms.report.values)||{};
  for(var i=0;i<PMS_TEMPLATE.length;i++){                // every section must be complete
    if(!pmsSectionDone(PMS_TEMPLATE[i], vals)){
      toast('Finish “'+PMS_TEMPLATE[i].title+'” before completing','err');
      _pmsCtx.step=i; render(); if(typeof window!=='undefined') window.scrollTo(0,0); return;
    }
  }
  j.pms.report=Object.assign(j.pms.report||{}, {
    values:vals, mechanicIds:mechs, mechanicId:mechs[0], saId:val('pmsSA')||j.saId||'',
    sigTech:pmsReadSig('pmsSigTech')||j.pms.report.sigTech||'', sigClient:pmsReadSig('pmsSigClient')||j.pms.report.sigClient||'',
    completedAt:new Date().toISOString()
  });
  j.pms.status='done';
  pmsLog(j, 'PMS inspection completed.');           // logged on the Job Order (uses the picked mechanic)
  persist(); toast('PMS completed and attached to '+j.no);
  go('job', j.id);
}
/* Save progress without completing (Save & exit just navigates; values persist on
   photos/status only — the full form is re-read on submit). We snapshot current
   field values when leaving the form so partial work isn't lost. */
function pmsSnapshot(){ pmsCurrentSave(); }

/* ---- In-app report view (read-only summary on the job) -------------------- */
function pmsReportPanel(j){
  var r=pmsReport(j); if(!r) return '';
  var flagged=pmsFlagged(r);
  var rows=flagged.length? flagged.map(function(f){ return '<li><span class="r-swatch '+(f.s==='replace'?'r-rep':'r-att')+'"></span>'+esc(f.label)+(f.n?' — '+esc(f.n):'')+'</li>'; }).join('')
    : '<li class="muted">All inspected items OK.</li>';
  return '<div class="card"><div class="card-head"><h2>PMS Inspection</h2><div class="row gap">'+
    '<button class="btn sm ghost" onclick="printPMSSummary(\''+j.id+'\')">⎙ Summary</button>'+
    '<button class="btn sm ghost" onclick="printPMS(\''+j.id+'\')">⎙ Report</button></div></div>'+
    '<div class="muted small">Completed '+esc(fmtDateTime(r.completedAt))+' · by '+esc(pmsMechNames(r)||'—')+'</div>'+
    '<ul class="pms-flags">'+rows+'</ul></div>';
}
/* Items needing attention or replacement (for the summary + portal highlights). */
function pmsFlagged(r){
  var out=[]; var vals=(r&&r.values)||{};
  PMS_TEMPLATE.forEach(function(sec){ pmsLeafBlocks(sec).forEach(function(b){
    if(b.kind==='condphoto'){ var cv=vals[b.key]; if(cv&&(cv.s==='attention'||cv.s==='replace')) out.push({label:b.label,s:cv.s,n:cv.n}); return; }
    (b.items||[]).forEach(function(it){
      var v=vals[it.key]; if(!v) return;
      if(b.kind==='rating' && (v.s==='attention'||v.s==='replace')) out.push({label:it.label,s:v.s,n:v.n});
      if(b.kind==='condition' && (v.s==='attention'||v.s==='replace')) out.push({label:it.label+' tire',s:v.s,n:''});
      if(b.kind==='lr'){ if(v.l==='attention'||v.l==='replace') out.push({label:it.label+' (L)',s:v.l,n:''});
        if(v.r==='attention'||v.r==='replace') out.push({label:it.label+' (R)',s:v.r,n:''}); }
    });
  }); });
  return out;
}
/* Tally of rating states across every rated item (rating/condition/lr/condphoto). */
function pmsSummaryCounts(vals){
  var c={ok:0,attention:0,replace:0,na:0};
  PMS_TEMPLATE.forEach(function(sec){ pmsLeafBlocks(sec).forEach(function(b){
    if(b.kind==='condphoto'){ var cv=vals[b.key]; if(cv&&cv.s&&c[cv.s]!=null) c[cv.s]++; return; }
    (b.items||[]).forEach(function(it){ var v=vals[it.key]; if(!v) return;
      if((b.kind==='rating'||b.kind==='condition') && v.s && c[v.s]!=null) c[v.s]++;
      else if(b.kind==='lr'){ if(v.l&&c[v.l]!=null) c[v.l]++; if(v.r&&c[v.r]!=null) c[v.r]++; }
    });
  }); });
  return c;
}
/* Sign-off summary of the whole PMS: rating tally + the flagged (attention/replace) items. */
function pmsSummaryHTML(j){
  var r=(j.pms&&j.pms.report)||{values:{}}; var vals=r.values||{};
  var c=pmsSummaryCounts(vals); var flagged=pmsFlagged(r);
  var chips='<div class="pms-sum-tally">'+
    '<span class="pms-sum-chip"><span class="r-swatch r-ok"></span>'+c.ok+' OK</span>'+
    '<span class="pms-sum-chip"><span class="r-swatch r-att"></span>'+c.attention+' Attention</span>'+
    '<span class="pms-sum-chip"><span class="r-swatch r-rep"></span>'+c.replace+' Replace</span>'+
    '<span class="pms-sum-chip"><span class="r-swatch r-na"></span>'+c.na+' N/A</span></div>';
  var body=flagged.length
    ? '<div class="pms-sum-head">Items needing attention or replacement</div><ul class="pms-flags">'+
        flagged.map(function(f){ return '<li><span class="r-swatch '+(f.s==='replace'?'r-rep':'r-att')+'"></span>'+esc(f.label)+(f.n?' — '+esc(f.n):'')+'</li>'; }).join('')+'</ul>'
    : '<div class="muted small" style="margin-top:10px">✓ All inspected items are OK — nothing flagged for attention or replacement.</div>';
  return '<div class="card"><div class="card-head"><h2>PMS Summary</h2><div class="row gap">'+
    '<button class="btn sm ghost" onclick="printPMSSummary(\''+j.id+'\')">⎙ Print summary</button>'+
    '<button class="btn sm ghost" onclick="printPMS(\''+j.id+'\')">⎙ Print full report</button></div></div>'+chips+body+'</div>';
}
/* Printable one-page PMS Summary — header + rating tally + flagged items. */
function docPMSSummary(j){
  var r=pmsReport(j)||{values:{}}; var vals=r.values||{};
  var c=pmsSummaryCounts(vals); var flagged=pmsFlagged(r);
  var tally='<table class="pms-rpt" style="margin-top:10px"><tbody>'+
    '<tr><td>'+pmsDot('ok')+' OK</td><td><b>'+c.ok+'</b></td></tr>'+
    '<tr><td>'+pmsDot('attention')+' Requires attention</td><td><b>'+c.attention+'</b></td></tr>'+
    '<tr><td>'+pmsDot('replace')+' Needs replacement</td><td><b>'+c.replace+'</b></td></tr>'+
    '<tr><td>'+pmsDot('na')+' Not applicable</td><td><b>'+c.na+'</b></td></tr></tbody></table>';
  var flags=flagged.length
    ? '<div class="dtitle" style="font-size:13px;margin-top:12px">Items needing attention or replacement</div><table class="pms-rpt"><tbody>'+
        flagged.map(function(f){ return '<tr><td>'+esc(f.label)+'</td><td>'+pmsDot(f.s)+' '+pmsStateLabel(f.s)+(f.n?' · '+esc(f.n):'')+'</td></tr>'; }).join('')+'</tbody></table>'
    : '<p style="margin-top:12px">All inspected items are OK — nothing flagged for attention or replacement.</p>';
  return docShell('PMS Summary · '+j.plate,
    docHeader('PMS Summary · '+j.plate)+pmsDocMeta(j, r)+tally+flags+'<div class="pms-pgfoot" style="margin-top:24px">1 / 1</div>');
}
function printPMSSummary(id){ var j=jobById(id); if(j) printDoc(docPMSSummary(j)); }

/* ---- Add-labor dialog: the "Perform PMS" button --------------------------- */
/* _pmsLineJob is set to the job id when a JOB (not estimate) add-labor dialog is
   open; the button only shows for the reserved PMS LABOR item. */
function pmsLaborBtnHTML(ref){
  if(ref!==PMS_LABOR_ID || typeof _pmsLineJob==='undefined' || !_pmsLineJob) return '';
  var j=jobById(_pmsLineJob); if(!j) return '';
  if(jobHasOpenPMS(j)) return '<div class="pms-cta"><span class="muted small">A PMS is already queued for this vehicle.</span></div>';
  return '<div class="pms-cta">'+
    field('Schedule PMS (optional)','<input type="datetime-local" id="pmsSchedAt">')+
    '<button type="button" class="btn primary full" onclick="performPMSFromLabor()">🔧 Perform PMS → send to tablet</button>'+
    '<div class="muted small">Adds the PMS labor line and sends an inspection ticket to the PMS Queue.</div></div>';
}
/* Add the PMS labor line to the job, then open the ticket (with any schedule). */
function performPMSFromLabor(){
  if(typeof _pmsLineJob==='undefined' || !_pmsLineJob){ toast('Open this from a Job Order','err'); return; }
  var j=jobById(_pmsLineJob); if(!j){ toast('Job not found','err'); return; }
  var sched=(typeof val==='function')?val('pmsSchedAt'):'';
  var data=(typeof readLine==='function')?readLine():null;
  if(data && data.type==='labor' && data.desc){ data.id=uid('ln'); j.lines=j.lines||[]; j.lines.push(data); }
  requestPMS(j.id, sched||null);   // persists, closes the dialog, toasts, renders
}

/* ---- After-render hook: wire the signature pads on the PMS form ----------- */
var _pmsPrevAR = (typeof afterRender==='function') ? afterRender : function(){};
afterRender = function(){
  _pmsPrevAR();
  if (ROUTE.view==='pmsform' && typeof pmsInitSigPads==='function') pmsInitSigPads();
};

/* ---- Printable / downloadable PMS report ---------------------------------- */
function pmsStateLabel(s){ return s==='ok'?'OK':s==='attention'?'Requires attention':s==='replace'?'Needs replacement':s==='na'?'Not applicable':'—'; }
function pmsDot(s){ var c=s==='ok'?'#34C759':s==='attention'?'#FFC000':s==='replace'?'#F21717':s==='na'?'#8E8E93':'#ccc';
  return '<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:'+c+';vertical-align:middle"></span>'; }
/* Single-column vehicle / service meta for the PMS printouts. */
function pmsDocMeta(j, r){
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  return '<div class="pms-meta">'+
    '<div><span>Plate</span><b>'+esc(j.plate)+'</b></div>'+
    '<div><span>Vehicle</span><b>'+esc(veh)+'</b></div>'+
    '<div><span>JO #</span><b>'+esc(j.no)+'</b></div>'+
    '<div><span>Odometer</span><b>'+odo(j.odometer)+'</b></div>'+
    '<div><span>Completed</span><b>'+esc(fmtDateTime(r.completedAt))+'</b></div>'+
    '<div><span>Performed by</span><b>'+esc(pmsMechNames(r)||'—')+'</b></div></div>';
}
function docPMS(j){
  var r=pmsReport(j)||{values:{}}; var vals=r.values||{};
  var sigs='<div class="sig-grid"><div class="sigline">Service Adviser'+(r.saId?' · '+esc(staffName(r.saId)):'')+'</div></div>';
  var body=PMS_TEMPLATE.map(function(sec, si){
    var rows=pmsLeafBlocks(sec).map(function(b){
      if(b.kind==='text'){ var out=''; if(b.yn){ var yv=vals[b.yn.key]; if(yv&&yv.v) out+='<tr><td>'+esc(b.yn.label)+'</td><td><b>'+esc(yv.v)+'</b></td></tr>'; }
        var t=vals[b.key]; if(t) out+= b.labeled ? '<tr><td>'+esc(b.label)+'</td><td>'+esc(t)+'</td></tr>' : '<tr><td colspan="2">'+esc(t)+'</td></tr>'; return out; }
      if(b.kind==='faultcode'){ var fv=vals[b.key]; if(!fv||(!fv.v&&!fv.n&&!(fv.photos&&fv.photos.length))) return '';
        var ph=(fv.photos||[]).map(function(s){ return '<img src="'+s+'" style="max-width:130px;max-height:100px;margin:4px 6px 0 0;border-radius:6px;vertical-align:top"/>'; }).join('');
        return '<tr><td>'+esc(b.label)+'</td><td>'+(fv.v?'<b>'+esc(fv.v)+'</b>':'—')+(fv.n?' · '+esc(fv.n):'')+(ph?'<div style="margin-top:4px">'+ph+'</div>':'')+'</td></tr>'; }
      if(b.kind==='condphoto'){ var cv=vals[b.key]; if(!cv||(!cv.s&&!cv.n&&!(cv.photos&&cv.photos.length))) return '';
        var cph=(cv.photos||[]).map(function(s){ return '<img src="'+s+'" style="max-width:130px;max-height:100px;margin:4px 6px 0 0;border-radius:6px;vertical-align:top"/>'; }).join('');
        return '<tr><td>'+esc(b.label)+'</td><td>'+(cv.s?pmsDot(cv.s)+' '+pmsStateLabel(cv.s):'—')+(cv.n?' · '+esc(cv.n):'')+(cph?'<div style="margin-top:4px">'+cph+'</div>':'')+'</td></tr>'; }
      return (b.items||[]).map(function(it){
        var v=vals[it.key];
        if(b.kind==='measure'){ if(v==null||v==='') return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+esc(v)+(it.unit?' '+esc(it.unit):'')+'</td></tr>'; }
        if(b.kind==='depth'){ if(!v||!v.d) return ''; return '<tr><td>'+esc(it.label)+' tread</td><td>'+esc(v.d)+'%</td></tr>'; }
        if(b.kind==='condition'){ var dt=vals[it.dotKey]; if((!v||!v.s)&&!dt) return ''; return '<tr><td>'+esc(it.label)+' tire</td><td>'+((v&&v.s)?pmsDot(v.s)+' '+pmsStateLabel(v.s):'—')+(dt?' · DOT '+esc(dt):'')+'</td></tr>'; }
        if(b.kind==='yesno'){ if(!v||!v.v) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+esc(v.v)+'</td></tr>'; }
        if(b.kind==='check'){ if(!v) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.c?'✓ done':'—')+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='rating'){ if(!v||!v.s) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+pmsDot(v.s)+' '+pmsStateLabel(v.s)+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='lr'){ if(!v||(!v.l&&!v.r&&!v.na)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.na?'N/A':('L '+pmsDot(v.l)+' '+pmsStateLabel(v.l)+' &nbsp; R '+pmsDot(v.r)+' '+pmsStateLabel(v.r)))+'</td></tr>'; }
        return '';
      }).join('');
    }).join('');
    var sph=pmsPhotoImgs((vals[pmsSecPhotoKey(sec)]&&vals[pmsSecPhotoKey(sec)].photos)||[]);
    if(!rows && !sph) return '';   // skip empty sections — no wasted paper
    // Flow sections continuously (rows packed) to conserve paper. Keep each
    // section's title with its first rows so a heading never orphans at a break.
    return '<div class="pms-sec-blk"><div class="dtitle" style="font-size:12.5px;margin-top:12px">'+esc(sec.title)+'</div>'+
      (rows?'<table class="pms-rpt"><tbody>'+rows+'</tbody></table>':'')+
      (sph?'<div style="margin-top:4px">'+sph+'</div>':'')+'</div>';
  }).join('');
  return docShell('PMS · '+j.plate, docHeader('Multipoint Inspection Report · '+j.plate)+pmsDocMeta(j, r)+body+sigs);
}
function printPMS(id){ var j=jobById(id); if(j) printDoc(docPMS(j)); }

/* ---- Customer portal: full checklist -------------------------------------- */
function portalPmsHTML(pms){
  var vals=pms.values||{};
  var secs=PMS_TEMPLATE.map(function(sec){
    var rows=pmsLeafBlocks(sec).map(function(b){
      if(b.kind==='text'){ var out=''; if(b.yn){ var yv=vals[b.yn.key]; if(yv&&yv.v) out+='<tr><td>'+esc(b.yn.label)+'</td><td>'+esc(yv.v)+'</td></tr>'; }
        var t=vals[b.key]; if(t) out+= b.labeled ? '<tr><td>'+esc(b.label)+'</td><td>'+esc(t)+'</td></tr>' : '<tr><td colspan="2">'+esc(t)+'</td></tr>'; return out; }
      if(b.kind==='faultcode'){ var fv=vals[b.key]; if(!fv||(!fv.v&&!fv.n&&!(fv.photos&&fv.photos.length))) return '';
        var ph=(fv.photos||[]).map(function(s){ return '<img src="'+s+'" style="max-width:130px;max-height:100px;margin:4px 6px 0 0;border-radius:6px;vertical-align:top"/>'; }).join('');
        return '<tr><td>'+esc(b.label)+'</td><td>'+(fv.v?esc(fv.v):'—')+(fv.n?' · '+esc(fv.n):'')+(ph?'<div style="margin-top:4px">'+ph+'</div>':'')+'</td></tr>'; }
      if(b.kind==='condphoto'){ var cv=vals[b.key]; if(!cv||(!cv.s&&!cv.n&&!(cv.photos&&cv.photos.length))) return '';
        var cph=(cv.photos||[]).map(function(s){ return '<img src="'+s+'" style="max-width:130px;max-height:100px;margin:4px 6px 0 0;border-radius:6px;vertical-align:top"/>'; }).join('');
        return '<tr><td>'+esc(b.label)+'</td><td>'+(cv.s?pmsDot(cv.s)+' '+pmsStateLabel(cv.s):'—')+(cv.n?' · '+esc(cv.n):'')+(cph?'<div style="margin-top:4px">'+cph+'</div>':'')+'</td></tr>'; }
      return (b.items||[]).map(function(it){
        var v=vals[it.key];
        if(b.kind==='measure'){ if(v==null||v==='') return ''; return '<tr><td>'+esc(it.label)+'</td><td class="r">'+esc(v)+(it.unit?' '+esc(it.unit):'')+'</td></tr>'; }
        if(b.kind==='depth'){ if(!v||!v.d) return ''; return '<tr><td>'+esc(it.label)+' tread</td><td class="r">'+esc(v.d)+'%</td></tr>'; }
        if(b.kind==='condition'){ var dt=vals[it.dotKey]; if((!v||!v.s)&&!dt) return ''; return '<tr><td>'+esc(it.label)+' tire</td><td>'+((v&&v.s)?pmsDot(v.s)+' '+pmsStateLabel(v.s):'—')+(dt?' · DOT '+esc(dt):'')+'</td></tr>'; }
        if(b.kind==='yesno'){ if(!v||!v.v) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+esc(v.v)+'</td></tr>'; }
        if(b.kind==='check'){ if(!v||(!v.c&&!v.n)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.c?'✓':'')+(v.n?' '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='rating'){ if(!v||!v.s) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+pmsDot(v.s)+' '+pmsStateLabel(v.s)+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='lr'){ if(!v||(!v.l&&!v.r&&!v.na)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.na?'N/A':('L '+pmsDot(v.l)+' &nbsp; R '+pmsDot(v.r)))+'</td></tr>'; }
        return '';
      }).join('');
    }).join('');
    var sph=pmsPhotoImgs((vals[pmsSecPhotoKey(sec)]&&vals[pmsSecPhotoKey(sec)].photos)||[]);
    if(!rows && !sph) return '';
    return '<div class="p-pms-sec">'+esc(sec.title)+'</div>'+
      (rows?'<table class="p-tbl"><tbody>'+rows+'</tbody></table>':'')+
      (sph?'<div style="margin-top:4px">'+sph+'</div>':'');
  }).join('');
  return '<div class="p-card"><div class="p-card-t">Multipoint Inspection'+(pms.completedAt?' · '+fmtDate(pms.completedAt):'')+'</div>'+
    (pms.mechanic?'<div class="p-kv"><span>Performed by</span><span>'+esc(pms.mechanic)+'</span></div>':'')+
    secs+'</div>';
}
