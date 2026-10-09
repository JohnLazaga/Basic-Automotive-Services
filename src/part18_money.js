/* ============================================================================
   PART 18 — Money checks: catching payment and billing inconsistencies

   Built after the Payment checks report found overpaid jobs in Commonwealth
   and Fairview. Two Fairview jobs were overpaid by EXACTLY their discount —
   the bill was lowered after the customer had paid — and nothing recorded
   that the bill changed. This part adds:

     1. Bill-change log   any change to a job's total after money was collected
                          is logged on the job (j.billLog) and warned about.
     2. Discount report   every discount, who gave it and why; a reason is
                          now required to apply one.
     3. Cash count        the Secretary enters the cash in the drawer at Daily
                          Close; expected vs counted, short / over per day.
     4. Payment refs      a reference # for GCash / bank / card payments, and a
                          list of non-cash payments that have none.
     5. Released with balance owed.

   All of them are listed in the "Money checks" card on Reports (admin-only,
   like the rest of Reports), with a printout.
   ========================================================================== */

/* ---- 1. Bill changed after payment ---------------------------------------
   Every path that can change a bill (line items, discounts, warranty, add'l
   work, billing edits) ends in persist(), so the check runs there rather than
   in each editor: _billSeen holds each paid job's total as last seen; when
   persist() finds a different total, the change was made on this device and
   is logged against the signed-in user. Remote updates re-baseline the map
   (billBaseline) so another device's change is logged once, by that device. */
var _billSeen = {};
function billWatch(j){ return j && !jobVoided(j) && !jobCancelled(j) && jobPaid(j) > 0.009; }
function billBaseline(){
  _billSeen = {};
  ((typeof S!=='undefined' && S && S.jobs) || []).forEach(function(j){ if(billWatch(j)) _billSeen[j.id]=jobGross(j); });
}
function trackBillChanges(){
  if(typeof S==='undefined' || !S || !S.jobs) return;
  var me=(typeof CURRENT_USER!=='undefined' && CURRENT_USER) ? CURRENT_USER : null;
  S.jobs.forEach(function(j){
    if(!billWatch(j)){ delete _billSeen[j.id]; return; }
    var g=jobGross(j), was=_billSeen[j.id];
    _billSeen[j.id]=g;
    if(was===undefined || Math.abs(g-was) < 0.005) return;   // first sighting, or unchanged
    var paid=jobPaid(j);
    j.billLog=j.billLog||[];
    j.billLog.push({ at:new Date().toISOString(), by:(me&&me.uid)||'', byName:(me&&(me.name||me.username||me.email))||'',
      from:round2(was), to:round2(g), paid:round2(paid), discount:discountAmount(j) });
    if(typeof document!=='undefined' && typeof toast==='function')
      toast(j.no+': bill changed to '+peso(g)+' — '+peso(paid)+' was already collected', 'err');
  });
}
function billChanges(){
  var out=[];
  (S.jobs||[]).forEach(function(j){ (j.billLog||[]).forEach(function(c){
    out.push({ id:j.id, no:j.no, or:j.orNumber||'', plate:j.plate, at:c.at, byName:c.byName, from:c.from, to:c.to, paid:c.paid });
  }); });
  return out.sort(function(a,b){ return String(b.at||'').localeCompare(String(a.at||'')); });
}

/* ---- 2. Discounts -------------------------------------------------------- */
/* Who applied the discount, kept on the job (j.discountBy) — older jobs show —. */
function stampDiscount(j){
  var me=(typeof CURRENT_USER!=='undefined' && CURRENT_USER) ? CURRENT_USER : null;
  j.discountBy={ at:new Date().toISOString(), byName:(me&&(me.name||me.username||me.email))||'' };
}
/* A discount needs a reason from now on — an unexplained discount is the
   easiest place for money to go missing. Returns an error message or ''. */
