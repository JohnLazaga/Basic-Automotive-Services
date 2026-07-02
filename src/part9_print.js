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
    '.checks{columns:2;font-size:12px}.checks div{margin:2px 0}'+
    '.totbox{margin-left:auto;width:300px;font-size:13px}.totbox .l2{display:flex;justify-content:space-between;padding:3px 0}'+
    '.totbox .grand{border-top:2px solid #1D1D1F;font-weight:800;font-size:15px;padding-top:6px;margin-top:4px}'+
    '@media print{body{padding:0}.doc{max-width:100%}}'+
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
  if(opts.discount && b.disc) rows+='<div class="l2"><span>Discount</span><span>−'+peso(b.disc)+'</span></div>';
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
function docBilling(j){
  var sh=S.shop;
  var body=docHeader('FINAL BILLING RECEIPT · '+(j.orNumber||''))+
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
  return docShell('Billing '+(j.orNumber||j.no), body);
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

/* ---- Daily Close report --------------------------------------------------- */
function docDailyClose(){
  var date=DC_DATE||todayISO();
  var txns=[]; S.jobs.forEach(function(j){ (j.payments||[]).forEach(function(p){ if((p.date||'').slice(0,10)===date) txns.push({job:j,p:p}); }); });
  var byMethod={}; txns.forEach(function(t){ byMethod[t.p.method]=round2((byMethod[t.p.method]||0)+t.p.amount); });
  var collections=round2(txns.reduce(function(s,t){return s+t.p.amount;},0));
  var billed=S.jobs.filter(function(j){return (j.billedAt||'').slice(0,10)===date;});
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

/* ---- QR sticker ----------------------------------------------------------- */
function docQRSticker(v){
  var url=portalLink(v.id);
  var body='<div style="text-align:center;border:2px dashed #1D1D1F;border-radius:14px;padding:18px;max-width:320px;margin:20px auto">'+
    '<img src="'+LOGO_URI+'" style="width:44px;height:44px;border-radius:10px"/>'+
    '<div style="font-weight:800;margin:6px 0">'+esc(S.shop.name)+'</div>'+
    '<div style="font-size:13px;color:#6E6E73">Scan for service history</div>'+
    '<div id="stickerQR" style="display:flex;justify-content:center;margin:10px 0"></div>'+
    '<div style="font-weight:700">'+esc(v.plate)+'</div><code style="font-size:10px;word-break:break-all">'+esc(url)+'</code></div>'+
    '<script src="'+QR_LIB_URL+'" onload="new QRCode(document.getElementById(\'stickerQR\'),{text:\''+url+'\',width:150,height:150})"></script>';
  return docShell('QR · '+v.plate, body);
}
function printQRSticker(id){ printDoc(docQRSticker(vehicleById(id))); }
