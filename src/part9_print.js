/* ============================================================================
   PART 9 — Printable documents (return full HTML strings; testable)
   ========================================================================== */

function printCSS(){
  return '<style>'+
    '*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;color:#1D1D1F;margin:0;padding:24px;background:#fff}'+
    '.doc{max-width:760px;margin:0 auto}'+
    '.dhead{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F21717;padding-bottom:12px;margin-bottom:14px}'+
    '.dhead img{width:54px;height:54px;border-radius:12px}'+
    '.dhead .nm{font-size:20px;font-weight:800;letter-spacing:-.02em}'+
    '.dhead .sub{color:#6E6E73;font-size:12px;line-height:1.5}'+
    '.dtitle{font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:6px 0 12px;color:#CC0F0F}'+
    '.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:12.5px;margin-bottom:12px}'+
    '.meta b{display:inline-block;min-width:120px;color:#6E6E73;font-weight:600}'+
    'table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}'+
    'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E5E5EA}'+
    'th{background:#F5F5F7;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#6E6E73}'+
    '.r{text-align:right}.tot{font-weight:800}'+
    '.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:28px;font-size:12px}'+
    '.sigline{border-top:1px solid #1D1D1F;padding-top:4px;text-align:center;margin-top:40px}'+
    '.sigimg{height:50px;display:block;margin:0 auto -6px}'+
    '.copy-tag{text-align:right;font-size:11px;font-weight:700;letter-spacing:.08em;color:#CC0F0F;text-transform:uppercase}'+
    '.foot{margin-top:18px;font-size:10.5px;color:#6E6E73;text-align:center}'+
    '.pagebreak{page-break-after:always}'+
    '.notes{font-size:12px;background:#F5F5F7;border-radius:8px;padding:8px 10px;margin:8px 0}'+
    '.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}'+
    '.pcell{margin:0;border:1px solid #E5E5EA;border-radius:8px;overflow:hidden;page-break-inside:avoid}'+
    '.pcell img{width:100%;display:block;object-fit:contain;background:#F5F5F7;max-height:340px}'+
    '.pcell figcaption{font-size:11.5px;padding:4px 8px}'+
    '.pnum{font-size:10.5px;color:#6E6E73;padding:2px 8px 6px}'+
    '.checks{columns:2;font-size:12px}.checks div{margin:2px 0}'+
    '.totbox{margin-left:auto;width:300px;font-size:13px}.totbox .l2{display:flex;justify-content:space-between;padding:3px 0}'+
    '.totbox .grand{border-top:2px solid #1D1D1F;font-weight:800;font-size:15px;padding-top:6px;margin-top:4px}'+
    '@media print{body{padding:0}.doc{max-width:100%}}'+
    /* ---- PMS report: single-column meta, neat fixed value column, rows packed to save paper ---- */
    '.pms-meta{font-size:12.5px;margin-bottom:14px}'+
    '.pms-meta>div{display:flex;gap:10px;padding:3px 0;border-bottom:1px solid #F0F0F2}'+
    '.pms-meta>div span{min-width:120px;color:#6E6E73}.pms-meta>div b{color:#1D1D1F}'+
    '.pms-rpt{table-layout:fixed;margin:4px 0}.pms-rpt td:first-child{width:56%}.pms-rpt td:last-child{width:44%}.pms-rpt td{padding:3px 8px}'+
    '.pms-sec-blk .dtitle{page-break-after:avoid;margin-bottom:2px}'+       /* keep a heading with its rows, but let sections flow */
    '.pms-pgfoot{margin-top:16px;padding-top:8px;border-top:1px solid #E5E5EA;text-align:center;font-size:10.5px;color:#6E6E73}'+
  '</style>';
}
function docHeader(title){
  var sh=S.shop;
  return '<div class="dhead"><img src="'+LOGO_URI+'"/><div><div class="nm">'+esc(sh.name)+'</div>'+
    '<div class="sub">'+esc(sh.legal||'')+'<br>'+esc(sh.address)+' · '+esc(sh.contact)+
    (sh.tin?'<br>TIN '+esc(sh.tin)+(sh.vatReg?' · VAT Registered':' · Non-VAT'):'')+'</div></div></div>'+
    '<div class="dtitle">'+esc(title)+'</div>';
}
function docShell(title, body){
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title>'+printCSS()+
    '</head><body><div class="doc">'+body+'</div></body></html>';
}
function metaRows(pairs){
  return '<div class="meta">'+pairs.map(function(p){return '<div><b>'+esc(p[0])+'</b>'+(p[1]||'—')+'</div>';}).join('')+'</div>';
}
/* Two-column metadata: `left` fills the left column top-to-bottom, `right` the
   right column. Pairs are interleaved so the row-major .meta grid renders each
   list as a vertical column in the given order. */
