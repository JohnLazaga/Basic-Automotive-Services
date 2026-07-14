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

/* Deep link from the "Add photos" QR sticker (staff-facing, NOT public): opens
   #addphoto=<jobId>. Unlike the portal, writing photos needs a signed-in staff
   session, so render() only acts on this once FB.user exists. */
function photoRouteJobId(){
  if (typeof location==='undefined') return null;
  var m=(location.hash||'').match(/#addphoto=([^&]+)/);
  return m? decodeURIComponent(m[1]) : null;
}

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
    owner:v.owner||'', contact:pickContact(v.contactNumber),
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
          supervisor:staffNameIfRole(j.approvedReleaseBy,'SV'), secretary:staffNameIfRole(j.paymentReceivedBy,'Secretary'),
        pms:(j.pms&&j.pms.report)? { values:j.pms.report.values||{}, completedAt:j.pms.report.completedAt||'', mechanic:staffName(j.pms.report.mechanicId), sigTech:j.pms.report.sigTech||'', sigClient:j.pms.report.sigClient||'' } : null
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
  return pickContact(s).replace(/[^0-9+]/g,'');
}
/* Choose a single contact number (prefer a mobile) from a field that may list
   several — returned in its original readable form. */
function pickContact(s){
  var parts=String(s||'').split(/[·,;\/|\n]+/).map(function(t){return t.trim();}).filter(Boolean);
  var mobile=parts.filter(function(p){ return /(^|\D)(09\d|\+?639)/.test(p); })[0];
  return mobile||parts[0]||'';
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
    '<button class="p-btn" onclick="portalApptForm()">📅 Make an appointment</button>'+
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
    (r.pms&&typeof portalPmsHTML==='function'?portalPmsHTML(r.pms):'')+
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
/* Customer appointment request — form + submit to the public appt_requests
   collection, which the staff app watches live. */
function portalApptForm(){
  var d=PORTAL_LAST||{}; var app=(typeof document!=='undefined')&&document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="portal-page"><div class="portal">'+
    '<div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<button class="p-back" onclick="portalViewHome()">‹ Back</button>'+
    '<div class="p-veh"><div class="p-plate">Make an appointment</div>'+
      '<div class="p-model">'+esc((d.year+' '+d.make+' '+d.model).trim()+(d.variant?' '+d.variant:''))+(d.plate?' · '+esc(d.plate):'')+'</div></div>'+
    '<div class="p-card">'+
      '<label class="p-fld"><span>Your name</span><input id="paName" value="'+attr(d.owner||'')+'"></label>'+
      '<label class="p-fld"><span>Contact number</span><input id="paContact" type="tel" value="'+attr(d.contact||'')+'" placeholder="09xx xxx xxxx"></label>'+
      '<label class="p-fld"><span>Preferred date</span><input id="paDate" type="date" value="'+attr(todayISO())+'"></label>'+
      '<label class="p-fld"><span>What do you need?</span><textarea id="paNotes" rows="3" placeholder="e.g. PMS / oil change / brake check"></textarea></label>'+
      '<button class="p-btn" onclick="portalApptSubmit()">Send request</button>'+
      '<div id="paMsg" class="p-muted" style="margin-top:8px"></div>'+
    '</div></div></div>';
  if(typeof window!=='undefined'&&window.scrollTo) window.scrollTo(0,0);
}
function portalApptSubmit(){
  var d=PORTAL_LAST||{};
  function g(id){ var e=document.getElementById(id); return e?String(e.value||'').trim():''; }
  var name=g('paName'), contact=g('paContact'), date=g('paDate'), notes=g('paNotes');
  var msg=document.getElementById('paMsg');
  if(!name||!contact){ if(msg){ msg.textContent='Please enter your name and contact number.'; msg.style.color='var(--brand)'; } return; }
  var req={ plate:d.plate||'', vehicleId:(typeof portalVehicleId==='function'?portalVehicleId():'')||'',
    vehicle:(d.year+' '+d.make+' '+d.model).trim()+(d.variant?' '+d.variant:''),
    name:name, contact:contact, preferredDate:date||'', notes:notes||'', status:'new', source:'portal', createdAt:new Date().toISOString() };
  if(typeof cloudOn==='function' && cloudOn() && typeof FB!=='undefined' && FB && FB.ready && FB.db){
    if(msg){ msg.textContent='Sending…'; msg.style.color=''; }
    bcol('appt_requests').add(req).then(function(){ portalApptDone(true); }).catch(function(){ portalApptDone(false); });
  } else {
    portalApptDone(true);   // local/preview
  }
}
function portalApptDone(ok){
  var app=(typeof document!=='undefined')&&document.getElementById('app'); if(!app) return;
  var sh=(PORTAL_LAST&&PORTAL_LAST.shop)||{};
  app.innerHTML='<div class="portal-page"><div class="portal">'+
    '<div class="p-head"><img class="p-lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/></div>'+
    '<div class="p-card" style="text-align:center">'+
      (ok? '<div class="p-big">✓ Request sent</div><p class="p-muted">Thank you! Our team will contact you shortly to confirm your appointment.</p>'
         : '<div class="p-big">Couldn’t send</div><p class="p-muted">Please call the shop to book your appointment.</p>'+
           (sh.contact?'<a class="p-btn" href="tel:'+esc(firstPhone(sh.contact))+'">Call the shop</a>':''))+
      '<button class="p-back" onclick="portalViewHome()" style="margin-top:10px">‹ Back to portal</button>'+
    '</div></div></div>';
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
  var v=vehicleById(vehicleId); if(!v) return;
  if (typeof dataLocal==='function' && dataLocal()){
    try { _postJSON(branchBase()+'/data/portal/'+encodeURIComponent(vehicleId), { data: portalDataForVehicle(v), pin: v.portalPin||'' }); } catch(e){ /* non-fatal */ }
    return;
  }
  if(typeof cloudOn!=='function' || !cloudOn()) return;
  if(typeof FB==='undefined' || !FB || !FB.ready || !FB.db || !FB.user) return;
  try {
    var pdata = portalDataForVehicle(v);
    // Carry a PIN hash (not the PIN) so the customer portal can gate client-side.
    if(v.portalPin && typeof portalHashPin==='function'){
      portalHashPin(vehicleId, v.portalPin).then(function(h){ pdata.pinHash=h; bcol('portal').doc(vehicleId).set(pdata); })
        .catch(function(){ bcol('portal').doc(vehicleId).set(pdata); });
    } else {
      bcol('portal').doc(vehicleId).set(pdata);   // no pin → no hash (open / claim)
    }
  } catch(e){ /* non-fatal */ }
}
/* Shared, always-current shop details for the portal. Written to portal/_shop so
   the customer portal reflects Settings edits without re-publishing every vehicle. */
function publishPortalShop(){
  var sh=S.shop||{};
  var payload={ name:sh.name||'', address:sh.address||'', contact:sh.contact||'', pinRequired:!!sh.portalPinRequired, updatedAt:new Date().toISOString() };
  if (typeof dataLocal==='function' && dataLocal()){
    try { _postJSON(branchBase()+'/data/portal/_shop', { data: payload }); } catch(e){ /* non-fatal */ }
    return;
  }
  if(typeof cloudOn!=='function' || !cloudOn()) return;
  if(typeof FB==='undefined' || !FB || !FB.ready || !FB.db || !FB.user) return;
  try { bcol('portal').doc('_shop').set(payload); } catch(e){ /* non-fatal */ }
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
  if (typeof startUpdateChecker==='function') startUpdateChecker();   // self-update prompt
  if (typeof installNoAutofill==='function') installNoAutofill();     // no cross-branch autofill
  if (typeof installUppercase==='function') installUppercase();       // encode everything UPPERCASE (all branches)
  // Cloud mode: paint the login screen immediately, load Firebase in the
  // background (deferred SDK), then wire auth — so the page never blocks on it.
  if (typeof dataLocal==='function' && dataLocal()){
    // Public customer QR portal (#v=<id>) resolves from the mini-PC, no sign-in.
    if (typeof isPortalRoute==='function' && isPortalRoute()){ await localLoadPublicPortal(); return; }
    await localBootStart(); return;   // staff: local login, load from mini-PC
  }
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
    arJobs:arJobs, jobByNo:jobByNo, vehicleByPlate:vehicleByPlate, vehDupe:vehDupe, partById:partById,
    can:can, routeAllowed:routeAllowed, setCurrentUser:function(u){ CURRENT_USER=u; },
    commissionTable:commissionTable, jobLaborCommission:jobLaborCommission, jobLaborCommissionMap:jobLaborCommissionMap, jobLaborCommissionMapAll:jobLaborCommissionMapAll, laborTotal:laborTotal,
    jobMissingFields:jobMissingFields, fmtFuel:fmtFuel, odo:odo, orSeed:orSeed,
    allocateSeriesNumber:allocateSeriesNumber, maxSeriesNo:maxSeriesNo, nextNo:nextNo,
    advancePostJob:null
  };
}
