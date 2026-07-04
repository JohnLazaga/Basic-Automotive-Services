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
      var b=runningBill(j);
      return {
        jobId:j.id, no:j.no||'', stage:j.stage||'', orNumber:j.orNumber||'',
        dateISO:(j.billedAt||j.dateIn||''), work:work,
        odo:Number(j.lastServiceOdo)||Number(j.odometer)||0,
        amount:b.gross,
        report:{
          orNumber:j.orNumber||'', jo:j.no||'', tin:j.customerTin||'', siRef:j.siRef||'',
          ingressOdo:Number(j.odometer)||0, lastOdo:Number(j.lastServiceOdo)||0,
          lines:(j.lines||[]).map(function(l){ return { type:l.type, sku:(l.type==='part'?(l.sku||''):''), desc:l.desc, qty:Number(l.qty)||0, price:Number(l.price)||0, total:lineTotal(l) }; }),
          addl:(j.addlWork||[]).filter(function(a){return a.approved;}).map(function(a){ return { desc:a.desc, amount:Number(a.amount)||0 }; }),
          vatable:b.vatable, vat:b.vat, exempt:!!b.exempt, disc:b.disc, gross:b.gross, vatRate:Number((S.shop||{}).vatRate)||12,
          supervisor:staffNameIfRole(j.approvedReleaseBy,'SV'), secretary:staffNameIfRole(j.paymentReceivedBy,'Secretary')
        }
      };
    }),
    shop:{ name:sh.name||'', address:sh.address||'', contact:sh.contact||'' },
    updatedAt:new Date().toISOString()
  };
}
/* Shared portal markup, rendered from a portal-data object (live for staff, or
   the fetched public doc for customers). */
/* A shop "contact" often lists several numbers (e.g. "(02) 8555-0100 · 0917 555
   0100"). Pick ONE dialable number for the tel: link — prefer a mobile — instead
   of concatenating every digit into a bogus number. */