function metaCols(left, right){
  function cell(p){ return p ? '<div><b>'+esc(p[0])+'</b>'+(p[1]||'—')+'</div>' : '<div></div>'; }
  var n=Math.max(left.length, right.length), cells='';
  for(var i=0;i<n;i++){ cells+=cell(left[i])+cell(right[i]); }
  return '<div class="meta">'+cells+'</div>';
}

/* ---- Job Order: NO PRICES, exactly 2 copies ------------------------------- */
function docJobOrder(j){
  function copy(tag){
    var lines='<table><thead><tr><th>#</th><th>Type</th><th>SKU</th><th>Description</th><th class="r">Qty</th></tr></thead><tbody>'+
      (j.lines||[]).map(function(l,i){return '<tr><td>'+(i+1)+'</td><td>'+(l.type==='part'?'Part':'Labor')+'</td><td>'+esc((l.type==='part'&&l.sku)?l.sku:'—')+'</td><td>'+esc(l.desc)+'</td><td class="r">'+num(l.qty)+'</td></tr>';}).join('')+
      '</tbody></table>';
    var cl=j.checklist&&j.checklist.created? '<div class="dtitle" style="font-size:12px;margin-top:14px">Items left in vehicle</div><div class="checks">'+
      Object.keys(j.checklist.items||{}).filter(function(k){return j.checklist.items[k];}).map(function(k){return '<div>☑ '+esc(k)+'</div>';}).join('')+'</div>'+
      (j.checklist.bodyNotes?'<div class="notes">Body: '+esc(j.checklist.bodyNotes)+'</div>':'') : '';
    return '<div class="copy-tag">'+tag+'</div>'+ docHeader('Job Order · '+j.no)+
      metaCols(
        [['Plate', esc(j.plate)],['Owner', esc(j.owner)],['Contact person', esc(j.contactPerson)],
         ['Vehicle', esc((j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:''))],['Chassis #', esc(j.chassis)],['Ingress Odo', num(j.odometer)+' km']],
        [['Date in', fmtDate(j.dateIn)],['ETD', fmtDate(j.etd)],['Service Adviser', esc(staffName(j.saId))],
         ['Mechanic', esc(mechName(j.mechanicIds))],['Bay', esc(bayName(j.bayId))],['Job hours', num(j.jobHours)],['PMS ref', esc(j.pmsRef)]] )+
      lines+
      (j.notes?'<div class="notes"><b>Service notes:</b> '+esc(j.notes)+'</div>':'')+
      '<div class="notes"><b>Inspection:</b> Fuel '+esc(fmtFuel((j.inspection||{}).fuel))+' · Lights '+esc((j.inspection||{}).lights||'None')+' · '+esc((j.inspection||{}).condition||'')+'</div>'+
      cl+
      '<div class="sig-grid"><div class="sigline">Assessed by (Senior Mechanic)<br>'+esc(staffName(j.assessedBy))+'</div>'+
        '<div class="sigline">Service Adviser<br>'+esc(staffName(j.saId))+'</div>'+
        '<div class="sigline">Customer<br>'+esc(j.owner||'')+'</div></div>'+
      '<div class="foot">This Job Order carries no prices. Pricing appears on the Post Job Report and Final Billing.</div>';
  }
  return docShell('Job Order '+j.no,
    '<div class="pagebreak">'+copy('Vehicle Copy')+'</div>'+ copy('Clipboard Copy'));
}
function printJobOrder(id){ printDoc(docJobOrder(jobById(id))); }