function discountReasonMissing(d){
  var total=(Number(d.parts)||0)+(Number(d.labor)||0)+(Number(d.other)||0);
  return (total>0 && !String(d.otherNote||'').trim()) ? 'Give the reason for the discount (e.g. senior citizen, promo, suki)' : '';
}
var DISC_MONTH='', DISC_SHOW_VAT=false;
function discountRows(m){
  return billedJobs().filter(function(j){
    return !jobCancelled(j) && localDay(j.billedAt||'').slice(0,7)===m && (discountAmount(j)>0.009 || j.warranty);
  }).map(function(j){
    var d=j.discount||{}, disc=discountAmount(j), due=jobGross(j), vat=runningBill(j).vat;
    var reason=j.warranty ? 'Warranty — no charge' : String(d.otherNote||'').trim();
    /* Most jobs have the VAT discounted back out ("LESS VAT"). That is not a
       real discount, so it is split out: `beyond` is what was given ON TOP of
       the VAT, and a discount equal to the VAT is lessVat — whether or not it
       was labelled, so the months before the button are grouped too. */
    var beyond=j.warranty ? disc : round2(Math.max(0, disc-vat));
    var lessVat=!j.warranty && vat>0 && Math.abs(disc-vat)<1;
    return { id:j.id, no:j.no, or:j.orNumber||'', plate:j.plate, owner:j.owner, billedAt:j.billedAt,
      parts:Number(d.parts)||0, labor:Number(d.labor)||0, other:Number(d.other)||0, disc:disc, vat:vat, beyond:beyond, lessVat:lessVat,
      pct: (due+disc)>0 ? Math.round(disc/(due+disc)*100) : 0, reason:reason || (lessVat?'LESS VAT':''), byName:(j.discountBy&&j.discountBy.byName)||'' };
  }).sort(function(a,b){ return String(b.billedAt||'').localeCompare(String(a.billedAt||'')); });
}
function discountsCard(){
  var m=DISC_MONTH || todayISO().slice(0,7), all=discountRows(m);
  var vatRows=all.filter(function(r){ return r.lessVat; }), real=all.filter(function(r){ return !r.lessVat; });
  var rows=DISC_SHOW_VAT ? all : real;
  var beyond=round2(real.reduce(function(s,r){ return s+r.beyond; },0)), vatTot=round2(all.reduce(function(s,r){ return s+Math.min(r.disc,r.vat); },0));
  var noReason=real.filter(function(r){ return !r.reason; }).length;
  return '<div class="card"><div class="card-head"><h2>Discounts</h2><div class="row gap">'+
      monthSelect('discMonthSel', m, 'DISC_MONTH=this.value;render()')+
      '<button class="btn sm ghost" onclick="printDoc(docDiscounts())">⎙ Print</button></div></div>'+
    '<div class="muted small mb8"><b>'+real.length+' real discount'+(real.length===1?'':'s')+' · '+peso(beyond)+' given beyond VAT</b>'+
      (noReason?' · <b class="st-bad-t">'+noReason+' with no reason</b>':'')+
      ' · '+vatRows.length+' Less VAT only ('+peso(vatTot)+' VAT taken off in all)</div>'+
    '<label class="chk small mb8"><input type="checkbox"'+(DISC_SHOW_VAT?' checked':'')+' onchange="DISC_SHOW_VAT=this.checked;render()"> Show Less VAT-only jobs too</label>'+
    (rows.length ? '<div class="card pad0"><table class="tbl click sm"><thead><tr><th>Billed</th><th>JO # / OR #</th><th>Customer</th>'+
        '<th class="r">Parts</th><th class="r">Labor</th><th class="r">Other</th><th class="r">Total</th><th class="r">Beyond VAT</th><th class="r">% of bill</th><th>Reason</th><th>By</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr onclick="go(\'job\',\''+r.id+'\')"><td>'+esc(fmtDate(r.billedAt))+'</td>'+
        '<td><b>'+esc(r.no)+'</b>'+(r.or?' <span class="muted small">'+esc(r.or)+'</span>':'')+'</td>'+
        '<td>'+esc(r.owner||'')+' <span class="muted small">'+esc(r.plate)+'</span></td>'+
        '<td class="r">'+(r.parts?peso(r.parts):'—')+'</td><td class="r">'+(r.labor?peso(r.labor):'—')+'</td><td class="r">'+(r.other?peso(r.other):'—')+'</td>'+
        '<td class="r">'+peso(r.disc)+'</td><td class="r"><b>'+(r.beyond?peso(r.beyond):'—')+'</b></td><td class="r'+(r.pct>=20?' st-bad-t':'')+'">'+r.pct+'%</td>'+
        '<td>'+(r.reason?esc(r.reason):'<span class="chip due">NO REASON</span>')+'</td><td>'+esc(r.byName||'—')+'</td></tr>'; }).join('')+
      '</tbody></table></div>' : emptyState(DISC_SHOW_VAT||!all.length ? 'No discounts in '+fmtMonth(m)+'.' : 'No discounts beyond Less VAT in '+fmtMonth(m)+'.'))+
    '<p class="muted small mt8">A discount equal to the bill’s VAT counts as Less VAT and is hidden unless ticked above. Beyond VAT is what was given on top of it. '+
      '% of bill is the whole discount against the bill before discount; 20% or more is highlighted.</p></div>';
}
function docDiscounts(){
  var m=DISC_MONTH || todayISO().slice(0,7), all=discountRows(m), rows=DISC_SHOW_VAT ? all : all.filter(function(r){ return !r.lessVat; });
  var beyond=round2(all.reduce(function(s,r){ return s+r.beyond; },0));
  return docShell('Discounts '+m, docHeader('Discounts · '+fmtMonth(m))+
    '<div class="eod-stamp">Printed <b>'+esc(fmtDateTime(new Date().toISOString()))+'</b> · '+rows.length+' jobs · '+peso(beyond)+' beyond VAT'+
      (DISC_SHOW_VAT?'':' · Less VAT-only jobs not listed')+'</div>'+
    (rows.length?'<table><thead><tr><th>Billed</th><th>JO # / OR #</th><th>Customer</th><th class="r">Total</th><th class="r">Beyond VAT</th><th class="r">%</th><th>Reason</th><th>By</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr><td>'+esc(fmtDate(r.billedAt))+'</td><td>'+esc(r.no)+(r.or?' / '+esc(r.or):'')+'</td><td>'+esc(r.owner||'')+' '+esc(r.plate)+'</td>'+
        '<td class="r">'+peso(r.disc)+'</td><td class="r">'+(r.beyond?peso(r.beyond):'—')+'</td><td class="r">'+r.pct+'%</td><td>'+(r.reason?esc(r.reason):'<b>NO REASON</b>')+'</td><td>'+esc(r.byName||'—')+'</td></tr>'; }).join('')+
      '</tbody></table>':'<p>None.</p>'));
}

