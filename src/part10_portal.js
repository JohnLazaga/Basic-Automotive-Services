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

/* Minimal, PUBLIC-safe snapshot of one vehicle — the ONLY shape ever written to
   the public `portal` collection. Deliberately excludes prices, chassis/VIN,
   TIN, customer contact number and photos. */
function portalDataForVehicle(v){
  var hist=S.jobs.filter(function(j){return j.vehicleId===v.id||(j.plate||'').toUpperCase()===(v.plate||'').toUpperCase();})
    .filter(function(j){return j.stage==='Released'||j.stage==='Final Billing';})
    .sort(function(a,b){return (b.billedAt||b.dateIn||'')<(a.billedAt||a.dateIn||'')?-1:1;});
  var sh=S.shop||{};
  return {
    plate:v.plate||'', year:v.year||'', make:v.make||'', model:v.model||'', variant:v.variant||'',
    owner:v.owner||'',
    nextServiceDate:v.nextServiceDate||'', nextServiceOdo:Number(v.nextServiceOdo)||0,
    history: hist.map(function(j){
      var work=(j.lines||[]).filter(function(l){return l.type==='labor';}).map(function(l){return l.desc;}).filter(Boolean).join(' · ')
        || (j.lines||[]).map(function(l){return l.desc;}).filter(Boolean).join(' · ') || 'Service';
      return { dateISO:(j.billedAt||j.dateIn||''), work:work, odo:Number(j.lastServiceOdo)||Number(j.odometer)||0 };
    }),
    shop:{ name:sh.name||'', address:sh.address||'', contact:sh.contact||'' },
    updatedAt:new Date().toISOString()
  };
}
/* Shared portal markup, rendered from a portal-data object (live for staff, or
   the fetched public doc for customers). */
function portalCardsHTML(d){
  var sh=d.shop||{};
  var due = d.nextServiceDate && d.nextServiceDate<=todayISO();
  var timeline=(d.history&&d.history.length)? d.history.map(function(h){
    return '<div class="p-item"><div class="p-date">'+esc(fmtDate(h.dateISO))+'</div>'+
      '<div class="p-work">'+esc(h.work||'Service')+'</div>'+
      '<div class="p-odo">'+num(h.odo)+' km</div></div>';
  }).join('') : '<div class="p-empty">No service records yet.</div>';
  return '<div class="portal">'+
    '<div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<div class="p-veh"><div class="p-plate">'+esc(d.plate)+'</div>'+
      '<div class="p-model">'+esc((d.year+' '+d.make+' '+d.model).trim()+(d.variant?' '+d.variant:''))+'</div>'+
      '<div class="p-owner">'+esc(d.owner)+'</div></div>'+
    '<div class="p-card '+(due?'p-due':'')+'"><div class="p-card-t">Next service</div>'+
      '<div class="p-big">'+(d.nextServiceDate? (due?'⚠ Overdue · ':'')+fmtDate(d.nextServiceDate) : 'Not scheduled')+'</div>'+
      (d.nextServiceOdo?'<div class="p-card-s">or at '+num(d.nextServiceOdo)+' km</div>':'')+'</div>'+
    '<div class="p-card"><div class="p-card-t">Service history</div>'+timeline+'</div>'+
    '<div class="p-card"><div class="p-card-t">Contact</div><div class="p-contact">'+esc(sh.name)+'<br>'+esc(sh.address)+'<br>'+esc(sh.contact)+'</div>'+
      (sh.contact?'<a class="p-btn" href="tel:'+esc(String(sh.contact).replace(/[^0-9+]/g,''))+'">Call the shop</a>':'')+'</div>'+
    '<div class="p-foot">Read-only customer portal · powered by '+esc(sh.name)+'</div>'+
  '</div>';
}
function portalHTML(){
  var v=vehicleById(portalVehicleId());
  if(!v) return '<div class="portal"><div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<div class="p-card">Vehicle not found.</div></div>';
  return portalCardsHTML(portalDataForVehicle(v));
}
/* Publish (or refresh) a vehicle's public portal snapshot to Firestore. Best
   effort: only in cloud mode with an active session; a write failure is
   swallowed so it never blocks the caller. */
function publishPortalDoc(vehicleId){
  if(typeof cloudOn!=='function' || !cloudOn()) return;
  if(typeof FB==='undefined' || !FB || !FB.ready || !FB.db || !FB.user) return;
  var v=vehicleById(vehicleId); if(!v) return;
  try { FB.db.collection('portal').doc(vehicleId).set(portalDataForVehicle(v)); } catch(e){ /* non-fatal */ }
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
  if (typeof window!=='undefined'){ window.addEventListener('hashchange', render); }
  // Cloud mode: paint the login screen immediately, load Firebase in the
  // background (deferred SDK), then wire auth — so the page never blocks on it.
  if (typeof cloudOn==='function' && cloudOn()){ cloudStart(); return; }
  await loadState();
  applyTheme((S.shop && S.shop.theme) || 'light');
  render();
}
// The app script sits at the end of <body>, so #app already exists — boot now
// (don't wait for DOMContentLoaded, which would block on the deferred SDK).
if (typeof window!=='undefined'){ boot(); }

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
    portalDataForVehicle:portalDataForVehicle, portalCardsHTML:portalCardsHTML,
    render:function(){ return render(); }, setRoute:function(v,a){ ROUTE.view=v; ROUTE.arg=a||null; },
    LOGO_URI:function(){ return LOGO_URI; }, LOGO_LOCKUP:function(){ return LOGO_LOCKUP; },
    arJobs:arJobs, jobByNo:jobByNo, vehicleByPlate:vehicleByPlate, partById:partById,
    can:can, routeAllowed:routeAllowed, setCurrentUser:function(u){ CURRENT_USER=u; },
    commissionTable:commissionTable, jobLaborCommission:jobLaborCommission, jobLaborCommissionMap:jobLaborCommissionMap, jobLaborCommissionMapAll:jobLaborCommissionMapAll, laborTotal:laborTotal,
    jobMissingFields:jobMissingFields, fmtFuel:fmtFuel, odo:odo, orSeed:orSeed,
    allocateSeriesNumber:allocateSeriesNumber, maxSeriesNo:maxSeriesNo, nextNo:nextNo,
    advancePostJob:null
  };
}
