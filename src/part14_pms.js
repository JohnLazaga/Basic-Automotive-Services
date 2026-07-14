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
/* stable, id-safe key from a label */
function pmsKey(l){ return String(l).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }

var PMS_TEMPLATE = [
  { title:'Exterior', blocks:[ pmsCheck([
    'Park light','Low beam','High beam','Fog lights','Signal lights front','Wiper FR','Wiper RR',
    'Wiper washer','Brake lights','Third brake','Signal lights RR','Door handle','Door locks',
    'Fender lights','Side mirrors','Signal lights side','Windows','Reverse light','Rear park light','Plate light' ]) ] },

  { title:'Tires', blocks:[
    pmsMeasure([['FR pressure before','PSI'],['FR pressure after','PSI'],['FL pressure before','PSI'],['FL pressure after','PSI'],
      ['RR pressure before','PSI'],['RR pressure after','PSI'],['RL pressure before','PSI'],['RL pressure after','PSI'],
      ['Spare pressure before','PSI'],['Spare pressure after','PSI']]),
    pmsRate(['Tire depth FR','Tire depth FL','Tire depth RR','Tire depth RL','Tire depth Spare']),
    pmsRate(['Tire pattern/damage FR','Tire pattern/damage FL','Tire pattern/damage RR','Tire pattern/damage RL','Tire pattern/damage Spare']),
    pmsCheck(['Tires rotated','Balanced']) ] },

  { title:'Interior', blocks:[ pmsCheck([
    'Horn','Gauge','Seats','Seat belts','Shift knob','Matting','Windows interior','AC control','Radio system',
    'Wiper controls','Map/dome light','Hood release','Trunk release' ]) ] },

  { title:'Brakes', blocks:[
    pmsRate(['Brake pads/shoe FR','Brake pads/shoe FL','Brake pads/shoe RR','Brake pads/shoe RL']),
    pmsRate(['Rotor/drum FR','Rotor/drum FL','Rotor/drum RR','Rotor/drum RL']),
    pmsRate(['Brake caliper/cylinder FR','Brake caliper/cylinder FL','Brake caliper/cylinder RR','Brake caliper/cylinder RL']),
    pmsRate(['Brake hose FR','Brake hose FL','Brake hose RR','Brake hose RL']),
    pmsRate(['Brake fluid condition']),
    pmsCheck(['Brakes cleaned','Parking brake adjusted']) ] },

  { title:'Test drive notes / fault codes', blocks:[ pmsText('Test drive notes / fault codes') ] },

  { title:'Engine Bay — Fluids', blocks:[ pmsRate([
    'Engine oil','Coolant','Brake fluid (engine)','Clutch fluid','PS fluid','Trans fluid','Diff oil','Washer fluid' ]) ] },

  { title:'Battery', blocks:[ pmsMeasure([
    ['Battery voltage','V'],['Stock battery CCA','CCA'],['Actual battery CCA','CCA'],['Charging voltage','V'],['Battery health','%'] ]) ] },

  { title:'Engine Bay — Systems', blocks:[
    pmsCheck(['Air filter','Fuel filter','Cabin filter',
      'Radiator cap','Radiator hoses','Bypass hoses','Reservoir','Clutch fan/motor',
      'Ignition coil','Spark plugs','Distributor','Spark plug cable',
      'Engine mount','Trans mount','Torque mount',
      'Alternator','Water pump','Power steering pump','Vacuum pump','Aircon compressor']),
    pmsRate(['Main belt','Auxiliary belts']) ] },

  { title:'Oil / Fluid Leaks', blocks:[ pmsCheck([
    'Valve cover gasket','Intake hose','Turbo hose','Intercooler','Spool valve','Oil pan gasket','Axle oil seals',
    'Camshaft oil seal','Front crank seal','Rear crank seal','Trans oil seal','Diff oil seal' ]) ] },

  { title:'Drivetrain', blocks:[ pmsCheck([
    'Clutch pedal','Shifter linkage/cable','Inner CV joint front','Inner CV joint rear','Outer CV joint front',
    'Outer CV joint rear','CV boots & straps','Clutch master','Clutch slave','Wheel bearing RR','Wheel bearing RL',
    'Wheel bearing FR','Wheel bearing FL','Cross joint','Differential','Center bearing' ]) ] },

  { title:'Steering & Suspension', blocks:[
    pmsLR(['Stabilizer link front','Stabilizer link rear','Stabilizer bar bushing front','Stabilizer bar bushing rear',
      'Lower arm big bushing (front)','Lower arm small bushing (front)','Lower arm ball joint (front)','Caster bar bushing',
      'Upper arm big bushing','Upper arm small bushing','Upper arm ball joint',
      'Shock piston front','Shock boots front','Shock mounting front','Shock bushing front',
      'Shock piston rear','Shock boots rear','Shock mounting rear','Shock bushing rear']),
    pmsCheck(['Rear suspension bushings','Torsion bar front','Torsion beam','Trailing arms','Panhard rod','Leaf springs',
      'Leaf spring bushings','Coil springs','Coil spring pads','Lateral links','Rear ball joints']),
    pmsLR(['Outer tie rod','Inner tie rod/rack end','Steering boots']),
    pmsCheck(['Steering rack assembly','Steering gear box','Center link','Idler arm','Center post','Pitman arm','Power steering hoses']) ] },

  { title:'Notes', blocks:[ pmsText('Notes') ] }
];