function firstPhone(s){
  var parts=String(s||'').split(/[·,;\/|\n]+/).map(function(t){return t.trim();}).filter(Boolean);
  var mobile=parts.filter(function(p){ return /(^|\D)(09\d|\+?639)/.test(p); })[0];
  var pick=mobile||parts[0]||String(s||'');
  return pick.replace(/[^0-9+]/g,'');
}
var PORTAL_LAST=null;   // last-rendered portal data, for the report drill-down
function portalCardsHTML(d){
  PORTAL_LAST=d;
  var sh=d.shop||{};
  var due = d.nextServiceDate && d.nextServiceDate<=todayISO();
  var timeline=(d.history&&d.history.length)? d.history.map(function(h,i){
    return '<div class="p-item"><div class="p-item-top">'+
        '<span class="p-jo">'+esc(h.no||'')+'</span> '+
        '<span class="p-date">'+esc(fmtDate(h.dateISO))+'</span>'+
        (h.report?'<button class="p-view" onclick="portalViewReport('+i+')">View report →</button>':'')+
      '</div>'+
      '<div class="p-work">'+esc(h.work||'Service')+'</div>'+
      '<div class="p-item-foot"><span class="p-odo">'+num(h.odo)+' km</span>'+
        '<span class="p-amt">'+peso(h.amount||0)+'</span></div></div>';
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
      (sh.contact?'<a class="p-btn" href="tel:'+esc(firstPhone(sh.contact))+'">Call the shop</a>':'')+'</div>'+
    '<div class="p-foot">Read-only customer portal · powered by '+esc(sh.name)+'</div>'+
  '</div>';
}
/* Customer-facing final job report, rendered from a history entry's snapshot. */
function portalReportHTML(h, d){
  var sh=d.shop||{}; var r=h.report||{lines:[],addl:[]};
  var rowsP=(r.lines||[]).filter(function(l){return l.type==='part';});
  var rowsL=(r.lines||[]).filter(function(l){return l.type==='labor';});
  function lineRows(arr, isPart){
    return arr.map(function(l){
      return '<tr>'+(isPart?'<td>'+esc(l.sku||'—')+'</td>':'')+'<td>'+esc(l.desc)+'</td>'+
        '<td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.price)+'</td><td class="r">'+peso(l.total)+'</td></tr>';
    }).join('') || '<tr><td colspan="'+(isPart?5:4)+'" class="p-muted">—</td></tr>';
  }
  var addlRows=(r.addl||[]).map(function(a){ return '<tr><td>'+esc(a.desc)+'</td><td class="r">'+peso(a.amount)+'</td></tr>'; }).join('');
  var tot=''
    + (r.exempt? '<div class="p-l2"><span>VAT-Exempt Sales</span><span>'+peso(r.vatable)+'</span></div>'
      : '<div class="p-l2"><span>VATable Sales</span><span>'+peso(r.vatable)+'</span></div><div class="p-l2"><span>VAT ('+(r.vatRate||12)+'%)</span><span>'+peso(r.vat)+'</span></div>')
    + (r.disc? '<div class="p-l2"><span>Discount</span><span>−'+peso(r.disc)+'</span></div>':'')
    + '<div class="p-l2 p-grand"><span>Total Amount Due</span><span>'+peso(r.gross)+'</span></div>';
  function kvp(k,v){ return '<div class="p-kv"><span>'+esc(k)+'</span><span>'+esc(v)+'</span></div>'; }
  var meta='<div class="p-meta">'+
    kvp('OR #', r.orNumber||'—')+ kvp('JO #', r.jo||h.no||'—')+
    kvp('Date', fmtDate(h.dateISO))+ kvp('SI reference', r.siRef||'—')+
    kvp('Vehicle', (d.year+' '+d.make+' '+d.model).trim()+(d.variant?' '+d.variant:''))+ kvp('Plate', d.plate)+
    kvp('Ingress Odo', num(r.ingressOdo)+' km')+ kvp('Last Service Odo', r.lastOdo?num(r.lastOdo)+' km':'—')+
    (r.tin?kvp('TIN', r.tin):'')+
  '</div>';
  var sig=(r.supervisor||r.secretary)? '<div class="p-card"><div class="p-card-t">Released / received by</div>'+
    (r.supervisor?kvp('Approved for release (Supervisor)', r.supervisor):'')+
    (r.secretary?kvp('Payment received (Secretary)', r.secretary):'')+
    kvp('Unit received (Customer)', d.owner||'')+'</div>' : '';
  return '<div class="portal">'+
    '<div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<button class="p-back" onclick="portalViewHome()">‹ Back to history</button>'+
    '<div class="p-veh"><div class="p-plate">Final Billing Receipt</div>'+
      '<div class="p-model">'+esc(h.no||'')+(r.orNumber?' · OR '+esc(r.orNumber):'')+'</div>'+
      '<div class="p-owner">'+esc(d.owner||'')+'</div></div>'+
    '<div class="p-card"><div class="p-card-t">Details</div>'+meta+'</div>'+
    '<div class="p-card"><div class="p-card-t">Parts</div>'+
      '<table class="p-tbl"><thead><tr><th>SKU</th><th>Part</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>'+lineRows(rowsP,true)+'</tbody></table></div>'+
    '<div class="p-card"><div class="p-card-t">Labor</div>'+
      '<table class="p-tbl"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>'+lineRows(rowsL,false)+'</tbody></table></div>'+
    (addlRows?'<div class="p-card"><div class="p-card-t">Additional work</div><table class="p-tbl"><tbody>'+addlRows+'</tbody></table></div>':'')+
    '<div class="p-card">'+tot+'</div>'+
    sig+
    '<div class="p-foot">'+esc(sh.name)+' · '+esc(sh.address)+'<br>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX</div>'+
  '</div>';
}
function portalViewReport(i){
  if(!PORTAL_LAST||!PORTAL_LAST.history) return;
  var h=PORTAL_LAST.history[i]; if(!h||!h.report) return;
  var app=(typeof document!=='undefined')&&document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="portal-page">'+portalReportHTML(h,PORTAL_LAST)+'</div>';
  if(typeof window!=='undefined'&&window.scrollTo) window.scrollTo(0,0);
}
function portalViewHome(){
  var app=(typeof document!=='undefined')&&document.getElementById('app'); if(!app||!PORTAL_LAST) return;
  app.innerHTML='<div class="portal-page">'+portalCardsHTML(PORTAL_LAST)+'</div>';
  if(typeof window!=='undefined'&&window.scrollTo) window.scrollTo(0,0);
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
    portalDataForVehicle:portalDataForVehicle, portalCardsHTML:portalCardsHTML, portalReportHTML:portalReportHTML,
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
