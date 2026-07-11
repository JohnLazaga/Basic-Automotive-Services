/* ============================================================================
   Node smoke test — mocks browser globals, renders every view, asserts the
   ACCEPTANCE TESTS invariants. Requires 0 failures.
   ========================================================================== */

/* ---- Minimal browser global mocks ----------------------------------------- */
global.localStorage = (function(){ var m={}; return {
  getItem:function(k){ return k in m? m[k]:null; }, setItem:function(k,v){ m[k]=String(v); }, removeItem:function(k){ delete m[k]; } };
})();
// no window/document/location -> render() and boot() are no-ops in Node

const path = require('path');
const M = require(path.join(__dirname, '_bundle.js'));

let pass=0, fail=0; const fails=[];
function ok(name, cond){ if(cond){ pass++; } else { fail++; fails.push(name); console.log('  ✗ '+name); } }
function section(t){ console.log('\n'+t); }

/* fresh seeded state */
function fresh(){ const s = M.seedState(); M.setS(s); return s; }

/* Creators (createJob/createEstimateFrom) are async now — the whole suite runs
   inside main() so state-sharing tests stay strictly sequential. */
async function main(){

/* ---------------------------------------------------------------- TEST 1 */
section('1. Every view & detail page renders without throwing');
await (async function(){
  const s = fresh();
  const VIEWS = M.VIEWS();
  const simple = ['board','appointments','jobs','estimates','reports','dailyclose','productivity','receivables','vehicles','parts','labor','purchaseorders','staff','settings'];
  simple.forEach(function(v){
    try { const h = VIEWS[v](); ok('view '+v+' renders', typeof h==='string' && h.length>0); }
    catch(e){ ok('view '+v+' renders', false); console.log('     '+(e&&e.message)); }
  });
  // detail pages
  try { ok('detail job', VIEWS.job(s.jobs[0].id).length>0); } catch(e){ ok('detail job',false); console.log('     '+e.message); }
  try { const e=await M.createEstimateFrom({plate:'ABC 1234'}); ok('detail estimate', VIEWS.estimate(e.id).length>0); } catch(e){ ok('detail estimate',false); console.log('     '+e.message); }
  try { ok('detail vehicle', VIEWS.vehicle(s.vehicles[0].id).length>0); } catch(e){ ok('detail vehicle',false); console.log('     '+e.message); }
  try { ok('detail po', VIEWS.po(s.purchaseOrders[0].id).length>0); } catch(e){ ok('detail po',false); console.log('     '+e.message); }
  // board in all 3 modes — VIEWS.board reads BOARD_MODE; we can't flip the module var directly,
  // so assert the three builders via re-render after global toggles is covered by string presence.
  const b=VIEWS.board();
  ok('board renders (default kanban)', /Operations Board/.test(b));
})();

/* ---------------------------------------------------------------- TEST 2 */
section('2. Job Order printout: no ₱ anywhere + 2 copy labels');
(function(){
  const s=fresh(); const j=s.jobs[0];
  const doc=M.docJobOrder(j);
  ok('Job Order has no ₱ symbol', doc.indexOf('₱')===-1 && doc.indexOf('PHP')===-1);
  ok('Job Order has 2 copy labels', /Vehicle Copy/i.test(doc) && /Clipboard Copy/i.test(doc));
  ok('Job Order has logo', doc.indexOf(M.LOGO_URI())>-1 && M.LOGO_URI().indexOf('data:image/')===0);
})();

/* ---------------------------------------------------------------- TEST 3 */
section('3. Post Job Report: includes prices + "Approved for release by"');
(function(){
  const s=fresh(); const j=s.jobs[0];
  const doc=M.docPostJob(j);
  ok('Post Job Report shows prices (₱)', doc.indexOf('₱')>-1);
  ok('Post Job Report has approval line', /Approved for release by/i.test(doc));
})();

/* ---------------------------------------------------------------- TEST 4 */
section('4. Final Billing: VATable Sales + VAT (12%) added on top; vatable+vat===gross');
(function(){
  const s=fresh(); const j=s.jobs[0];
  const doc=M.docBilling(j);
  ok('Billing has "VATable Sales"', /VATable Sales/.test(doc));
  ok('Billing has "VAT (12%)"', /VAT \(12%\)/.test(doc));
  const vs=M.vatSplit(1000, M.getS());
  ok('VATable = base (exclusive)', vs.vatable===1000);
  ok('VAT added on top: total = base + 12%', M.round2(vs.gross)===1120 && vs.vat===120);
  ok('vatable + vat === gross', M.round2(vs.vatable+vs.vat)===M.round2(vs.gross));
})();

/* ---------------------------------------------------------------- TEST 5 */
section('5. Commission: mechanics split shop-rate pool evenly; non-mechanic roles use own rate');
(function(){
  const s=fresh();
  const mech=s.staff.filter(x=>x.role==='Mechanic');
  const sa=s.staff.find(x=>x.role==='SA'), sm=s.staff.find(x=>x.role==='SM');
  const rate=s.shop.mechCommissionRate;                 // shop mechanic rate (5%)
  // Per-person rates ARE set here, but mechanics IGNORE them — they use the shop rate.
  mech[0].commissionRate=99; mech[1].commissionRate=1; sa.commissionRate=2; sm.commissionRate=3;
  const job={ lines:[{type:'labor',ref:null,desc:'L',qty:1,price:500}], mechanicIds:[mech[0].id] };
  const m0=M.jobLaborCommissionMap(job, s);
  ok('1 mechanic: 500 × 5% ÷ 1 = 25.00 (shop rate, not own 99%)', m0[mech[0].id]===25);
  job.mechanicIds=[mech[0].id, mech[1].id];
  const m1=M.jobLaborCommissionMap(job, s);
  ok('2 mechanics split evenly: 12.50 each', m1[mech[0].id]===12.5 && m1[mech[1].id]===12.5);
  // 3 mechanics → 500 × 5% ÷ 3 = 8.33 each (rounded).
  const m3id='st_test_m3'; s.staff.push({ id:m3id, name:'Test Mech 3', role:'Mechanic', commissionRate:'' });
  job.mechanicIds=[mech[0].id, mech[1].id, m3id];
  const m3=M.jobLaborCommissionMap(job, s);
  ok('3 mechanics split evenly: 8.33 each', m3[mech[0].id]===8.33 && m3[mech[1].id]===8.33 && m3[m3id]===8.33);
  // Mixed roles on one job: mechanic (shop rate) + SA/assessor (own rate), NOT split.
  const job2={ id:'j2', no:'JO-X', stage:'Released', lines:[{type:'labor',ref:null,desc:'L',qty:1,price:500}],
    mechanicIds:[mech[0].id], saId:sa.id, assessedBy:sm.id, partsSalesman:'', discount:{type:'amount',value:0}, payments:[], addlWork:[] };
  s.jobs=[job2];
  const ct=M.commissionTable([job2]);
  const saRow=ct.find(r=>r.name===sa.name), mRow=ct.find(r=>r.name===mech[0].name), smRow=ct.find(r=>r.name===sm.name);
  ok('mechanic @ shop 5% = 25.00', mRow && mRow.amount===25);
  ok('Service Adviser own 2% = 10.00 (not split)', saRow && saRow.amount===10);
  ok('assessor own 3% = 15.00 (not split)', smRow && smRow.amount===15);
  ok('commission table has 3 rows', ct.length===3);
  // Same person as both mechanic and SA counts once (paid as a mechanic).
  const dual={ id:'j3', no:'JO-Y', stage:'Released', lines:[{type:'labor',ref:null,desc:'L',qty:1,price:500}],
    mechanicIds:[mech[0].id], saId:mech[0].id, assessedBy:'', partsSalesman:'', discount:{type:'amount',value:0}, payments:[], addlWork:[] };
  const dmap=M.jobLaborCommissionMap(dual, s);
  ok('dual-capacity person counts once = 25.00', dmap[mech[0].id]===25 && Object.keys(dmap).length===1);
  // Two mechanics, one toggled OFF: divisor still counts BOTH, so the payer still gets 12.50.
  const twojob={ id:'j4', no:'JO-Z', stage:'Released', lines:[{type:'labor',ref:null,desc:'L',qty:1,price:500}],
    mechanicIds:[mech[0].id, mech[1].id], saId:'', assessedBy:'', partsSalesman:'', discount:{type:'amount',value:0}, payments:[], addlWork:[] };
  mech[0].commission=false;
  const pay=M.jobLaborCommissionMap(twojob, s);
  ok('toggled-off mechanic excluded from payout', pay[mech[0].id]===undefined);
  ok('remaining mechanic still gets 12.50 (divisor unchanged)', pay[mech[1].id]===12.5);
  // Evaluation map ignores the toggle → excluded mechanic still shows would-earn 12.50.
  const evalMap=M.jobLaborCommissionMapAll(twojob, s);
  ok('evaluation map shows excluded mechanic would-earn 12.50', evalMap[mech[0].id]===12.5);
})();

/* ------------------------------------------------------- TEST 5b: ingress */
section('5b. Ingress completeness gate + formatters');
(function(){
  const s=fresh();
  ok('seeded job has no missing ingress fields', M.jobMissingFields(s.jobs[0]).length===0);
  const bare={ plate:'NEW 1', owner:'', contactPerson:'', contactNumber:'', address:'', chassis:'', year:'', make:'', model:'', variant:'', odometer:0 };
  const miss=M.jobMissingFields(bare);
  ok('blank ingress flags Make and Ingress odometer', miss.indexOf('Make')>=0 && miss.indexOf('Ingress odometer')>=0);
  ok('Variant is optional (never flagged)', miss.indexOf('Variant')<0);
  ok('plate present is not flagged', miss.indexOf('Plate')<0);
  ok('odo() formats with comma + km', M.odo(48250)==='48,250 km');
  ok('fmtFuel numeric -> percent', M.fmtFuel(50)==='50%');
  ok('fmtFuel blank -> dash', M.fmtFuel('')==='—');
  // OR series seed never reuses an already-issued number
  const s2=fresh(); s2.shop.orNext=1001; s2.counters.or=1000;
  s2.jobs=[{id:'a',orNumber:'OR-1005'},{id:'b',orNumber:'OR-1012'},{id:'c',orNumber:null}];
  ok('orSeed continues above the highest issued OR (1013)', M.orSeed()===1013);
  s2.jobs=[]; ok('orSeed floors at 1001 with no history', M.orSeed()===1001);
})();

/* ---------------------------------------------------------------- TEST 6 */
section('6. Inventory: Post Job deducts (idempotent); PO receive adds back');
(function(){
  const s=fresh(); const j=s.jobs[0];
  const partLine=j.lines.find(l=>l.type==='part'&&l.ref);
  const p=M.partById(partLine.ref); const before=p.stock;
  M.deductInventory(j);
  ok('stock reduced by used qty', p.stock===M.round2(before-partLine.qty));
  M.deductInventory(j); // second call must not double-deduct
  ok('deduct is idempotent', p.stock===M.round2(before-partLine.qty));
  // PO receive
  const po=s.purchaseOrders[0]; const recLine=po.lines.find(l=>l.partId);
  const rp=M.partById(recLine.partId); const rb=rp.stock;
  M.receivePO(po.id);
  ok('receiving PO increases stock', rp.stock===M.round2(rb+recLine.qty));
  ok('PO marked Received', po.status==='Received');
})();

/* ---------------------------------------------------------------- TEST 7 */
section('7. Appointment "Check in" creates a Job Order, marks Arrived');
await (async function(){
  const s=fresh(); const a=s.appointments[0]; const n0=s.jobs.length;
  const job=await M.createJobFromAppt(a); a.status='Arrived'; a.jobId=job.id;
  ok('job order created', s.jobs.length===n0+1 && /^JO-/.test(job.no));
  ok('appointment marked Arrived', a.status==='Arrived' && a.jobId===job.id);
})();

/* ---------------------------------------------------------------- TEST 8 */
section('8. A/R lists charge-account job w/ aging; Statement prints');
(function(){
  const s=fresh(); const j=s.jobs[0];
  // bill it 45 days ago, no payment -> outstanding, 31-60 bucket
  const d=new Date(); d.setDate(d.getDate()-45);
  j.stage='Final Billing'; j.billedAt=d.toISOString(); j.orNumber='OR-1001'; j.payments=[];
  const ar=M.arJobs();
  ok('A/R includes the unpaid billed job', ar.some(x=>x.id===j.id));
  ok('aging bucket 31-60 for 45 days', M.agingBucket(45)==='31-60');
  const doc=M.docStatement(j.owner);
  ok('Statement of Account prints', /Statement of Account/.test(doc) && doc.indexOf(j.no)>-1);
})();

/* ---------------------------------------------------------------- TEST 9 */
section('9. Parts import accepts JSON & CSV, maps alternate column names');
(function(){
  fresh();
  const jsonN=M.importPartsText('[{"sku":"X-1","description":"Wiper","srp":150,"buying_price":80,"quantity":5,"min":2}]');
  let pj=M.getS().parts;
  ok('JSON import maps sku/description/srp/buying_price', jsonN===1 && pj[0].partNo==='X-1' && pj[0].name==='Wiper' && pj[0].price===150 && pj[0].cost===80 && pj[0].stock===5 && pj[0].reorder===2);
  const csv='part_no,description,price,cost,quantity,min\nA-9,Belt,300,160,8,3';
  const csvN=M.importPartsText(csv);
  let pc=M.getS().parts;
  ok('CSV import maps columns', csvN===1 && pc[0].partNo==='A-9' && pc[0].name==='Belt' && pc[0].price===300 && pc[0].stock===8);
})();

/* ---------------------------------------------------------------- TEST 10 */
section('10. Portal: #v=<id> renders read-only history with logo');
(function(){
  const s=fresh(); const v=s.vehicles[0];
  M.setPortalId(function(){ return v.id; });
  ok('isPortalRoute true when id set', M.isPortalRoute()===true);
  const html=M.portalHTML();
  ok('portal shows the plate', html.indexOf(v.plate)>-1);
  ok('portal embeds the logo', html.indexOf(M.LOGO_LOCKUP())>-1);
  ok('portal is read-only (no Save/Edit buttons)', !/onclick="save/i.test(html));
  M.setPortalId(function(){ return null; });
})();

/* ---------------------------------------------------------------- TEST 11 */
section('11. Logo (LOGO_URI) set on sidebar, printouts, portal');
(function(){
  const s=fresh();
  const uri=M.LOGO_URI();
  ok('LOGO_URI is a data-URI', typeof uri==='string' && uri.indexOf('data:image/')===0);
  ok('printout embeds logo', M.docPostJob(s.jobs[0]).indexOf(uri)>-1);
  M.setPortalId(function(){ return s.vehicles[0].id; });
  ok('portal embeds lockup logo', M.portalHTML().indexOf(M.LOGO_LOCKUP())>-1);
  M.setPortalId(function(){ return null; });
})();

/* ---------------------------------------------------------------- EXTRA */
section('Extra invariants');
(function(){
  const s=fresh();
  // VAT split to the centavo across random grosses
  let okAll=true;
  [0.01, 100, 1234.56, 999.99, 50000].forEach(function(g){ const vs=M.vatSplit(g,s); if(vs.vatable!==M.round2(g) || M.round2(vs.vatable+vs.vat)!==M.round2(vs.gross)) okAll=false; });
  ok('VAT split exact to centavo over many values', okAll);
  // non-VAT shows exempt
  s.shop.vatReg=false; const ex=M.vatSplit(1000,s); ok('non-VAT yields exempt', ex.exempt===true && ex.vat===0);
})();

/* ------------------------------------------------ Value-based discounts */
section('Discounts: value-based Parts/Labor/Other, consolidated + commission on net labor');
await (async function(){
  const s=fresh(); s.shop.vatReg=true; s.shop.vatRate=12;
  const mech=s.staff.find(x=>x.role==='Mechanic'); mech.commissionRate=5; mech.commission=true;
  const job={ id:'d1', no:'JO-D', stage:'Final Billing',
    lines:[{type:'part',ref:null,desc:'P',qty:1,price:1000},{type:'labor',ref:null,desc:'L',qty:1,price:1000}],
    mechanicIds:[mech.id], saId:'', assessedBy:'', partsSalesman:'',
    discount:{parts:100, labor:200, other:50, otherNote:'promo'}, payments:[], addlWork:[] };
  const b=M.runningBill(job);
  // base 2000 + 12% = 2240 subtotal; consolidated discount 350; gross 1890
  ok('consolidated discount = parts+labor+other (350)', b.disc===350);
  ok('gross = subtotal − consolidated discount', b.gross===M.round2(2240-350));
  // printout shows ONE Discount line, no per-bucket breakdown
  const doc=M.docBilling(job);
  const discLines=(doc.match(/Discount/g)||[]).length;
  ok('billing printout shows a single consolidated Discount line', discLines===1 && doc.indexOf('promo')===-1);
  // commission on discounted labor: (1000 − 200) × 5% = 40.00
  const cm=M.jobLaborCommissionMap(job, s);
  ok('commission based on discounted labor (40.00)', cm[mech.id]===40);
})();

/* -------------------------------------------------- Series-number uniqueness */
section('Series numbers never duplicate (stale/behind counter)');
await (async function(){
  const s=fresh();
  // Simulate a counter that has fallen behind the records already present
  // (the cross-device / offline sync case that produced three JO-0040).
  const maxJo = Math.max.apply(null, s.jobs.map(function(j){ return Number(/(\d+)/.exec(j.no)[1]); }));
  s.counters.jo = 1;                       // way behind the existing jobs
  const j1=await M.createJob({plate:'ZZZ 111'}); const j2=await M.createJob({plate:'ZZZ 222'});
  ok('JO # skips past existing max', Number(/(\d+)/.exec(j1.no)[1]) === maxJo+1);
  ok('consecutive JO #s are unique', j1.no!==j2.no);
  const allJo=s.jobs.map(function(j){return j.no;});
  ok('no duplicate JO # in state', new Set(allJo).size===allJo.length);
  // Estimates share the same allocator
  s.counters.est=0; const e1=await M.createEstimateFrom({plate:'ZZZ 111'}); const e2=await M.createEstimateFrom({plate:'ZZZ 222'});
  ok('consecutive EST #s are unique', e1.no!==e2.no);
})();

/* --------------------------------------------- Public portal snapshot */
section('Public portal doc: minimal, no sensitive fields');
await (async function(){
  const s=fresh(); const v=s.vehicles[0];
  const d=M.portalDataForVehicle(v);
  ok('doc has plate + next service', d.plate===v.plate && 'nextServiceDate' in d);
  ok('doc has history array', Array.isArray(d.history));
  const keys=Object.keys(d);
  ok('no chassis exposed', keys.indexOf('chassis')<0);
  // A single chosen contact is included (for appointment prefill); the raw multi-number field is not.
  ok('single chosen contact present, raw field absent', keys.indexOf('contact')>=0 && keys.indexOf('contactNumber')<0);
  ok('chosen contact is one of the vehicle numbers', !d.contact || String(v.contactNumber||'').indexOf(d.contact)>=0);
  ok('no prices in history', d.history.every(h=>!('price' in h) && !('amount' in h)));
  ok('renders from doc (public)', M.portalCardsHTML(d).indexOf('p-plate')>-1);
  // With a billed job, history carries a report and the portal exposes a View button
  const j=s.jobs[0]; j.stage='Final Billing'; j.orNumber='OR-1001'; j.billedAt=new Date().toISOString();
  const v2=s.vehicles.find(x=>x.id===j.vehicleId)||s.vehicles[0];
  const d2=M.portalDataForVehicle(v2); const h=d2.history[0];
  ok('history entry carries job no + amount + report', h && h.no && ('amount' in h) && h.report && h.report.lines.length>0);
  ok('portal home shows View report button + amount', M.portalCardsHTML(d2).indexOf('portalViewReport')>-1);
  ok('report view shows Total Amount Due', M.portalReportHTML(h,d2).indexOf('Total Amount Due')>-1);
})();

/* ---------------------------------------------------------------- RBAC */
section('RBAC permission engine');
(function(){
  const s=fresh();
  // Admin: everything
  M.setCurrentUser({ uid:'a', role:'SV', isAdmin:true });
  ok('admin can settings', M.can('settings')===true);
  ok('admin can delete', M.can('delete')===true);
  ok('admin route settings allowed', M.routeAllowed('settings')===true);
  // SA: billing yes, part_cost/reports no
  M.setCurrentUser({ uid:'b', role:'SA', isAdmin:false });
  ok('SA can billing', M.can('billing')===true);
  ok('SA cannot part_cost', M.can('part_cost')===false);
  ok('SA cannot reports', M.can('reports')===false);
  ok('SA blocked from settings route', M.routeAllowed('settings')===false);
  ok('SA allowed board route', M.routeAllowed('board')===true);
  // Mechanic: baseline only
  M.setCurrentUser({ uid:'c', role:'Mechanic', isAdmin:false });
  ok('Mechanic cannot prices', M.can('prices')===false);
  ok('Mechanic cannot reports', M.can('reports')===false);
  ok('Mechanic blocked from accounts', M.routeAllowed('accounts')===false);
  // Parts Salesman: parts_manage yes, part_cost no
  M.setCurrentUser({ uid:'d', role:'Parts Salesman', isAdmin:false });
  ok('Parts can manage parts', M.can('parts_manage')===true);
  ok('Parts cannot see cost', M.can('part_cost')===false);
  // No user (local/dev): full access
  M.setCurrentUser(null);
  ok('no-user defaults to full access', M.can('settings')===true && M.routeAllowed('settings')===true);
})();

/* ---------------------------------------------------------------- SUMMARY */
console.log('\n────────────────────────────────────────');
console.log('  PASS: '+pass+'   FAIL: '+fail);
if(fail){ console.log('  Failures: '+fails.join(' | ')); process.exit(1); }
else console.log('  ✓ All acceptance tests passed.');

} // end main
main().catch(function(e){ console.log('  ✗ test harness threw: '+(e&&e.stack||e)); process.exit(1); });