/* ---- Ticket lifecycle (embedded on the job) ------------------------------- */
function jobHasOpenPMS(j){ return !!(j && j.pms && j.pms.status && j.pms.status!=='done'); }
function pmsReport(j){ return (j && j.pms && j.pms.report) || null; }

/* "Perform PMS" — open a ticket for this job (from the add-labor dialog). */
function requestPMS(id){
  var j=jobById(id); if(!j){ toast('Job not found','err'); return; }
  if(!j.pms) j.pms={};
  if(j.pms.status && j.pms.status!=='done'){ toast('A PMS is already queued for this vehicle','err'); return; }
  j.pms={ status:'open', requestedAt:new Date().toISOString(), requestedBy:(typeof CURRENT_USER!=='undefined'&&CURRENT_USER?CURRENT_USER.name:null), report:(j.pms&&j.pms.report)||null };
  persist(); closeModal();
  toast('PMS ticket sent to the tablet queue');
  render();
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
    return '<div class="pms-q" onclick="startPMS(\''+j.id+'\')">'+
      '<div class="pms-q-top"><b>'+esc(j.plate)+'</b> '+st+'</div>'+
      '<div class="muted small">'+esc(veh||'—')+' · JO '+esc(j.no)+'</div>'+
      '<div class="muted small">Requested '+esc(fmtDateTime(j.pms.requestedAt))+'</div>'+
      '<button class="btn primary full mt8">Perform inspection →</button></div>';
  }).join('') : emptyState('No PMS in the queue. Tickets appear here when a Job Order sends a "Perform PMS".');
  return '<div class="page"><div class="page-head"><h1>PMS Queue</h1><div class="muted small">'+q.length+' waiting</div></div>'+
    '<div class="pms-qgrid">'+cards+'</div></div>';
};