/* ---- Priced lines table (shared by Post Job & Billing) -------------------- */
function pricedLinesTable(j,opts){
  opts=opts||{}; var sku=!!opts.sku;
  var skuHead = sku ? '<th>SKU</th>' : '';
  var skuCell = function(l){ return sku ? '<td>'+esc((l&&l.type==='part'&&l.sku)?l.sku:'—')+'</td>' : ''; };
  return '<table><thead><tr><th>#</th><th>Type</th>'+skuHead+'<th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>'+
    (j.lines||[]).map(function(l,i){return '<tr><td>'+(i+1)+'</td><td>'+(l.type==='part'?'Part':'Labor')+'</td>'+skuCell(l)+'<td>'+esc(l.desc)+'</td>'+
      '<td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.price)+'</td><td class="r">'+peso(lineTotal(l))+'</td></tr>';}).join('')+
    (j.addlWork||[]).filter(function(a){return a.approved;}).map(function(a){return '<tr><td></td><td>Add\'l</td>'+(sku?'<td>—</td>':'')+'<td>'+esc(a.desc)+'</td><td class="r">1</td><td class="r">'+peso(a.amount)+'</td><td class="r">'+peso(a.amount)+'</td></tr>';}).join('')+
    '</tbody></table>';
}
function totalsBox(j,opts){
  opts=opts||{}; var b=runningBill(j);
  var rows='';
  rows+='<div class="l2"><span>Parts</span><span>'+peso(b.parts)+'</span></div>';
  rows+='<div class="l2"><span>Labor</span><span>'+peso(b.labor)+'</span></div>';
  if(b.addl) rows+='<div class="l2"><span>Additional work</span><span>'+peso(b.addl)+'</span></div>';
  if(b.exempt){ rows+='<div class="l2"><span>VAT-Exempt Sales</span><span>'+peso(b.vatable)+'</span></div>'; }
  else { rows+='<div class="l2"><span>VATable Sales</span><span>'+peso(b.vatable)+'</span></div>';
    rows+='<div class="l2"><span>VAT ('+(S.shop.vatRate||12)+'%)</span><span>'+peso(b.vat)+'</span></div>'; }
  if(opts.discount && b.disc){
    // Itemise the discount into Parts / Labor / Other when the job uses the
    // per-bucket model AND the buckets sum to the applied discount (i.e. it
    // wasn't capped at the subtotal). Otherwise fall back to one Discount line.
    var d=j.discount||{}, dp=discParts(j), dl=discLabor(j), doo=discOther(j);
    var hasBuckets=(d.parts!==undefined||d.labor!==undefined||d.other!==undefined);
    if(hasBuckets && round2(dp+dl+doo)===b.disc){
      if(dp) rows+='<div class="l2"><span>Less: Parts discount</span><span>−'+peso(dp)+'</span></div>';
      if(dl) rows+='<div class="l2"><span>Less: Labor discount</span><span>−'+peso(dl)+'</span></div>';
      if(doo) rows+='<div class="l2"><span>Less: Other discount'+(d.otherNote?(' — '+esc(d.otherNote)):'')+'</span><span>−'+peso(doo)+'</span></div>';
    } else {
      rows+='<div class="l2"><span>Discount</span><span>−'+peso(b.disc)+'</span></div>';
    }
  }
  var total = opts.discount ? b.gross : b.subtotal;   // discount comes off the total
  rows+='<div class="l2 grand"><span>Total Amount Due</span><span>'+peso(total)+'</span></div>';
  return '<div class="totbox">'+rows+'</div>';
}

/* ---- Post Job Report: prices + Approved for release by -------------------- */
function docPostJob(j){
  var body=docHeader('Post Job Report · '+j.no)+
    metaCols(
      [['Plate', esc(j.plate)],['Owner', esc(j.owner)],['Contact', esc(j.contactPerson+' · '+j.contactNumber)],
       ['Vehicle', esc((j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:''))],['Chassis #', esc(j.chassis)],
       ['Ingress Odo', num(j.odometer)+' km'],['Last Service Odo', j.lastServiceOdo?num(j.lastServiceOdo)+' km':'—']],
      [['Date in', fmtDate(j.dateIn)],['ETD', fmtDate(j.etd)],['Service Adviser', esc(staffName(j.saId))],
       ['Mechanic', esc(mechName(j.mechanicIds))],['Bay', esc(bayName(j.bayId))],['PMS ref', esc(j.pmsRef)]] )+
    pricedLinesTable(j,{sku:true})+ totalsBox(j,{discount:false})+
    (j.notes?'<div class="notes"><b>Service notes:</b> '+esc(j.notes)+'</div>':'')+
    '<div class="sig-grid"><div class="sigline">Checked by (Service Adviser)<br>'+esc(staffName(j.saId))+'</div>'+
      '<div class="sigline">Approved for release by (Supervisor)<br>'+esc(staffNameIfRole(j.approvedReleaseBy,'SV'))+'</div>'+
      '<div class="sigline">Customer<br>'+esc(j.owner||'')+'</div></div>'+
    '<div class="foot">Post Job Report — first document showing prices. Parts have been deducted from inventory.</div>';
  return docShell('Post Job Report '+j.no, body);
}
function printPostJob(id){ printDoc(docPostJob(jobById(id))); }

/* ---- Final Billing: BIR VAT invoice --------------------------------------- */
function docBilling(j){ return docShell('Billing '+(j.orNumber||j.no), billingBody(j)); }
/* The receipt body only (no <html> shell) — reused by the customer portal so it
   shows the exact same Final Billing document as the desktop printout. */
function billingBody(j){
  var sh=S.shop;
  return docHeader('FINAL BILLING RECEIPT · '+(j.orNumber||''))+
    metaCols(
      [['Plate', esc(j.plate)],['Owner', esc(j.owner)],['Contact', esc(j.contactPerson+' · '+j.contactNumber)],
       ['Vehicle', esc((j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:''))],['Chassis #', esc(j.chassis)],
       ['JO #', esc(j.no)]],
      [['Date', fmtDate(j.billedAt)],['TIN', esc(j.customerTin||'—')],['SI reference', esc(j.siRef||'—')],
       ['Ingress Odo', num(j.odometer)+' km'],['Last Service Odo', j.lastServiceOdo?num(j.lastServiceOdo)+' km':'—']] )+
    pricedLinesTable(j,{sku:true})+ totalsBox(j,{discount:true})+
    '<div class="sig-grid"><div class="sigline">Approved for release by (Supervisor)<br>'+esc(staffNameIfRole(j.approvedReleaseBy,'SV'))+'</div>'+
      '<div class="sigline">Payment received by (Secretary)<br>'+esc(staffNameIfRole(j.paymentReceivedBy,'Secretary'))+'</div>'+
      '<div class="sigline">Unit Received by (Customer)<br>'+esc(j.owner||'')+'</div></div>'+
    '<div class="foot">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX<br>'+
      esc(sh.name)+' · TIN '+esc(sh.tin)+' · '+esc(sh.address)+'</div>';
}
function printBilling(id){ printDoc(docBilling(jobById(id))); }

/* ---- Estimate: 2 copies --------------------------------------------------- */
function docEstimate(e){
  var ev=vehicleByPlate(e.plate); var eAddr=(e.address||(ev&&ev.address)||'');
  function copy(tag){
    var vs=vatSplit(estTotal(e),S);
    return '<div class="copy-tag">'+tag+'</div>'+docHeader('Job Estimate · '+e.no)+
      metaRows([['Plate', esc(e.plate)],['Date', fmtDate(e.date)],['Owner', esc(e.owner)],['Contact person', esc(e.contactPerson)],
        ['Contact #', esc(e.contactNumber)],['Address', esc(eAddr)],
        ['Vehicle', esc(e.year+' '+e.make+' '+e.model)],['Odometer', num(e.odometer)+' km']])+
      '<table><thead><tr><th>Type</th><th>SKU</th><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>'+
      (e.lines||[]).map(function(l){return '<tr><td>'+(l.type==='part'?'Part':'Labor')+'</td><td>'+esc((l.type==='part'&&l.sku)?l.sku:'—')+'</td><td>'+esc(l.desc)+'</td><td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.price)+'</td><td class="r">'+peso(lineTotal(l))+'</td></tr>';}).join('')+'</tbody></table>'+
      '<div class="totbox">'+(vs.exempt?'<div class="l2"><span>VAT-Exempt Sales</span><span>'+peso(vs.gross)+'</span></div>':
        '<div class="l2"><span>VATable Sales</span><span>'+peso(vs.vatable)+'</span></div><div class="l2"><span>VAT ('+(S.shop.vatRate||12)+'%)</span><span>'+peso(vs.vat)+'</span></div>')+
        '<div class="l2 grand"><span>Estimated Total</span><span>'+peso(vs.gross)+'</span></div></div>'+
      '<div class="sig-grid"><div class="sigline">Assessed by (Senior Mechanic)<br>'+esc(staffName(e.assessedBy))+'</div>'+
        '<div class="sigline">Approved (SA)<br>'+esc(staffName(e.approvedSA))+'</div>'+
        '<div class="sigline">Customer<br>'+esc(e.owner||'')+'</div></div>'+
      '<div class="foot">This is an estimate only. Final charges may vary after diagnosis.</div>';
  }
  return docShell('Estimate '+e.no, '<div class="pagebreak">'+copy("Customer's Copy")+'</div>'+copy("Shop Copy"));
}
function printEstimate(id){ printDoc(docEstimate(estById(id))); }

/* ---- Purchase Order ------------------------------------------------------- */
function docPO(po){
  var tot=po.lines.reduce(function(s,l){return s+(l.qty||0)*(l.cost||0);},0);
  var body=docHeader('Purchase Order · '+po.no)+
    metaRows([['Supplier', esc(po.supplier)],['Date', fmtDate(po.date)],['Status', esc(po.status)],['Received', po.receivedDate?fmtDate(po.receivedDate):'—']])+
    '<table><thead><tr><th>Part</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Amount</th></tr></thead><tbody>'+
    po.lines.map(function(l){return '<tr><td>'+esc(l.name)+'</td><td class="r">'+num(l.qty)+'</td><td class="r">'+peso(l.cost)+'</td><td class="r">'+peso((l.qty||0)*(l.cost||0))+'</td></tr>';}).join('')+'</tbody></table>'+
    '<div class="totbox"><div class="l2 grand"><span>Total</span><span>'+peso(tot)+'</span></div></div>'+
    (po.notes?'<div class="notes">'+esc(po.notes)+'</div>':'')+
    '<div class="sig-grid"><div class="sigline">Prepared by</div><div class="sigline">Approved by</div><div class="sigline">Received by</div></div>';
  return docShell('PO '+po.no, body);
}
function printPO(id){ printDoc(docPO(S.purchaseOrders.find(function(x){return x.id===id;}))); }

/* ---- Statement of Account ------------------------------------------------- */
function docStatement(custName){
  var ar=arJobs().filter(function(j){return (j.owner||j.plate)===custName;});
  var total=round2(ar.reduce(function(s,j){return s+jobBalance(j);},0));
  var body=docHeader('Statement of Account')+
    metaRows([['Customer', esc(custName)],['Date', fmtDate(todayISO())],['Total outstanding', peso(total)]])+
    '<table><thead><tr><th>JO #</th><th>Billed</th><th>OR #</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>'+
    ar.map(function(j){return '<tr><td>'+esc(j.no)+'</td><td>'+fmtDate(j.billedAt)+'</td><td>'+esc(j.orNumber||'—')+'</td>'+
      '<td class="r">'+peso(jobGross(j))+'</td><td class="r">'+peso(jobPaid(j))+'</td><td class="r">'+peso(jobBalance(j))+'</td></tr>';}).join('')+'</tbody></table>'+
    '<div class="totbox"><div class="l2 grand"><span>Total Amount Due</span><span>'+peso(total)+'</span></div></div>'+
    '<div class="foot">Please settle the outstanding balance at your earliest convenience. Thank you.</div>';
  return docShell('Statement — '+custName, body);
}
function printStatement(encName){ printDoc(docStatement(decodeURIComponent(encName))); }

/* ---- Payout sheet --------------------------------------------------------- */
function docPayout(){
  var jobs=jobsInProdPeriod(billedJobs());
  var byId={};
  jobs.forEach(function(j){ var cm=jobLaborCommissionMap(j,S);
    Object.keys(cm).forEach(function(id){ var s=staffById(id); if(!s) return;
      if(!byId[id]) byId[id]={name:s.name,role:s.role,jobs:0,commission:0};
      byId[id].jobs++; byId[id].commission=round2(byId[id].commission+cm[id]); }); });
  var rows=Object.keys(byId).map(function(k){var r=byId[k];
    return '<tr><td>'+esc(r.name)+' ('+esc(roleLabel(r.role))+')</td><td class="r">'+r.jobs+'</td><td class="r">'+peso(r.commission)+'</td><td class="sigline" style="margin-top:18px"></td></tr>';}).join('')
    || '<tr><td colspan="4" class="r">No commissions in this period.</td></tr>';
  var tot=Object.keys(byId).reduce(function(s,k){return s+byId[k].commission;},0);
  var body=docHeader('Commission Payout · '+esc(prodPeriodLabel()))+
    '<table><thead><tr><th>Staff</th><th class="r">Jobs</th><th class="r">Commission</th><th>Signature</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="totbox"><div class="l2 grand"><span>Total payout</span><span>'+peso(tot)+'</span></div></div>'+
    '<div class="foot">Commission = each staff member’s own rate × the job’s labor, on jobs they were assigned to. Includes only staff switched on for payout.</div>';
  return docShell('Payout sheet', body);
}
function printPayout(){ printDoc(docPayout()); }

/* Per-mechanic commission detail: each mechanic's jobs with job description,
   discounted labor and the commission earned on that job. */
function docMechCommission(){
  var jobs=jobsInProdPeriod(billedJobs());
  var byMech={};   // id -> { name, role, rows:[], labor, commission }
  jobs.forEach(function(j){
    var cm=jobLaborCommissionMap(j,S);                 // actual payout map (toggle-on)
    var lab=discountedLabor(j);
    var desc=(j.lines||[]).filter(function(l){return l.type==='labor';}).map(function(l){return l.desc;})
      .filter(Boolean).join(', ') || (j.notes||'') || 'Service';
    var veh=((j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'')).trim();
    Object.keys(cm).forEach(function(id){
      var s=staffById(id); if(!s || !isMechanicRole(s.role)) return;   // mechanics only
      if(!byMech[id]) byMech[id]={ name:s.name, role:s.role, rows:[], labor:0, commission:0 };
      byMech[id].rows.push({ no:j.no, veh:veh, plate:j.plate, desc:desc, labor:lab, comm:cm[id] });
      byMech[id].labor=round2(byMech[id].labor+lab);
      byMech[id].commission=round2(byMech[id].commission+cm[id]);
    });
  });
  var ids=Object.keys(byMech).sort(function(a,b){
    var A=byMech[a], B=byMech[b];
    return kpiRoleRank(A.role)-kpiRoleRank(B.role) || String(A.name).localeCompare(String(B.name));
  });
  var grand=0;
  var blocks=ids.map(function(id){
    var m=byMech[id]; grand=round2(grand+m.commission);
    var rows=m.rows.map(function(r){
      return '<tr><td>'+esc(r.no)+'</td><td>'+esc(r.plate)+(r.veh?' · '+esc(r.veh):'')+'</td><td>'+esc(r.desc)+'</td>'+
        '<td class="r">'+peso(r.labor)+'</td><td class="r">'+peso(r.comm)+'</td></tr>';
    }).join('');
    return '<div class="dtitle" style="margin-top:16px">'+esc(m.name)+' · '+esc(roleLabel(m.role))+'</div>'+
      '<table><thead><tr><th>JO #</th><th>Vehicle</th><th>Job description</th><th class="r">Labor (discounted)</th><th class="r">Commission</th></tr></thead>'+
      '<tbody>'+rows+
      '<tr class="tot"><td></td><td></td><td class="r">Subtotal</td><td class="r">'+peso(m.labor)+'</td><td class="r">'+peso(m.commission)+'</td></tr>'+
      '</tbody></table>';
  }).join('') || '<p class="r">No mechanic commissions in this period.</p>';
  var body=docHeader('Mechanic Commission Detail · '+esc(prodPeriodLabel()))+ blocks+
    '<div class="totbox"><div class="l2 grand"><span>Total mechanic commission</span><span>'+peso(grand)+'</span></div></div>'+
    '<div class="foot">Commission = the shop rate × the job’s labor (net of any labor discount), split evenly among the mechanics assigned. Includes only mechanics switched on for payout.</div>';
  return docShell('Mechanic commission detail', body);
}
function printMechCommission(){ printDoc(docMechCommission()); }

/* ---- Daily Close report --------------------------------------------------- */
function docDailyClose(){
  var date=DC_DATE||todayISO();
  var txns=[]; S.jobs.forEach(function(j){ (j.payments||[]).forEach(function(p){ if(localDay(p.date)===date) txns.push({job:j,p:p}); }); });
  var byMethod={}; txns.forEach(function(t){ byMethod[t.p.method]=round2((byMethod[t.p.method]||0)+t.p.amount); });
  var collections=round2(txns.reduce(function(s,t){return s+t.p.amount;},0));
  var billed=S.jobs.filter(function(j){return localDay(j.billedAt)===date;});
  var net=round2(billed.reduce(function(s,j){return s+jobNet(j);},0));   // VATable base (ex-VAT)
  var vs=vatSplit(net,S);
  var body=docHeader('End-of-Day Report · '+fmtDate(date))+
    '<div class="totbox" style="width:340px;margin:0 0 14px"><div class="l2"><span>Net sales (billed)</span><span>'+peso(net)+'</span></div>'+
    (vs.exempt?'<div class="l2"><span>VAT-Exempt</span><span>'+peso(vs.gross)+'</span></div>':'<div class="l2"><span>VATable</span><span>'+peso(vs.vatable)+'</span></div><div class="l2"><span>Output VAT</span><span>'+peso(vs.vat)+'</span></div>')+
    '<div class="l2 grand"><span>Collections</span><span>'+peso(collections)+'</span></div></div>'+
    '<div class="dtitle" style="font-size:12px">Collections by method</div><table><tbody>'+
    Object.keys(byMethod).map(function(m){return '<tr><td>'+esc(m)+'</td><td class="r">'+peso(byMethod[m])+'</td></tr>';}).join('')+'</tbody></table>'+
    '<div class="dtitle" style="font-size:12px">Transactions</div><table><thead><tr><th>JO #</th><th>Customer</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+
    txns.map(function(t){return '<tr><td>'+esc(t.job.no)+'</td><td>'+esc(t.job.owner)+'</td><td>'+esc(t.p.method)+'</td><td class="r">'+peso(t.p.amount)+'</td></tr>';}).join('')+'</tbody></table>'+
    '<div class="sig-grid"><div class="sigline">Cashier</div><div class="sigline">Service Manager</div><div class="sigline">Verified by</div></div>';
  return docShell('EOD '+date, body);
}
function printDailyClose(){ printDoc(docDailyClose()); }

/* ---- QR sticker (1.5in × 3in label stock) --------------------------------- */
/* Self-contained doc sized to one physical label — NOT docShell (that's A4 page
   furniture). @page fixes the sheet at exactly 1.5×3in (38.1×76.2mm) with no page
   margin, so the printer treats one label as one page. The 5mm safe margin all
   sides is inner padding on the box, keeping every mark off the label edge (no
   printer can ink to the edge anyway). Content area = 28.1×66.2mm; the QR is
   maxed to fill that width (~27mm) — width is the hard limit, so it can't grow
   further without eating into the 5mm margin.
   PRINTING: pick the label as the paper size and set the dialog's Margins to
   "None" (or "Default") so the browser honours @page instead of adding its own. */
function docQRSticker(v){
  var url=portalLink(v.id);
  var css='<style>'+
    '@page{size:38.1mm 76.2mm;margin:0}'+                 /* 1.5in × 3in, no page margin */
    '*{box-sizing:border-box}'+
    'html,body{margin:0;padding:0;width:38.1mm;height:76.2mm}'+
    "body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}"+
    '.sticker{width:38.1mm;height:76.2mm;padding:5mm;display:flex;flex-direction:column;align-items:center;'+
      'justify-content:center;text-align:center;overflow:hidden}'+   /* 5mm safe margin all sides */
    '.sticker img.logo{width:8mm;height:8mm;border-radius:1.4mm;display:block}'+
    '.sticker .nm{font-weight:800;font-size:8.5px;line-height:1.1;margin:1.2mm 0 .3mm;max-width:100%}'+
    '.sticker .tag{font-size:6.5px;letter-spacing:.02em;color:#6E6E73;text-transform:uppercase}'+
    '.sticker .qr{margin:1.6mm 0 1.4mm}'+
    '.sticker .qr img,.sticker .qr canvas{display:block;width:27mm;height:27mm}'+   /* fill content width */
    '.sticker .plate{font-weight:800;font-size:13px;letter-spacing:.02em}'+
  '</style>';
  var body='<div class="sticker">'+
    '<img class="logo" src="'+LOGO_URI_PRINT+'"/>'+
    '<div class="nm">'+esc(S.shop.name)+'</div>'+
    '<div class="tag">Scan for service history</div>'+
    '<div class="qr" id="stickerQR"></div>'+
    '<div class="plate">'+esc(v.plate)+'</div></div>'+
    /* Render at ~300dpi (320px) so the CSS 27mm box is a crisp downscale, not a blur. */
    '<script src="'+QR_LIB_URL+'" onload="new QRCode(document.getElementById(\'stickerQR\'),{text:\''+url+'\',width:320,height:320})"></script>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>QR · '+esc(v.plate)+'</title>'+css+'</head><body>'+body+'</body></html>';
}
function printQRSticker(id){ printDoc(docQRSticker(vehicleById(id))); }

/* ---- Job photos (printable contact sheet) --------------------------------- */
function docPhotos(j){
  var photos=(j.photos||[]);
  var veh=(j.year+' '+j.make+' '+j.model).trim()+(j.variant?' '+j.variant:'');
  var grid = photos.length
    ? '<div class="pgrid">'+photos.map(function(p,i){
        var src=p.url||p.data||'';
        return '<figure class="pcell"><img src="'+src+'"/>'+
          (p.caption?'<figcaption>'+esc(p.caption)+'</figcaption>':'')+
          '<div class="pnum">Photo '+(i+1)+(p.ts?' · '+esc(fmtDateTime(p.ts)):'')+'</div></figure>';
      }).join('')+'</div>'
    : '<p>No photos attached.</p>';
  var body = docHeader('Vehicle Photos · '+j.no)+
    metaCols(
      [['Plate',esc(j.plate)],['Owner',esc(j.owner)],['Vehicle',esc(veh)]],
      [['JO #',esc(j.no)],['Date in',fmtDate(j.dateIn)],['Photos',String(photos.length)]] )+
    grid+
    '<div class="foot">'+esc(S.shop.name)+' · '+String(photos.length)+' photo'+(photos.length===1?'':'s')+'</div>';
  return docShell('Photos · '+j.no, body);
}
function printPhotos(id){
  var j=jobById(id); if(!j) return;
  if(!(j.photos||[]).length){ toast('No photos to print','err'); return; }
  printDoc(docPhotos(j));
}
