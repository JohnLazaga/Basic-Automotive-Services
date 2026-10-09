/* ============================================================================
   PART 19 — Voids & cancellations report

   Voided receipts (j.orVoid) and cancelled job orders (j.joCancel) already
   carry who, when and why, but the only place they showed was as a VOID tag
   inside the full receipt list. This card lists them on their own, with the
   money side: what was collected on the job, what was refunded, and what is
   still held — a voided receipt still holding money (Sudipen OR-1124:
   ₱40,000 on a void, never refunded) is the case to chase. "Still held" also
   feeds the Money checks card (part18).
   ========================================================================== */

function vcMoney(j){
  var col=0, ref=0;
  (j.payments||[]).forEach(function(p){ var a=Number(p.amount)||0; if(a>0) col+=a; else ref-=a; });
  return { collected:round2(col), refunded:round2(ref), held:round2(col-ref) };
}
function voidedReceipts(r){
  return (S.jobs||[]).filter(function(j){ return jobVoided(j) && inRptRange(localDay(j.orVoid.at), r||{from:'',to:''}); })
    .map(function(j){ var m=vcMoney(j);
      return { id:j.id, no:j.no, or:j.orNumber||'', owner:j.owner||'', plate:j.plate||'', billed:jobGross(j), billedAt:j.billedAt,
        at:j.orVoid.at, byName:j.orVoid.byName||'', reason:j.orVoid.reason||'', collected:m.collected, refunded:m.refunded, held:m.held }; })
    .sort(function(a,b){ return String(b.at).localeCompare(String(a.at)); });
}
function cancelledJobs(r){
  return (S.jobs||[]).filter(function(j){ return jobCancelled(j) && inRptRange(localDay(j.joCancel.at), r||{from:'',to:''}); })
    .map(function(j){ var m=vcMoney(j);
      return { id:j.id, no:j.no, owner:j.owner||'', plate:j.plate||'', dateIn:j.dateIn, at:j.joCancel.at, byName:j.joCancel.byName||'',
        reason:j.joCancel.reason||'', collected:m.collected, refunded:m.refunded, held:m.held }; })
    .sort(function(a,b){ return String(b.at).localeCompare(String(a.at)); });
}
/* Voids and cancellations still holding money — listed in Money checks too. */
function voidsHoldingMoney(r){
  return voidedReceipts(r).map(function(x){ x.kind='Voided receipt'; return x; })
    .concat(cancelledJobs(r).map(function(x){ x.kind='Cancelled JO'; return x; }))
    .filter(function(x){ return x.held>0.009; });
}
function vcByPerson(v, c){
  var m={};
  v.forEach(function(x){ var k=x.byName||'—'; m[k]=m[k]||{v:0,c:0}; m[k].v++; });
  c.forEach(function(x){ var k=x.byName||'—'; m[k]=m[k]||{v:0,c:0}; m[k].c++; });
  return Object.keys(m).map(function(k){ return { name:k, v:m[k].v, c:m[k].c }; })
    .sort(function(a,b){ return (b.v+b.c)-(a.v+a.c); });
}
function vcHeldCell(x){
  return x.held>0.009 ? '<span class="st-bad-t"><b>'+peso(x.held)+'</b></span>' : (x.collected?'<span class="muted">refunded</span>':'—');
}

