/* ============================================================================
   PART 10 — Customer QR portal (read-only, mobile) + boot
   Same file serves both: #v=<id> renders the portal instead of the shop UI.
   ========================================================================== */

function portalVehicleId(){
  if (typeof location==='undefined') return null;
  var m=(location.hash||'').match(/#v=([^&]+)/);
  return m? decodeURIComponent(m[1]) : null;
}
function isPortalRoute(){ return !!portalVehicleId(); }

function portalHTML(){
  var v=vehicleById(portalVehicleId());
  if(!v) return '<div class="portal"><div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<div class="p-card">Vehicle not found.</div></div>';
  var hist=S.jobs.filter(function(j){return j.vehicleId===v.id||(j.plate||'').toUpperCase()===(v.plate||'').toUpperCase();})
    .filter(function(j){return j.stage==='Released'||j.stage==='Final Billing';})
    .sort(function(a,b){return (b.dateIn||'')<(a.dateIn||'')?-1:1;});
  var photos=[]; hist.forEach(function(j){ (j.photos||[]).forEach(function(p){ photos.push(p); }); });
  var timeline=hist.length? hist.map(function(j){
    return '<div class="p-item"><div class="p-date">'+esc(fmtDate(j.billedAt||j.dateIn))+'</div>'+
      '<div class="p-work">'+esc((j.lines||[]).map(function(l){return l.desc;}).join(' · ')||'Service')+'</div>'+
      '<div class="p-odo">'+num(j.odometer)+' km</div></div>';
  }).join('') : '<div class="p-empty">No service records yet.</div>';
  var due = v.nextServiceDate && v.nextServiceDate<=todayISO();
  return '<div class="portal">'+
    '<div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<div class="p-veh"><div class="p-plate">'+esc(v.plate)+'</div>'+
      '<div class="p-model">'+esc(v.year+' '+v.make+' '+v.model)+'</div>'+
      '<div class="p-owner">'+esc(v.owner)+'</div></div>'+
    '<div class="p-card '+(due?'p-due':'')+'"><div class="p-card-t">Next service</div>'+
      '<div class="p-big">'+(v.nextServiceDate? (due?'⚠ Overdue · ':'')+fmtDate(v.nextServiceDate) : 'Not scheduled')+'</div>'+
      (v.nextServiceOdo?'<div class="p-card-s">or at '+num(v.nextServiceOdo)+' km</div>':'')+'</div>'+
    '<div class="p-card"><div class="p-card-t">Service history</div>'+timeline+'</div>'+
    (photos.length?'<div class="p-card"><div class="p-card-t">Photos</div><div class="p-photos">'+photos.slice(0,12).map(function(p){return '<img src="'+(p.url||p.data)+'"/>';}).join('')+'</div></div>':'')+
    '<div class="p-card"><div class="p-card-t">Contact</div><div class="p-contact">'+esc(S.shop.name)+'<br>'+esc(S.shop.address)+'<br>'+esc(S.shop.contact)+'</div>'+
      '<a class="p-btn" href="tel:'+esc((S.shop.contact||'').replace(/[^0-9+]/g,''))+'">Call the shop</a></div>'+
    '<div class="p-foot">Read-only customer portal · powered by '+esc(S.shop.name)+'</div>'+
  '</div>';
}
function previewPortal(id){
  var v=vehicleById(id);
  // temporarily fake the portal id so portalHTML() targets this vehicle
  var realFn=portalVehicleId;
  portalVehicleId=function(){ return id; };
  var html=portalHTML();
  portalVehicleId=realFn;
  openModal('Portal preview · '+esc(v.plate),
    '<div class="portal-frame">'+html+'</div>',
    { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>', width:'440px' });
}

/* ---- Boot ----------------------------------------------------------------- */
async function boot(){
  // Cloud mode: require staff sign-in first; cloudBoot() drives rendering.
  if (typeof cloudOn==='function' && cloudOn()){ cloudBoot(); return; }
  await loadState();
  applyTheme((S.shop && S.shop.theme) || 'light');
  render();
  if (typeof window!=='undefined'){
    window.addEventListener('hashchange', render);
  }
}
if (typeof window!=='undefined'){
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

/* ---- Node test exports ---------------------------------------------------- */
if (typeof module!=='undefined' && module.exports){
  module.exports = {
    seedState:seedState, blankShop:blankShop,
    setS:function(x){ S=x; }, getS:function(){ return S; },
    peso:peso, round2:round2, vatSplit:vatSplit, jobLaborCommission:jobLaborCommission,
    laborTotal:laborTotal, partsTotal:partsTotal, jobGross:jobGross, jobBalance:jobBalance,
    runningBill:runningBill, commissionTable:commissionTable, agingBucket:agingBucket,
    VIEWS:function(){ return VIEWS; },
    docJobOrder:docJobOrder, docPostJob:docPostJob, docBilling:docBilling, docEstimate:docEstimate,
    docPO:docPO, docStatement:docStatement, docPayout:docPayout, docDailyClose:docDailyClose,
    createJob:createJob, createJobFromAppt:createJobFromAppt, createEstimateFrom:createEstimateFrom,
    deductInventory:deductInventory, receivePO:receivePO,
    importPartsText:importPartsText, importPartsFromArray:importPartsFromArray, parseCSV:parseCSV,
    portalHTML:portalHTML, isPortalRoute:isPortalRoute, setPortalId:function(fn){ portalVehicleId=fn; },
    render:function(){ return render(); }, setRoute:function(v,a){ ROUTE.view=v; ROUTE.arg=a||null; },
    LOGO_URI:function(){ return LOGO_URI; }, LOGO_LOCKUP:function(){ return LOGO_LOCKUP; },
    arJobs:arJobs, jobByNo:jobByNo, vehicleByPlate:vehicleByPlate, partById:partById,
    advancePostJob:null
  };
}