/* ---- 3. Daily cash count -------------------------------------------------
   One record per branch per day in `cashcounts` (id cc_<date>). Expected cash is
   computed LIVE from that day's Cash collections (net of cash refunds) plus the
   starting float, so a later payment correction also corrects the variance. */
var CASHCOUNT_SINCE = '2026-10-09';   // first full day the cash count existed
function cashCountFor(date){ return (S.cashcounts||[]).find(function(c){ return c.id==='cc_'+date; }) || null; }
function cashExpected(date, float){ var d=eodData(date, date); return round2((Number(float)||0) + (Number(d.byMethod.Cash)||0)); }
function cashCountCard(date){
  var c=cashCountFor(date), lastFloat=0;
  (S.cashcounts||[]).forEach(function(x){ if(x.date<date && (!lastFloat || x.date>lastFloat.date)) lastFloat=x; });
  var float=c ? c.float : (lastFloat ? lastFloat.float : 0);
  var exp=cashExpected(date, float), varc=c ? round2(c.counted-exp) : null;
  return '<div class="card"><h2>Cash count</h2>'+
    '<div class="grid2">'+
      field('Starting float (₱)','<input id="ccFloat" type="number" step="0.01" min="0" value="'+attr(float||0)+'">','Cash left in the drawer at opening.')+
      field('Cash counted in drawer (₱)','<input id="ccCounted" type="number" step="0.01" min="0" value="'+attr(c?c.counted:'')+'" placeholder="count at closing">')+
    '</div>'+
    field('Note','<input id="ccNote" value="'+attr((c&&c.note)||'')+'" placeholder="explain any short / over">')+
    '<button class="btn primary sm" onclick="saveCashCount(\''+date+'\')">Save count</button>'+
    '<div class="mt8">'+line2('Expected (float + cash collections)',peso(exp))+
      (c ? line2('Counted',peso(c.counted))+
        line2('<b>'+(varc<-0.009?'Short':varc>0.009?'Over':'Balanced')+'</b>','<b class="'+(Math.abs(varc)>0.009?'st-bad-t':'st-good-t')+'">'+peso(varc)+'</b>')+
        '<div class="muted small">Counted by '+esc(c.byName||'—')+' · '+esc(fmtDateTime(c.at))+'</div>'
        : '<div class="muted small">Not counted yet for this day.</div>')+'</div></div>';
}
function saveCashCount(date){
  var counted=val('ccCounted');
  if(counted===''||isNaN(Number(counted))){ toast('Enter the cash counted','err'); return; }
  var me=(typeof CURRENT_USER!=='undefined' && CURRENT_USER) ? CURRENT_USER : null;
  var rec={ id:'cc_'+date, date:date, float:round2(Number(val('ccFloat'))||0), counted:round2(Number(counted)),
    note:val('ccNote'), at:new Date().toISOString(), byName:(me&&(me.name||me.username||me.email))||'' };
  if(!Array.isArray(S.cashcounts)) S.cashcounts=[];
  var i=S.cashcounts.findIndex(function(x){ return x.id===rec.id; });
  if(i>=0) S.cashcounts[i]=rec; else S.cashcounts.push(rec);
  persist(); toast('Cash count saved'); render();
}
/* The last N days: each counted day's variance, plus days with cash taken but no count. */
function cashCountRows(days){
  var out=[], today=todayISO();
  for(var i=0;i<days;i++){
    var dt=new Date(); dt.setDate(dt.getDate()-i); var date=todayISO(dt);
    if(date>today) continue;
    var c=cashCountFor(date), cash=Number(eodData(date,date).byMethod.Cash)||0;
    if(!c && (Math.abs(cash)<0.009 || date<CASHCOUNT_SINCE)) continue;   // uncounted days only flagged once counting existed
    var exp=cashExpected(date, c?c.float:0);
    out.push({ date:date, counted:c?c.counted:null, expected:exp, variance:c?round2(c.counted-exp):null, byName:c?c.byName:'', note:c?c.note:'' });
  }
  return out;
}