function voidsCard(){
  return '<div class="card"><div class="card-head"><h2>Voids &amp; cancellations</h2>'+
      '<button class="btn sm ghost" onclick="printDoc(docVoids())">⎙ Print</button></div>'+
    rangeControls('vc')+
    '<div id="vcBody">'+voidsBodyHTML(rptRange('vc'))+'</div></div>';
}
function voidsBodyHTML(rg){
  var v=voidedReceipts(rg), c=cancelledJobs(rg), held=voidsHoldingMoney(rg), people=vcByPerson(v,c);
  var heldTot=round2(held.reduce(function(s,x){ return s+x.held; },0));
  return '<div class="muted small mb8">'+esc(rptRangeLabel(rg))+' · '+v.length+' voided receipt'+(v.length===1?'':'s')+
      ' · '+c.length+' cancelled job order'+(c.length===1?'':'s')+
      (held.length?' · <b class="st-bad-t">'+held.length+' still holding '+peso(heldTot)+'</b>':'')+'</div>'+
    mcSection('Voided receipts', v.length, mcTable('<th>Voided</th><th>OR # / JO #</th><th>Customer</th><th class="r">Billed</th><th class="r">Collected</th><th class="r">Still held</th><th>By</th><th>Reason</th>',
      v.map(function(x){ return '<tr'+mcRowOpen(x.id)+'><td>'+esc(fmtDateTime(x.at))+'</td><td><b>'+esc(x.or)+'</b> <span class="muted small">'+esc(x.no)+'</span></td>'+
        '<td>'+esc(x.owner)+' <span class="muted small">'+esc(x.plate)+'</span></td><td class="r">'+peso(x.billed)+'</td>'+
        '<td class="r">'+(x.collected?peso(x.collected):'—')+'</td><td class="r">'+vcHeldCell(x)+'</td><td>'+esc(x.byName||'—')+'</td><td>'+esc(x.reason)+'</td></tr>'; }).join(''))+
      (held.some(function(x){ return x.kind==='Voided receipt'; })?'<p class="muted small">A voided receipt still holding money: either refund it (Record refund on the job), or — if the job was re-billed — the payment belongs on the new job order.</p>':''),
      'No receipts voided.')+
    mcSection('Cancelled job orders', c.length, mcTable('<th>Cancelled</th><th>JO #</th><th>Customer</th><th>Date in</th><th class="r">Deposit / paid</th><th class="r">Still held</th><th>By</th><th>Reason</th>',
      c.map(function(x){ return '<tr'+mcRowOpen(x.id)+'><td>'+esc(fmtDateTime(x.at))+'</td><td><b>'+esc(x.no)+'</b></td>'+
        '<td>'+esc(x.owner)+' <span class="muted small">'+esc(x.plate)+'</span></td><td>'+esc(fmtDate(x.dateIn))+'</td>'+
        '<td class="r">'+(x.collected?peso(x.collected):'—')+'</td><td class="r">'+vcHeldCell(x)+'</td><td>'+esc(x.byName||'—')+'</td><td>'+esc(x.reason)+'</td></tr>'; }).join('')),
      'No job orders cancelled.')+
    (people.length ? '<h3 class="mt8">By person</h3>'+mcTable('<th>Name</th><th class="r">Voided receipts</th><th class="r">Cancelled JOs</th>',
      people.map(function(p){ return '<tr><td>'+esc(p.name)+'</td><td class="r">'+p.v+'</td><td class="r">'+p.c+'</td></tr>'; }).join('')) : '');
}
function docVoids(){
  var rg=rptRange('vc'), v=voidedReceipts(rg), c=cancelledJobs(rg), people=vcByPerson(v,c);
  function sec(title, n, head, rows){ return '<div class="dtitle" style="font-size:12.5px;margin-top:14px">'+title+' ('+n+')</div>'+
    (n?'<table><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table>':'<p>None.</p>'); }
  return docShell('Voids & Cancellations', docHeader('Voids & Cancellations · '+rptRangeLabel(rg))+
    '<div class="eod-stamp">Printed <b>'+esc(fmtDateTime(new Date().toISOString()))+'</b></div>'+
    sec('Voided receipts', v.length, '<th>Voided</th><th>OR # / JO #</th><th>Customer</th><th class="r">Billed</th><th class="r">Still held</th><th>By</th><th>Reason</th>',
      v.map(function(x){ return '<tr><td>'+esc(fmtDateTime(x.at))+'</td><td>'+esc(x.or)+' / '+esc(x.no)+'</td><td>'+esc(x.owner)+' '+esc(x.plate)+'</td>'+
        '<td class="r">'+peso(x.billed)+'</td><td class="r">'+(x.held>0.009?'<b>'+peso(x.held)+'</b>':'—')+'</td><td>'+esc(x.byName||'—')+'</td><td>'+esc(x.reason)+'</td></tr>'; }).join(''))+
    sec('Cancelled job orders', c.length, '<th>Cancelled</th><th>JO #</th><th>Customer</th><th class="r">Still held</th><th>By</th><th>Reason</th>',
      c.map(function(x){ return '<tr><td>'+esc(fmtDateTime(x.at))+'</td><td>'+esc(x.no)+'</td><td>'+esc(x.owner)+' '+esc(x.plate)+'</td>'+
        '<td class="r">'+(x.held>0.009?'<b>'+peso(x.held)+'</b>':'—')+'</td><td>'+esc(x.byName||'—')+'</td><td>'+esc(x.reason)+'</td></tr>'; }).join(''))+
    sec('By person', people.length, '<th>Name</th><th class="r">Voided receipts</th><th class="r">Cancelled JOs</th>',
      people.map(function(p){ return '<tr><td>'+esc(p.name)+'</td><td class="r">'+p.v+'</td><td class="r">'+p.c+'</td></tr>'; }).join('')));
}