/* ---- Kiosk: fill the checklist -------------------------------------------- */
var _pmsCtx=null;   // { jobId }
function startPMS(id){
  var j=jobById(id); if(!j) return;
  if(!j.pms) j.pms={status:'open'};
  if(j.pms.status==='open'){ j.pms.status='in_progress'; persist(); }
  _pmsCtx={ jobId:id };
  go('pmsform', id);
}
VIEWS.pmsform = function(id){
  var j=jobById(id||(_pmsCtx&&_pmsCtx.jobId)); if(!j) return '<div class="page">'+emptyState('Job not found.')+'</div>';
  _pmsCtx={ jobId:j.id };
  var r=(j.pms&&j.pms.report)||{ values:{} }; var vals=r.values||{};
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  var staffOpts=optionList(S.staff, r.mechanicId||'', false);
  var saOpts=optionList(S.staff, r.saId||j.saId||'', false);
  var sections=PMS_TEMPLATE.map(function(sec){ return pmsSectionHTML(sec, vals); }).join('');
  return '<div class="page pms-form">'+
    '<div class="page-head"><div><a class="back" onclick="go(\'pms\')">‹ PMS Queue</a>'+
      '<h1>PMS · '+esc(j.plate)+'</h1><div class="muted small">'+esc(veh)+' · JO '+esc(j.no)+'</div></div></div>'+
    '<div class="pms-legend"><span class="r-swatch r-ok"></span>OK &nbsp; <span class="r-swatch r-att"></span>Requires attention &nbsp; <span class="r-swatch r-rep"></span>Needs replacement &nbsp; <span class="r-swatch r-na"></span>Not applicable</div>'+
    sections+
    /* damage photos reuse the job photo system */
    '<div class="card"><div class="card-head"><h2>Damage / condition photos</h2>'+
      '<label class="btn sm"><input type="file" accept="image/*" multiple style="display:none" onchange="addPhotos(\''+j.id+'\',this.files)">＋ Add photos</label></div>'+
      '<div class="thumbs" id="pmsThumbs">'+pmsThumbsHTML(j)+'</div></div>'+
    /* signatures + who performed */
    '<div class="card"><h2>Sign-off</h2><div class="grid2">'+
      field('Performed by (Mechanic)','<select id="pmsMech">'+staffOpts+'</select>')+
      field('Service Adviser','<select id="pmsSA">'+saOpts+'</select>')+'</div>'+
      '<div class="grid2">'+
        pmsSigField('Technician signature','pmsSigTech', r.sigTech)+
        pmsSigField('Client signature','pmsSigClient', r.sigClient)+'</div></div>'+
    '<div class="row gap" style="margin:8px 0 40px">'+
      '<button class="btn ghost" onclick="pmsSnapshot();go(\'pms\')">Save & exit</button>'+
      '<span style="flex:1"></span>'+
      '<button class="btn primary" onclick="submitPMS(\''+j.id+'\')">✓ Complete PMS</button></div>'+
  '</div>';
};
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
  return '<div class="card pms-sec"><h2>'+esc(sec.title)+'</h2>'+body+'</div>';
}
function pmsBlockHTML(b, vals){
  if(b.kind==='text'){ var tv=vals[b.key]||''; return field(b.label,'<textarea id="pf_'+b.key+'" rows="3">'+esc(tv)+'</textarea>'); }
  if(b.kind==='measure'){
    return '<div class="pms-grid">'+b.items.map(function(it){
      var v=vals[it.key]; v=(v==null?'':v);
      return field(it.label+(it.unit?' ('+it.unit+')':''),'<input id="pf_'+it.key+'" type="text" inputmode="decimal" value="'+attr(v)+'" onfocus="this.select()">');
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
        pmsRatingSwitch('pf_'+it.key, cur.s)+
        '<input class="pms-note" id="pf_'+it.key+'_n" value="'+attr(cur.n||'')+'" placeholder="note" onfocus="this.select()"></div>';
    }).join('')+'</div>';
  }
  if(b.kind==='lr'){
    return '<div class="pms-rows">'+b.items.map(function(it){
      var cur=vals[it.key]||{}; var na=cur.na?' checked':'';
      return '<div class="pms-row pms-lr"><span class="pms-lbl">'+esc(it.label)+'</span>'+
        '<span class="pms-side">L'+pmsRatingSwitch('pf_'+it.key+'_l', cur.l)+'</span>'+
        '<span class="pms-side">R'+pmsRatingSwitch('pf_'+it.key+'_r', cur.r)+'</span>'+
        '<label class="pms-chk sm"><input type="checkbox" id="pf_'+it.key+'_na"'+na+'> N/A</label></div>';
    }).join('')+'</div>';
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
function readPmsValues(){
  var vals={};
  PMS_TEMPLATE.forEach(function(sec){ sec.blocks.forEach(function(b){
    if(b.kind==='text'){ vals[b.key]=val('pf_'+b.key); return; }
    (b.items||[]).forEach(function(it){
      if(b.kind==='measure'){ vals[it.key]=val('pf_'+it.key); }
      else if(b.kind==='check'){ vals[it.key]={ c:checked('pf_'+it.key+'_c'), n:val('pf_'+it.key+'_n') }; }
      else if(b.kind==='rating'){ vals[it.key]={ s:val('pf_'+it.key), n:val('pf_'+it.key+'_n') }; }
      else if(b.kind==='lr'){ vals[it.key]={ l:val('pf_'+it.key+'_l'), r:val('pf_'+it.key+'_r'), na:checked('pf_'+it.key+'_na') }; }
    });
  }); });
  return vals;
}
function submitPMS(id){
  var j=jobById(id); if(!j) return;
  var mech=val('pmsMech'); if(!mech || !staffById(mech)){ toast('Select who performed the PMS','err'); var e=document.getElementById('pmsMech'); if(e) e.focus(); return; }
  j.pms=j.pms||{};
  j.pms.report={
    values:readPmsValues(),
    mechanicId:mech, saId:val('pmsSA')||j.saId||'',
    sigTech:pmsReadSig('pmsSigTech'), sigClient:pmsReadSig('pmsSigClient'),
    completedAt:new Date().toISOString()
  };
  j.pms.status='done';
  persist(); toast('PMS completed and attached to '+j.no);
  go('job', j.id);
}
/* Save progress without completing (Save & exit just navigates; values persist on
   photos/status only — the full form is re-read on submit). We snapshot current
   field values when leaving the form so partial work isn't lost. */
function pmsSnapshot(){
  if(!_pmsCtx) return; var j=jobById(_pmsCtx.jobId); if(!j || !document.getElementById('pf_notes')) return;
  j.pms=j.pms||{status:'in_progress'};
  j.pms.report=Object.assign({}, j.pms.report||{}, { values:readPmsValues(),
    mechanicId:val('pmsMech')||'', saId:val('pmsSA')||'', sigTech:pmsReadSig('pmsSigTech'), sigClient:pmsReadSig('pmsSigClient') });
  persist();
}

/* ---- In-app report view (read-only summary on the job) -------------------- */
function pmsReportPanel(j){
  var r=pmsReport(j); if(!r) return '';
  var flagged=pmsFlagged(r);
  var rows=flagged.length? flagged.map(function(f){ return '<li><span class="r-swatch '+(f.s==='replace'?'r-rep':'r-att')+'"></span>'+esc(f.label)+(f.n?' — '+esc(f.n):'')+'</li>'; }).join('')
    : '<li class="muted">All inspected items OK.</li>';
  return '<div class="card"><div class="card-head"><h2>PMS Inspection</h2>'+
    '<button class="btn sm ghost" onclick="printPMS(\''+j.id+'\')">⎙ Report</button></div>'+
    '<div class="muted small">Completed '+esc(fmtDateTime(r.completedAt))+' · by '+esc(staffName(r.mechanicId))+'</div>'+
    '<ul class="pms-flags">'+rows+'</ul></div>';
}
/* Items needing attention or replacement (for the summary + portal highlights). */
function pmsFlagged(r){
  var out=[]; var vals=(r&&r.values)||{};
  PMS_TEMPLATE.forEach(function(sec){ sec.blocks.forEach(function(b){
    (b.items||[]).forEach(function(it){
      var v=vals[it.key]; if(!v) return;
      if(b.kind==='rating' && (v.s==='attention'||v.s==='replace')) out.push({label:it.label,s:v.s,n:v.n});
      if(b.kind==='lr'){ if(v.l==='attention'||v.l==='replace') out.push({label:it.label+' (L)',s:v.l,n:''});
        if(v.r==='attention'||v.r==='replace') out.push({label:it.label+' (R)',s:v.r,n:''}); }
    });
  }); });
  return out;
}

/* ---- Add-labor dialog: the "Perform PMS" button --------------------------- */
/* _pmsLineJob is set to the job id when a JOB (not estimate) add-labor dialog is
   open; the button only shows for the reserved PMS LABOR item. */
function pmsLaborBtnHTML(ref){
  if(ref!==PMS_LABOR_ID || typeof _pmsLineJob==='undefined' || !_pmsLineJob) return '';
  var j=jobById(_pmsLineJob); if(!j) return '';
  if(jobHasOpenPMS(j)) return '<div class="pms-cta"><span class="muted small">A PMS is already queued for this vehicle.</span></div>';
  return '<div class="pms-cta"><button type="button" class="btn primary full" onclick="performPMSFromLabor()">🔧 Perform PMS → send to tablet</button>'+
    '<div class="muted small">Adds the PMS labor line and sends an inspection ticket to the PMS Queue.</div></div>';
}
/* Add the PMS labor line to the job, then open the ticket. */
function performPMSFromLabor(){
  if(typeof _pmsLineJob==='undefined' || !_pmsLineJob){ toast('Open this from a Job Order','err'); return; }
  var j=jobById(_pmsLineJob); if(!j){ toast('Job not found','err'); return; }
  var data=(typeof readLine==='function')?readLine():null;
  if(data && data.type==='labor' && data.desc){ data.id=uid('ln'); j.lines=j.lines||[]; j.lines.push(data); }
  requestPMS(j.id);   // persists, closes the dialog, toasts, renders
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
function docPMS(j){
  var r=pmsReport(j)||{values:{}}; var vals=r.values||{};
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  var head='<table style="width:100%;font-size:12px"><tr>'+
    '<td>Plate: <b>'+esc(j.plate)+'</b><br>Vehicle: '+esc(veh)+'<br>JO #: '+esc(j.no)+'</td>'+
    '<td style="text-align:right">Odometer: '+odo(j.odometer)+'<br>Completed: '+esc(fmtDateTime(r.completedAt))+
      '<br>Performed by: '+esc(staffName(r.mechanicId))+'</td></tr></table>';
  var body=PMS_TEMPLATE.map(function(sec){
    var rows=sec.blocks.map(function(b){
      if(b.kind==='text'){ var t=vals[b.key]; return t?'<tr><td colspan="2">'+esc(t)+'</td></tr>':''; }
      return (b.items||[]).map(function(it){
        var v=vals[it.key];
        if(b.kind==='measure'){ if(v==null||v==='') return ''; return '<tr><td>'+esc(it.label)+'</td><td class="r">'+esc(v)+(it.unit?' '+esc(it.unit):'')+'</td></tr>'; }
        if(b.kind==='check'){ if(!v) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.c?'✓ done':'—')+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='rating'){ if(!v||!v.s) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+pmsDot(v.s)+' '+pmsStateLabel(v.s)+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='lr'){ if(!v||(!v.l&&!v.r&&!v.na)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.na?'N/A':('L '+pmsDot(v.l)+' '+pmsStateLabel(v.l)+' &nbsp; R '+pmsDot(v.r)+' '+pmsStateLabel(v.r)))+'</td></tr>'; }
        return '';
      }).join('');
    }).join('');
    if(!rows) return '';
    return '<div class="dtitle" style="font-size:13px;margin-top:10px">'+esc(sec.title)+'</div>'+
      '<table><tbody>'+rows+'</tbody></table>';
  }).join('');
  var sigs='<div class="sig-grid">'+
    '<div class="sigline">'+(r.sigTech?'<img class="sigimg" src="'+r.sigTech+'"/>':'')+'Technician'+(r.mechanicId?' · '+esc(staffName(r.mechanicId)):'')+'</div>'+
    '<div class="sigline">'+(r.sigClient?'<img class="sigimg" src="'+r.sigClient+'"/>':'')+'Client</div>'+
    '<div class="sigline">Service Adviser'+(r.saId?' · '+esc(staffName(r.saId)):'')+'</div></div>';
  return docShell('PMS · '+j.plate, '<h2 style="margin:0 0 6px">Multipoint Inspection Report</h2>'+head+body+sigs);
}
function printPMS(id){ var j=jobById(id); if(j) printDoc(docPMS(j)); }

/* ---- Customer portal: full checklist -------------------------------------- */
function portalPmsHTML(pms){
  var vals=pms.values||{};
  var secs=PMS_TEMPLATE.map(function(sec){
    var rows=sec.blocks.map(function(b){
      if(b.kind==='text'){ var t=vals[b.key]; return t?'<tr><td colspan="2">'+esc(t)+'</td></tr>':''; }
      return (b.items||[]).map(function(it){
        var v=vals[it.key];
        if(b.kind==='measure'){ if(v==null||v==='') return ''; return '<tr><td>'+esc(it.label)+'</td><td class="r">'+esc(v)+(it.unit?' '+esc(it.unit):'')+'</td></tr>'; }
        if(b.kind==='check'){ if(!v||(!v.c&&!v.n)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.c?'✓':'')+(v.n?' '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='rating'){ if(!v||!v.s) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+pmsDot(v.s)+' '+pmsStateLabel(v.s)+(v.n?' · '+esc(v.n):'')+'</td></tr>'; }
        if(b.kind==='lr'){ if(!v||(!v.l&&!v.r&&!v.na)) return ''; return '<tr><td>'+esc(it.label)+'</td><td>'+(v.na?'N/A':('L '+pmsDot(v.l)+' &nbsp; R '+pmsDot(v.r)))+'</td></tr>'; }
        return '';
      }).join('');
    }).join('');
    return rows? '<div class="p-pms-sec">'+esc(sec.title)+'</div><table class="p-tbl"><tbody>'+rows+'</tbody></table>' : '';
  }).join('');
  return '<div class="p-card"><div class="p-card-t">Multipoint Inspection'+(pms.completedAt?' · '+fmtDate(pms.completedAt):'')+'</div>'+
    (pms.mechanic?'<div class="p-kv"><span>Performed by</span><span>'+esc(pms.mechanic)+'</span></div>':'')+
    secs+'</div>';
}