/* ---- 4. Payment reference numbers ---------------------------------------- */
var PAYREF_METHODS = ['GCash','Bank transfer','Card'];
var PAYREF_SINCE = '2026-10-09';   // first full day with the field (deployed the evening of Oct 8); older payments are not flagged
function payRefRequired(method){ return method==='GCash' || method==='Bank transfer'; }
function paymentsMissingRef(){
  var out=[];
  (S.jobs||[]).forEach(function(j){ (j.payments||[]).forEach(function(p, i){
    if(Number(p.amount)<=0 || PAYREF_METHODS.indexOf(p.method)<0 || String(p.ref||'').trim()) return;
    if(localDay(p.date)<PAYREF_SINCE) return;
    out.push({ id:j.id, idx:i, no:j.no, or:j.orNumber||'', plate:j.plate, date:p.date, method:p.method, amount:p.amount });
  }); });
  return out.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
}

/* ---- 5. Released with balance owed --------------------------------------- */
function releasedOwing(){
  return releasedJobs().filter(function(j){ return !jobCancelled(j) && jobBalance(j) > 0.009; })
    .map(function(j){ return { id:j.id, no:j.no, or:j.orNumber||'', plate:j.plate, billedAt:j.billedAt, due:jobGross(j), paid:jobPaid(j), owed:jobBalance(j) }; })
    .sort(function(a,b){ return String(b.billedAt||'').localeCompare(String(a.billedAt||'')); });
}

/* ---- The Money checks card (Reports) and printout ------------------------- */
function moneyCheckData(){
  return { cash:cashCountRows(30), over:overpaidJobs(), owing:releasedOwing(), bill:billChanges(), refs:paymentsMissingRef(), corr:paymentCorrections() };
}
function mcSection(title, n, body, okMsg){
  return '<h3 class="mt8">'+title+' <span class="muted small">· '+n+'</span></h3>'+(n? body : '<div class="muted small">✓ '+okMsg+'</div>');
}
function mcTable(head, rows){ return '<div class="card pad0"><table class="tbl click sm"><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table></div>'; }
function mcRowOpen(id){ return ' onclick="go(\'job\',\''+id+'\')"'; }
function moneyChecksCard(){
  var d=moneyCheckData();
  var cashOff=d.cash.filter(function(r){ return r.variance===null || Math.abs(r.variance)>0.009; });
  return '<div class="card"><div class="card-head"><h2>Money checks</h2>'+
      '<button class="btn sm ghost" onclick="printDoc(docMoneyChecks())">⎙ Print</button></div>'+
    mcSection('Cash count — last 30 days', cashOff.length, mcTable('<th>Date</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Short / over</th><th>By</th><th>Note</th>',
      cashOff.map(function(r){ return '<tr onclick="DC_DATE=\''+r.date+'\';go(\'dailyclose\')"><td>'+esc(fmtDate(r.date))+'</td><td class="r">'+peso(r.expected)+'</td>'+
        '<td class="r">'+(r.counted===null?'<span class="chip due">NOT COUNTED</span>':peso(r.counted))+'</td>'+
        '<td class="r'+(r.variance!==null?' st-bad-t':'')+'">'+(r.variance===null?'—':'<b>'+peso(r.variance)+'</b>')+'</td><td>'+esc(r.byName||'—')+'</td><td>'+esc(r.note||'')+'</td></tr>'; }).join('')),
      'Every day with cash collections was counted and balanced.')+
    mcSection('Paid more than due', d.over.length, mcTable('<th>JO #</th><th>OR #</th><th>Plate</th><th>Billed</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Over</th>',
      d.over.map(function(r){ return '<tr'+mcRowOpen(r.id)+'><td><b>'+esc(r.no)+'</b></td><td>'+esc(r.or)+'</td><td>'+esc(r.plate)+'</td><td>'+esc(fmtDate(r.billedAt))+'</td>'+
        '<td class="r">'+peso(r.due)+'</td><td class="r">'+peso(r.paid)+'</td><td class="r st-bad-t"><b>'+peso(r.over)+'</b></td></tr>'; }).join(''))+
      '<p class="muted small">Usually cash tendered encoded instead of the amount due, or a discount applied after payment. Open the job and use <b>Correct</b>, or record a refund.</p>',
      'No job has more paid than due.')+
    mcSection('Released with balance owed', d.owing.length, mcTable('<th>JO #</th><th>OR #</th><th>Plate</th><th>Billed</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Owed</th>',
      d.owing.map(function(r){ return '<tr'+mcRowOpen(r.id)+'><td><b>'+esc(r.no)+'</b></td><td>'+esc(r.or)+'</td><td>'+esc(r.plate)+'</td><td>'+esc(fmtDate(r.billedAt))+'</td>'+
        '<td class="r">'+peso(r.due)+'</td><td class="r">'+peso(r.paid)+'</td><td class="r st-bad-t"><b>'+peso(r.owed)+'</b></td></tr>'; }).join('')),
      'No released job has money still owed.')+
    mcSection('Bill changed after payment', d.bill.length, mcTable('<th>Changed</th><th>JO # / OR #</th><th class="r">Bill was</th><th class="r">Bill now</th><th class="r">Already paid</th><th>By</th>',
      d.bill.map(function(r){ return '<tr'+mcRowOpen(r.id)+'><td>'+esc(fmtDateTime(r.at))+'</td><td><b>'+esc(r.no)+'</b>'+(r.or?' <span class="muted small">'+esc(r.or)+'</span>':'')+'</td>'+
        '<td class="r">'+peso(r.from)+'</td><td class="r"><b>'+peso(r.to)+'</b></td><td class="r">'+peso(r.paid)+'</td><td>'+esc(r.byName||'—')+'</td></tr>'; }).join('')),
      'No bill has been changed after money was collected.')+
    mcSection('GCash / bank / card payments with no reference #', d.refs.length, mcTable('<th>Paid</th><th>JO # / OR #</th><th>Method</th><th class="r">Amount</th>',
      d.refs.map(function(r){ return '<tr'+mcRowOpen(r.id)+'><td>'+esc(fmtDateTime(r.date))+'</td><td><b>'+esc(r.no)+'</b>'+(r.or?' <span class="muted small">'+esc(r.or)+'</span>':'')+'</td>'+
        '<td>'+esc(r.method)+'</td><td class="r">'+peso(r.amount)+'</td></tr>'; }).join(''))+
      '<p class="muted small">Add the reference with <b>Correct</b> on the payment, so it can be matched against the GCash / bank statement.</p>',
      'Every non-cash payment since '+fmtDate(PAYREF_SINCE)+' has a reference #.')+
    mcSection('Payment corrections', d.corr.length, mcTable('<th>Corrected</th><th>JO # / OR #</th><th>Payment of</th><th class="r">Was</th><th class="r">Now</th><th>By</th><th>Reason</th>',
      d.corr.map(function(r){ return '<tr'+mcRowOpen(r.id)+'><td>'+esc(fmtDateTime(r.at))+'</td><td><b>'+esc(r.no)+'</b>'+(r.or?' <span class="muted small">'+esc(r.or)+'</span>':'')+'</td>'+
        '<td>'+esc(fmtDate(r.payDate))+'</td><td class="r">'+peso(r.from.amount)+' <span class="muted small">'+esc(r.from.method||'')+'</span></td>'+
        '<td class="r">'+peso(r.to.amount)+' <span class="muted small">'+esc(r.to.method||'')+'</span></td><td>'+esc(r.byName||'—')+'</td><td>'+esc(r.reason)+'</td></tr>'; }).join('')),
      'No payments have been corrected.')+
  '</div>';
}
function docMoneyChecks(){
  var d=moneyCheckData();
  var cashOff=d.cash.filter(function(r){ return r.variance===null || Math.abs(r.variance)>0.009; });
  function sec(title, n, head, rows){ return '<div class="dtitle" style="font-size:12.5px;margin-top:14px">'+title+' ('+n+')</div>'+
    (n?'<table><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table>':'<p>None.</p>'); }
  return docShell('Money Checks', docHeader('Money Checks')+
    '<div class="eod-stamp">Printed <b>'+esc(fmtDateTime(new Date().toISOString()))+'</b></div>'+
    sec('Cash count — last 30 days', cashOff.length, '<th>Date</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Short / over</th><th>Note</th>',
      cashOff.map(function(r){ return '<tr><td>'+esc(fmtDate(r.date))+'</td><td class="r">'+peso(r.expected)+'</td><td class="r">'+(r.counted===null?'NOT COUNTED':peso(r.counted))+'</td>'+
        '<td class="r">'+(r.variance===null?'—':peso(r.variance))+'</td><td>'+esc(r.note||'')+'</td></tr>'; }).join(''))+
    sec('Paid more than due', d.over.length, '<th>JO #</th><th>OR #</th><th>Plate</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Over</th>',
      d.over.map(function(r){ return '<tr><td>'+esc(r.no)+'</td><td>'+esc(r.or)+'</td><td>'+esc(r.plate)+'</td><td class="r">'+peso(r.due)+'</td><td class="r">'+peso(r.paid)+'</td><td class="r">'+peso(r.over)+'</td></tr>'; }).join(''))+
    sec('Released with balance owed', d.owing.length, '<th>JO #</th><th>OR #</th><th>Plate</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Owed</th>',
      d.owing.map(function(r){ return '<tr><td>'+esc(r.no)+'</td><td>'+esc(r.or)+'</td><td>'+esc(r.plate)+'</td><td class="r">'+peso(r.due)+'</td><td class="r">'+peso(r.paid)+'</td><td class="r">'+peso(r.owed)+'</td></tr>'; }).join(''))+
    sec('Bill changed after payment', d.bill.length, '<th>Changed</th><th>JO # / OR #</th><th class="r">Was</th><th class="r">Now</th><th class="r">Paid</th><th>By</th>',
      d.bill.map(function(r){ return '<tr><td>'+esc(fmtDateTime(r.at))+'</td><td>'+esc(r.no)+(r.or?' / '+esc(r.or):'')+'</td><td class="r">'+peso(r.from)+'</td><td class="r">'+peso(r.to)+'</td><td class="r">'+peso(r.paid)+'</td><td>'+esc(r.byName||'—')+'</td></tr>'; }).join(''))+
    sec('Non-cash payments with no reference #', d.refs.length, '<th>Paid</th><th>JO # / OR #</th><th>Method</th><th class="r">Amount</th>',
      d.refs.map(function(r){ return '<tr><td>'+esc(fmtDateTime(r.date))+'</td><td>'+esc(r.no)+(r.or?' / '+esc(r.or):'')+'</td><td>'+esc(r.method)+'</td><td class="r">'+peso(r.amount)+'</td></tr>'; }).join(''))+
    sec('Payment corrections', d.corr.length, '<th>Corrected</th><th>JO # / OR #</th><th class="r">Was</th><th class="r">Now</th><th>By</th><th>Reason</th>',
      d.corr.map(function(r){ return '<tr><td>'+esc(fmtDateTime(r.at))+'</td><td>'+esc(r.no)+(r.or?' / '+esc(r.or):'')+'</td><td class="r">'+peso(r.from.amount)+' '+esc(r.from.method||'')+'</td>'+
        '<td class="r">'+peso(r.to.amount)+' '+esc(r.to.method||'')+'</td><td>'+esc(r.byName||'—')+'</td><td>'+esc(r.reason)+'</td></tr>'; }).join('')));
}
