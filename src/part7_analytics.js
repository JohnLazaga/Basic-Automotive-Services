/* ============================================================================
   PART 7 — Reports, Daily Close, Productivity, Receivables
   Commission logic uses jobLaborCommission() everywhere (single source).
   ========================================================================== */

/* A voided receipt is not a sale, so it is excluded everywhere money is counted
   — revenue, profit, commissions and receivables. The job itself stays on file
   and keeps its OR number so the series has no hole (see jobVoided). */
function releasedJobs(){ return S.jobs.filter(function(j){return j.stage==='Released' && !jobVoided(j);}); }
function billedJobs(){ return S.jobs.filter(function(j){return (j.stage==='Final Billing'||j.stage==='Released') && !jobVoided(j);}); }

function jobCostOfParts(j){
  return round2((j.lines||[]).reduce(function(s,l){
    if(l.type!=='part') return s;
    var unitCost = (l.netPrice!=null && l.netPrice!=='') ? Number(l.netPrice)||0 : (l.ref ? ((partById(l.ref)||{}).cost||0) : 0);
    return s + unitCost*(Number(l.qty)||0);
  },0));
}
/* ---- Profitability (VAT-exclusive) ---------------------------------------- */
/* Discounts are taken off the VAT-inclusive Total Due; convert back to ex-VAT so
   profit is measured on the same (ex-VAT) basis as revenue and cost. */
function discountExVat(job){
  var d = discountAmount(job);
  if(!S || !S.shop || !S.shop.vatReg) return d;
  var rate=(Number(S.shop.vatRate)||12)/100;
  return round2(d/(1+rate));
}
/* Ex-VAT revenue after discount (0 for a warranty comeback — full write-off). */
function jobRevenueExVat(job){ return round2(jobNet(job) - discountExVat(job)); }
/* Gross margin = ex-VAT revenue − parts cost. (Labor is sold time — no material
   cost; commission is a payout captured in net profit below.) */
function jobGrossMargin(job){ return round2(jobRevenueExVat(job) - jobCostOfParts(job)); }
/* Net profit = gross margin − labor commission paid on this job. */
function jobNetProfit(job){ return round2(jobGrossMargin(job) - jobLaborCommission(job,S).pool); }

/* ---- Reports & Analytics -------------------------------------------------- */
VIEWS.reports = function(){
  var rel=releasedJobs();
  var revenue=round2(rel.reduce(function(s,j){return s+jobGross(j);},0));   // total billed (VAT-incl) — the sales headline
  var wip=round2(S.jobs.filter(function(j){return j.stage!=='Released' && !jobCancelled(j);}).reduce(function(s,j){return s+jobGross(j);},0));
  var avg=rel.length? round2(revenue/rel.length):0;
  // Profitability (ex-VAT, consistent with the per-job Profitability panel)
  var revEx=round2(rel.reduce(function(s,j){return s+jobRevenueExVat(j);},0));
  var partsCost=round2(rel.reduce(function(s,j){return s+jobCostOfParts(j);},0));
  var gp=round2(rel.reduce(function(s,j){return s+jobGrossMargin(j);},0));
  var margin=revEx? Math.round(gp/revEx*100):0;
  var totalComm=round2(rel.reduce(function(s,j){return s+jobLaborCommission(j,S).pool;},0));
  var netProfit=round2(rel.reduce(function(s,j){return s+jobNetProfit(j);},0));

  // revenue by month
  var byMonth={};
  rel.forEach(function(j){ var m=localDay(j.billedAt||j.dateIn).slice(0,7); if(!m) return; byMonth[m]=round2((byMonth[m]||0)+jobGross(j)); });
  var months=Object.keys(byMonth).sort().slice(-6).map(function(m){ return { label:m, value:byMonth[m] }; });

  // top services & parts by revenue
  var svc={}, prt={};
  rel.forEach(function(j){ (j.lines||[]).forEach(function(l){
    var t=l.type==='part'?prt:svc; t[l.desc]=round2((t[l.desc]||0)+lineTotal(l)); }); });
  function top(o){ return Object.keys(o).map(function(k){return {label:k,value:o[k]};}).sort(function(a,b){return b.value-a.value;}).slice(0,6); }

  var invCost=round2(S.parts.reduce(function(s,p){return s+(p.cost||0)*(p.stock||0);},0));
  var invRetail=round2(S.parts.reduce(function(s,p){return s+(p.price||0)*(p.stock||0);},0));
  var low=S.parts.filter(function(p){return (p.stock||0)<=(p.reorder||0);});

  // commissions
  var comm=commissionTable(rel);

  return '<div class="page"><div class="page-head"><h1>Reports & Analytics</h1></div>'+
    '<div class="kpis">'+kpi('Revenue (released)',peso(revenue),'total billed, VAT-incl')+
      (canSeeProfit()?kpi('Net profit',peso(netProfit),'after parts cost & commission')+kpi('Margin',margin+'%','gross, ex-VAT'):'')+
      kpi('Open WIP',peso(wip))+kpi('Avg ticket',peso(avg))+'</div>'+
    '<div class="cols"><div class="colmain">'+
      (canSeeProfit()?('<div class="card"><h2>Profitability <span class="muted small">· released · ex-VAT</span></h2>'+
        line2('Revenue (ex-VAT)',peso(revEx))+line2('− Parts cost',peso(partsCost))+
        line2('Gross margin','<b>'+peso(gp)+'</b> <span class="muted small">· '+margin+'%</span>')+
        '<div class="bill-sep"></div>'+line2('− Labor commission',peso(totalComm))+
        line2('Net profit','<b class="'+(netProfit<0?'st-bad-t':'st-good-t')+'">'+peso(netProfit)+'</b>')+
        '<p class="muted small mt8">Gross margin = ex-VAT revenue − parts cost (labor is sold time). Net profit also subtracts labor commission. Warranty comebacks show ₱0 revenue against real parts cost.</p></div>'):'')+
      '<div class="card"><h2>Revenue by month</h2>'+(months.length?bars(months,peso):emptyState('No released jobs yet.'))+'</div>'+
      '<div class="grid2cards"><div class="card"><h2>Top services</h2>'+(top(svc).length?bars(top(svc),peso):emptyState('—'))+'</div>'+
        '<div class="card"><h2>Top parts</h2>'+(top(prt).length?bars(top(prt),peso):emptyState('—'))+'</div></div>'+
    '</div><div class="colside">'+
      '<div class="card"><h2>Inventory value</h2>'+line2('At cost',peso(invCost))+line2('At retail',peso(invRetail))+
        line2('Potential margin',peso(round2(invRetail-invCost)))+'<div class="bill-sep"></div>'+
        '<div class="muted small">Low-stock items: '+low.length+'</div>'+
        low.slice(0,6).map(function(p){return '<div class="l2"><span>'+esc(p.name)+'</span><span class="amber">'+p.stock+'</span></div>';}).join('')+'</div>'+
      '<div class="card"><h2>Commissions</h2>'+(comm.length?
        '<table class="tbl sm"><thead><tr><th>Staff</th><th class="r">Comm.</th></tr></thead><tbody>'+
        comm.map(function(c){return '<tr><td>'+esc(c.name)+' <span class="muted small">'+esc(c.role)+'</span></td><td class="r">'+peso(c.amount)+'</td></tr>';}).join('')+
        '</tbody></table>':emptyState('No commissions yet.'))+'</div>'+
    '</div></div>'+
    eodRangeCard()+
    orSeriesCard()+
    joSeriesCard()+
  '</div>';
};

/* ---- Sales & collections for a date range --------------------------------
   The Daily Close figures over any period, from the same eodData() aggregator,
   so a month here always reconciles against the days that make it up. */
var EOD_FROM='', EOD_TO='';
function eodRange(){
  var today=todayISO();
  return { from:EOD_FROM || today.slice(0,7)+'-01', to:EOD_TO || today };
}
function setEodRange(which, v){
  if(which==='from') EOD_FROM=v; else EOD_TO=v;
  render();
}
function eodRangePreset(p){
  var today=todayISO();
  if(p==='today'){ EOD_FROM=today; EOD_TO=today; }
  else if(p==='week'){ var dt=new Date(); var dow=(dt.getDay()+6)%7; var mon=new Date(dt); mon.setDate(dt.getDate()-dow); EOD_FROM=todayISO(mon); EOD_TO=today; }
  else if(p==='month'){ EOD_FROM=today.slice(0,7)+'-01'; EOD_TO=today; }
  render();
}
function eodRangeCard(){
  var r=eodRange();
  /* Guard a reversed range rather than silently showing nothing. */
  if(r.from>r.to) return '<div class="card"><h2>Sales &amp; collections by date range</h2>'+
    '<div class="row gap wrap mb8">'+eodRangeControls(r)+'</div>'+
    '<div class="lg-msg err">The "from" date is after the "to" date.</div></div>';
  var d=eodData(r.from, r.to);
  return '<div class="card"><div class="card-head"><h2>Sales &amp; collections by date range</h2>'+
    '<button class="btn sm ghost" onclick="printEodRange()">⎙ Print</button></div>'+
    '<div class="row gap wrap mb8">'+eodRangeControls(r)+'</div>'+
    '<div class="muted small mb8">'+esc(fmtDate(r.from))+' – '+esc(fmtDate(r.to))+'</div>'+
    '<div class="kpis">'+kpi('Collections',peso(d.collections))+kpi('Net sales (billed)',peso(d.net))+
      kpi('Output VAT',peso(d.vs.vat))+kpi('Discounts',peso(d.disc))+kpi('Transactions',d.txns.length)+'</div>'+
    '<div class="grid2cards">'+
      '<div class="card"><h2>Collections by method</h2>'+(Object.keys(d.byMethod).length?Object.keys(d.byMethod).map(function(m){return line2(m,peso(d.byMethod[m]));}).join(''):emptyState('—'))+
        (d.refunds?'<div class="muted small mt8">Net of '+peso(d.refunds)+' refunded — each line is the real movement of that tender.</div>':'')+'</div>'+
      '<div class="card"><h2>Sales mix</h2>'+line2('Parts',peso(d.partsRev))+line2('Labor',peso(d.laborRev))+
        '<div class="bill-sep"></div>'+line2('Receipts issued',String(d.receipts.length)+(d.voidCount?' ('+d.voidCount+' void)':''))+'</div>'+
    '</div>'+
    eodReceiptsCard(d, true)+'</div>';
}
function eodRangeControls(r){
  return '<input type="date" value="'+attr(r.from)+'" onchange="setEodRange(\'from\',this.value)">'+
    '<span class="muted">to</span>'+
    '<input type="date" value="'+attr(r.to)+'" onchange="setEodRange(\'to\',this.value)">'+
    '<button class="btn sm ghost" onclick="eodRangePreset(\'today\')">Today</button>'+
    '<button class="btn sm ghost" onclick="eodRangePreset(\'week\')">This week</button>'+
    '<button class="btn sm ghost" onclick="eodRangePreset(\'month\')">This month</button>';
}

/* ---- OR numbers by series (with corresponding JO #s) ---------------------- */
/* Every issued Official Receipt, ordered by its numeric series, paired with the
   Job Order it billed. Detects gaps (missing numbers) in the sequence. */
function orSeriesRows(){
  return (S.jobs||[]).filter(function(j){ return j.orNumber; }).map(function(j){
    var m=/(\d+)/.exec(String(j.orNumber));
    return { n:m?Number(m[1]):0, or:j.orNumber, jo:j.no, date:j.billedAt||j.dateIn||'',
             owner:j.owner||'', plate:j.plate||'', amount:jobGross(j), id:j.id,
             voided:jobVoided(j), voidReason:(j.orVoid&&j.orVoid.reason)||'' };
  }).sort(function(a,b){ return a.n-b.n || String(a.or).localeCompare(String(b.or)); });
}
/* Holes in a numbered series. Shared by the OR and JO cards — it only reads the
   numeric `n` of each row, so any series that parses a number can use it. Rows
   must already be sorted ascending. */
function seriesGaps(rows){
  var gaps=[];
  for (var i=1;i<rows.length;i++){
    var prev=rows[i-1].n, cur=rows[i].n;
    if (cur-prev>1){ gaps.push({ from:prev+1, to:cur-1, count:cur-prev-1 }); }
  }
  return gaps;
}
function gapNoteHTML(gaps, label, hint){
  if(!gaps.length) return '<div class="muted small">✓ No gaps — series is continuous.</div>';
  var total=gaps.reduce(function(s,g){return s+g.count;},0);
  return '<div class="muted small" style="color:var(--brand)">⚠ '+total+' missing '+esc(label)+
    ' number(s): '+gaps.map(function(g){ return g.count===1?(g.from):(g.from+'–'+g.to); }).join(', ')+'</div>'+
    (hint?'<div class="muted small">'+hint+'</div>':'');
}
var OR_Q='';
function orSeriesMatch(r){
  if(!OR_Q) return true; var q=OR_Q.toLowerCase();
  return [r.or,r.jo,r.owner,r.plate].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function orSeriesFiltered(){ return orSeriesRows().filter(orSeriesMatch); }
function orSeriesRowsHTML(){
  var rows=orSeriesFiltered();
  if(!rows.length) return '<tr><td colspan="5" class="muted center">No OR numbers match “'+esc(OR_Q)+'”.</td></tr>';
  return rows.map(function(r){
    /* A voided receipt keeps its row — that is what keeps the series gapless —
       but reads as cancelled and contributes nothing to the total. */
    return '<tr onclick="go(\'job\',\''+r.id+'\')" style="cursor:pointer"'+(r.voided?' class="void-row"':'')+'>'+
      '<td><b>'+esc(r.or)+'</b>'+(r.voided?' <span class="chip">VOID</span>':'')+'</td><td>'+esc(r.jo)+'</td>'+
      '<td>'+esc(fmtDate(r.date))+'</td>'+
      '<td>'+esc(r.owner)+(r.plate?' <span class="muted small">'+esc(r.plate)+'</span>':'')+
        (r.voided&&r.voidReason?'<div class="muted small">'+esc(r.voidReason)+'</div>':'')+'</td>'+
      '<td class="r">'+(r.voided?'<span class="muted">—</span>':peso(r.amount))+'</td></tr>';
  }).join('');
}
function orSeriesSearch(v){ OR_Q=v; var el=document.getElementById('orSeriesBody'); if(el) el.innerHTML=orSeriesRowsHTML(); }
function orSeriesCard(){
  var rows=orSeriesRows();
  if (!rows.length) return '<div class="card"><h2>OR numbers by series</h2>'+emptyState('No OR numbers issued yet.')+'</div>';
  var gaps=seriesGaps(rows);
  var gapNote = gaps.length
    ? '<div class="muted small" style="color:var(--brand)">⚠ '+gaps.reduce(function(s,g){return s+g.count;},0)+
      ' missing OR number(s): '+gaps.map(function(g){ return g.count===1?('OR-'+g.from):('OR-'+g.from+'–OR-'+g.to); }).join(', ')+'</div>'
    : '<div class="muted small">✓ No gaps — series is continuous.</div>';
  return '<div class="card"><div class="card-head"><h2>OR numbers by series</h2>'+
    '<button class="btn sm ghost" onclick="printOrSeries()">⎙ Print</button></div>'+
    '<div class="muted small mb8">'+rows.length+' receipts'+
      (rows.filter(function(r){return r.voided;}).length?' ('+rows.filter(function(r){return r.voided;}).length+' void)':'')+
      ' · '+esc(rows[0].or)+' → '+esc(rows[rows.length-1].or)+'</div>'+
    gapNote+
    '<input class="searchbox mt8" id="orSeriesSearch" value="'+attr(OR_Q)+'" oninput="orSeriesSearch(this.value)" placeholder="Search OR # / JO # / customer / plate…" autocomplete="off">'+
    '<div class="card pad0 mt8"><table class="tbl click"><thead><tr><th>OR #</th><th>JO #</th><th>Date</th><th>Sold to</th><th class="r">Amount</th></tr></thead>'+
    '<tbody id="orSeriesBody">'+orSeriesRowsHTML()+'</tbody></table></div></div>';
}
function docOrSeries(){
  var rows=orSeriesFiltered();
  var voided=rows.filter(function(r){ return r.voided; }).length;
  /* Voided receipts are listed (so the series reads as complete) but add nothing. */
  var tot=round2(rows.reduce(function(s,r){return s+(r.voided?0:r.amount);},0));
  var body=docHeader('OR Numbers by Series')+
    '<div class="meta"><div><b>Receipts</b>'+rows.length+(voided?' ('+voided+' void)':'')+'</div>'+
      '<div><b>Range</b>'+(rows.length?esc(rows[0].or)+' → '+esc(rows[rows.length-1].or):'—')+'</div></div>'+
    '<table><thead><tr><th>OR #</th><th>JO #</th><th>Date</th><th>Sold to</th><th class="r">Amount</th></tr></thead><tbody>'+
    rows.map(function(r){ return '<tr><td>'+esc(r.or)+(r.voided?' — VOID':'')+'</td><td>'+esc(r.jo)+'</td><td>'+esc(fmtDate(r.date))+'</td><td>'+esc(r.owner)+(r.voided&&r.voidReason?' ('+esc(r.voidReason)+')':'')+'</td><td class="r">'+(r.voided?'—':peso(r.amount))+'</td></tr>'; }).join('')+
    '<tr class="tot"><td></td><td></td><td></td><td class="r">Total</td><td class="r">'+peso(tot)+'</td></tr>'+
    '</tbody></table>';
  return docShell('OR numbers by series', body);
}
function printOrSeries(){ printDoc(docOrSeries()); }

/* ---- JO numbers by series ------------------------------------------------- */
/* Same audit as the OR card, for Job Order numbers. Unlike an OR, a JO number
   can also go missing because the job order was DELETED — so a hole here is not
   automatically a lost number. Both causes are worth seeing. */
/* JO numbers are zero-padded to 4 digits, so gap labels must be too — otherwise
   "JO-40" won't match the "JO-0040" on the paperwork being reconciled. */
function joNoLabel(n){ return 'JO-'+String(n).padStart(4,'0'); }
function joGapLabels(gaps){
  return gaps.map(function(g){ return g.count===1 ? joNoLabel(g.from) : (joNoLabel(g.from)+'–'+joNoLabel(g.to)); }).join(', ');
}
function joSeriesRows(){
  return (S.jobs||[]).filter(function(j){ return j && j.no; }).map(function(j){
    var m=/(\d+)/.exec(String(j.no));
    return { n:m?Number(m[1]):0, jo:j.no, or:j.orNumber||'', stage:j.stage||'',
             date:j.dateIn||'', owner:j.owner||'', plate:j.plate||'',
             amount:jobGross(j), id:j.id,
             cancelled:jobCancelled(j), cancelReason:(j.joCancel&&j.joCancel.reason)||'',
             voided:jobVoided(j) };
  }).sort(function(a,b){ return a.n-b.n || String(a.jo).localeCompare(String(b.jo)); });
}
var JOSER_Q='';
function joSeriesMatch(r){
  if(!JOSER_Q) return true; var q=JOSER_Q.toLowerCase();
  return [r.jo,r.or,r.owner,r.plate,r.stage].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function joSeriesFiltered(){ return joSeriesRows().filter(joSeriesMatch); }
function joSeriesRowsHTML(){
  var rows=joSeriesFiltered();
  if(!rows.length) return '<tr><td colspan="5" class="muted center">No JO numbers match “'+esc(JOSER_Q)+'”.</td></tr>';
  return rows.map(function(r){
    /* A cancelled job order keeps its row — that is what keeps the series
       gapless — but reads as retired and contributes no bill. */
    return '<tr onclick="go(\'job\',\''+r.id+'\')" style="cursor:pointer"'+(r.cancelled||r.voided?' class="void-row"':'')+'>'+
      '<td><b>'+esc(r.jo)+'</b>'+(r.cancelled?' <span class="chip">CANCELLED</span>':'')+'</td>'+
      '<td>'+esc(r.or||'—')+(r.voided?' <span class="chip">VOID</span>':'')+'</td>'+
      '<td>'+esc(fmtDate(r.date))+'</td>'+
      '<td>'+esc(r.owner)+(r.plate?' <span class="muted small">'+esc(r.plate)+'</span>':'')+
        (r.cancelled&&r.cancelReason?'<div class="muted small">'+esc(r.cancelReason)+'</div>':'')+'</td>'+
      '<td class="r">'+((r.cancelled||r.voided)?'<span class="muted">—</span>':peso(r.amount))+'</td></tr>';
  }).join('');
}
function joSeriesSearch(v){ JOSER_Q=v; var el=document.getElementById('joSeriesBody'); if(el) el.innerHTML=joSeriesRowsHTML(); }
function joSeriesCard(){
  var rows=joSeriesRows();
  if (!rows.length) return '<div class="card"><h2>JO numbers by series</h2>'+emptyState('No job orders yet.')+'</div>';
  var gaps=seriesGaps(rows);
  var gapNote = gaps.length
    ? '<div class="muted small" style="color:var(--brand)">⚠ '+gaps.reduce(function(s,g){return s+g.count;},0)+
      ' missing JO number(s): '+joGapLabels(gaps)+'</div>'+
      '<div class="muted small">A hole means the number was issued but its job order is gone — either deleted, or lost before it saved.</div>'
    : '<div class="muted small">✓ No gaps — series is continuous.</div>';
  return '<div class="card"><div class="card-head"><h2>JO numbers by series</h2>'+
    '<button class="btn sm ghost" onclick="printJoSeries()">⎙ Print</button></div>'+
    '<div class="muted small mb8">'+rows.length+' job orders · '+esc(rows[0].jo)+' → '+esc(rows[rows.length-1].jo)+'</div>'+
    gapNote+
    '<input class="searchbox mt8" id="joSeriesSearch" value="'+attr(JOSER_Q)+'" oninput="joSeriesSearch(this.value)" placeholder="Search JO # / OR # / customer / plate / stage…" autocomplete="off">'+
    '<div class="card pad0 mt8"><table class="tbl click"><thead><tr><th>JO #</th><th>OR #</th><th>Date in</th><th>Customer</th><th class="r">Bill</th></tr></thead>'+
    '<tbody id="joSeriesBody">'+joSeriesRowsHTML()+'</tbody></table></div></div>';
}
function docJoSeries(){
  var rows=joSeriesFiltered();
  var tot=round2(rows.reduce(function(s,r){return s+r.amount;},0));
  var gaps=seriesGaps(joSeriesRows());
  var body=docHeader('JO Numbers by Series')+
    '<div class="meta"><div><b>Job orders</b>'+rows.length+'</div>'+
      '<div><b>Range</b>'+(rows.length?esc(rows[0].jo)+' → '+esc(rows[rows.length-1].jo):'—')+'</div>'+
      '<div><b>Missing</b>'+(gaps.length?gaps.reduce(function(s,g){return s+g.count;},0)+' ('+
        esc(joGapLabels(gaps))+')':'none')+'</div></div>'+
    '<table><thead><tr><th>JO #</th><th>OR #</th><th>Date in</th><th>Customer</th><th class="r">Bill</th></tr></thead><tbody>'+
    rows.map(function(r){ return '<tr><td>'+esc(r.jo)+'</td><td>'+esc(r.or||'—')+'</td><td>'+esc(fmtDate(r.date))+'</td><td>'+esc(r.owner)+'</td><td class="r">'+peso(r.amount)+'</td></tr>'; }).join('')+
    '<tr class="tot"><td></td><td></td><td></td><td class="r">Total</td><td class="r">'+peso(tot)+'</td></tr>'+
    '</tbody></table>';
  return docShell('JO numbers by series', body);
}
function printJoSeries(){ printDoc(docJoSeries()); }

/* Commission across a set of jobs.
   Mechanics (Mechanic[s] field only): shop rate × labor ÷ #mechanics, split evenly.
   Non-mechanic roles (SA, assessor, parts salesman): own EXPLICIT rate × labor,
   not split, nothing if unset. See jobLaborCommissionMap() in part1_core.js. */
function commissionTable(jobs){
  var map={};
  function add(id,amt){ if(!id||id==='TBA') return; var s=staffById(id); if(!s) return;
    if(!commissionEligible(s)) return;                                  // toggled out of commission payout
    if(!map[id]) map[id]={ name:s.name, role:s.role, amount:0 }; map[id].amount=round2(map[id].amount+amt); }
  jobs.forEach(function(j){
    // Mechanics split the shop-rate pool evenly; non-mechanic roles earn their own rate.
    var cm=jobLaborCommissionMap(j,S);
    Object.keys(cm).forEach(function(id){ add(id, cm[id]); });
  });
  return Object.keys(map).map(function(k){return map[k];}).filter(function(c){return c.amount>0;}).sort(function(a,b){return b.amount-a.amount;});
}

/* ---- End-of-day / period figures ------------------------------------------
   One aggregator for the Daily Close screen, the printed EOD and the date-range
   report, so the three can never disagree. `from`/`to` are inclusive local days
   (pass the same date twice for a single day). */
function eodData(from, to){
  var txns=[];
  S.jobs.forEach(function(j){ (j.payments||[]).forEach(function(p){
    var d=localDay(p.date); if(d && d>=from && d<=to) txns.push({ job:j, p:p, day:d });
  }); });
  txns.sort(function(a,b){ return a.day<b.day?-1:a.day>b.day?1:0; });
  var byMethod={};
  txns.forEach(function(t){ byMethod[t.p.method]=round2((byMethod[t.p.method]||0)+t.p.amount); });
  /* Refunds are negative payments, so both figures below net them out on their
     own — a method line is the real movement of that tender for the day, which
     is what the drawer and the terminal batch are counted against. `refunds` is
     carried separately only so the report can say WHY a line looks low. */
  var collections=round2(txns.reduce(function(s,t){return s+t.p.amount;},0));
  var refunds=round2(txns.reduce(function(s,t){ return s + (t.p.amount<0 ? -t.p.amount : 0); },0));

  function inPeriod(j){ var d=localDay(j.billedAt); return !!d && d>=from && d<=to; }
  /* Voided receipts are not sales, so they are out of every figure below.
     Collections are left untouched: a void does not un-receive cash, so a
     refund is entered as its own payment. */
  var billed=S.jobs.filter(function(j){ return inPeriod(j) && !jobVoided(j); });
  var net=round2(billed.reduce(function(s,j){return s+jobNet(j);},0));   // VATable base (ex-VAT)
  var disc=round2(billed.reduce(function(s,j){return s+discountAmount(j);},0));
  var vs=vatSplit(net,S);
  var partsRev=round2(billed.reduce(function(s,j){return s+partsTotal(j.lines);},0));
  var laborRev=round2(billed.reduce(function(s,j){return s+laborTotal(j.lines);},0));
  /* Approved additional work is part of net sales too, so the mix only ties back
     to `net` if it is carried alongside parts and labor. */
  var addlRev=round2(billed.reduce(function(s,j){return s+addlTotal(j);},0));

  /* Receipts issued in the period, in series order — VOIDED ONES INCLUDED. That
     is the point of the list: reconciliation needs to see the void sitting in
     its place in the series, not a hole where a number used to be. */
  var receipts=S.jobs.filter(function(j){ return inPeriod(j) && j.orNumber; }).map(function(j){
    var m=/(\d+)/.exec(String(j.orNumber));
    /* Amount is what was BILLED — a receipt is listed here whether or not anyone
       paid it, so each row also carries how much of it is still outstanding.
       Without that, a reader has to cross-check every number against the
       Transactions list to tell billings from cash. */
    var gross=jobGross(j), pd=jobPaid(j), due=round2(gross-pd), vd=jobVoided(j);
    return { n:m?Number(m[1]):0, or:j.orNumber, jo:j.no, owner:j.owner||'', plate:j.plate||'',
             day:localDay(j.billedAt), amount:gross, voided:vd,
             paid:pd, due:due,
             status: vd ? 'void' : (due<=0.001 ? 'paid' : (pd>0.001 ? 'part' : 'unpaid')),
             voidReason:(j.orVoid&&j.orVoid.reason)||'', id:j.id };
  }).sort(function(a,b){ return a.n-b.n; });
  var voidCount=receipts.filter(function(r){ return r.voided; }).length;
  var owing=receipts.filter(function(r){ return r.status==='unpaid' || r.status==='part'; });
  var unpaidCount=owing.length;
  var unpaidTotal=round2(owing.reduce(function(s,r){ return s+r.due; },0));
  var billedTotal=round2(receipts.reduce(function(s,r){ return s+(r.voided?0:r.amount); },0));
  /* Numbers inside the period's range that NO job carries anywhere in the shop.
     Checked against every job, not just this period's, so a receipt issued on an
     adjacent day is not mistaken for a missing one. */
  var everyOr={};
  (S.jobs||[]).forEach(function(j){ if(j&&j.orNumber){ var m=/(\d+)/.exec(String(j.orNumber)); if(m) everyOr[Number(m[1])]=true; } });
  var missing=[];
  if(receipts.length){
    for(var n=receipts[0].n; n<=receipts[receipts.length-1].n; n++){ if(!everyOr[n]) missing.push(n); }
  }
  return { from:from, to:to, txns:txns, byMethod:byMethod, collections:collections, refunds:refunds,
           billed:billed, net:net, disc:disc, vs:vs, partsRev:partsRev, laborRev:laborRev, addlRev:addlRev,
           receipts:receipts, voidCount:voidCount, missing:missing,
           billedTotal:billedTotal, unpaidCount:unpaidCount, unpaidTotal:unpaidTotal };
}
/* Receipts-by-series table shared by both screens and both printouts. */
function eodReceiptRowsHTML(d, withDate, clickable){
  if(!d.receipts.length) return '<tr><td colspan="'+(withDate?6:5)+'" class="muted center">No receipts issued.</td></tr>';
  return d.receipts.map(function(r){
    return '<tr'+(clickable?' onclick="go(\'job\',\''+r.id+'\')" style="cursor:pointer"':'')+(r.voided?' class="void-row"':'')+'>'+
      '<td><b>'+esc(r.or)+'</b></td>'+
      (withDate?'<td>'+esc(fmtDate(r.day))+'</td>':'')+
      '<td>'+esc(r.jo)+'</td>'+
      '<td>'+esc(r.owner)+(r.plate?' <span class="muted small">'+esc(r.plate)+'</span>':'')+'</td>'+
      '<td>'+(r.voided
        ? '<span class="chip">VOID</span>'+(r.voidReason?' <span class="muted small">'+esc(r.voidReason)+'</span>':'')
        : r.status==='unpaid' ? '<span class="chip due">UNPAID</span> <span class="muted small">'+peso(r.due)+' due</span>'
        : r.status==='part'   ? '<span class="chip due">PART-PAID</span> <span class="muted small">'+peso(r.due)+' still due</span>'
        : '<span class="muted small">Paid</span>')+'</td>'+
      '<td class="r">'+(r.voided?'<span class="muted">—</span>':peso(r.amount))+'</td></tr>';
  }).join('');
}
function eodReceiptsCard(d, withDate){
  var head=d.receipts.length
    ? d.receipts.length+' receipt'+(d.receipts.length===1?'':'s')+
      (d.voidCount?' · '+d.voidCount+' void':'')+
      (d.unpaidCount?' · '+d.unpaidCount+' unpaid':'')+
      ' · '+esc(d.receipts[0].or)+(d.receipts.length>1?' → '+esc(d.receipts[d.receipts.length-1].or):'')
    : 'None issued';
  /* Amounts here are BILLED, not collected — the cash figure is the Collections
     KPI. Saying so on the card is what stops the two being read as one. */
  return '<div class="card"><h2>OR numbers by series</h2>'+
    '<div class="muted small mb8">'+head+'</div>'+
    (d.receipts.length?'<div class="muted small mb8">Amounts are <b>billed</b>, not collected'+
      (d.unpaidTotal?' — '+peso(d.unpaidTotal)+' of this is still uncollected':'')+'.</div>':'')+
    (d.missing.length
      ? '<div class="muted small" style="color:var(--brand)">⚠ '+d.missing.length+
        ' number(s) in this range are on no job order: '+d.missing.map(function(n){return 'OR-'+n;}).join(', ')+'</div>'
      : (d.receipts.length?'<div class="muted small">✓ Series is continuous for this range.</div>':''))+
    '<div class="card pad0 mt8"><table class="tbl'+(d.receipts.length?' click':'')+'"><thead><tr><th>OR #</th>'+
      (withDate?'<th>Date</th>':'')+'<th>JO #</th><th>Sold to</th><th>Status</th><th class="r">Amount</th></tr></thead>'+
    '<tbody>'+eodReceiptRowsHTML(d, withDate, true)+'</tbody></table></div></div>';
}

/* ---- Daily Close ---------------------------------------------------------- */
var DC_DATE=null;
VIEWS.dailyclose = function(){
  if(!DC_DATE) DC_DATE=todayISO();
  var date=DC_DATE;
  var d=eodData(date, date);

  return '<div class="page"><div class="page-head"><h1>Daily Close</h1>'+
    '<div class="row gap"><input type="date" value="'+attr(date)+'" onchange="DC_DATE=this.value;render()">'+
    '<button class="btn primary" onclick="printDailyClose()">⎙ Print EOD</button></div></div>'+
    '<div class="kpis">'+kpi('Collections',peso(d.collections))+kpi('Net sales (billed)',peso(d.net))+
      kpi('Output VAT',peso(d.vs.vat))+kpi('Discounts',peso(d.disc))+kpi('Transactions',d.txns.length)+'</div>'+
    '<div class="cols"><div class="colmain"><div class="card"><h2>Transactions · '+esc(fmtDate(date))+'</h2>'+
      (d.txns.length?'<table class="tbl"><thead><tr><th>JO #</th><th>Customer</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+
      d.txns.map(function(t){
        var isR=t.p.amount<0;
        return '<tr'+(isR?' class="void-row"':'')+'><td>'+esc(t.job.no)+
          (isR?' <span class="chip">REFUND</span>':'')+'</td><td>'+esc(t.job.owner)+
          (isR&&t.p.reason?' <span class="muted small">'+esc(t.p.reason)+'</span>':'')+
          '</td><td>'+esc(t.p.method)+'</td><td class="r">'+peso(t.p.amount)+'</td></tr>';
      }).join('')+
      '<tr class="tot"><td colspan="3" class="r"><b>Total collected</b></td><td class="r"><b>'+peso(d.collections)+'</b></td></tr>'+
      '</tbody></table>':emptyState('No collections on this date.'))+'</div>'+
      eodReceiptsCard(d, false)+'</div>'+
    '<div class="colside">'+
      '<div class="card"><h2>Collections by method</h2>'+(Object.keys(d.byMethod).length?Object.keys(d.byMethod).map(function(m){return line2(m,peso(d.byMethod[m]));}).join(''):emptyState('—'))+
        (d.refunds?'<div class="muted small mt8">Net of '+peso(d.refunds)+' refunded — each line is the real movement of that tender.</div>':'')+'</div>'+
      '<div class="card"><h2>Sales mix</h2>'+line2('Parts',peso(d.partsRev))+line2('Labor',peso(d.laborRev))+
        (d.addlRev?line2('Additional work',peso(d.addlRev)):'')+line2('Net sales',peso(d.net))+'</div>'+
    '</div></div></div>';
};

/* ---- Productivity (mechanic KPI) ------------------------------------------ */
/* ---- Productivity period (all / today / week / month / custom) ----------- */
var PROD_PERIOD='month', PROD_FROM='', PROD_TO='';
function prodRange(){
  var today=todayISO();
  if(PROD_PERIOD==='today') return { from:today, to:today };
  if(PROD_PERIOD==='week'){ var d=new Date(); var dow=(d.getDay()+6)%7; var mon=new Date(d); mon.setDate(d.getDate()-dow); return { from:todayISO(mon), to:today }; }
  if(PROD_PERIOD==='month') return { from:today.slice(0,7)+'-01', to:today };
  if(PROD_PERIOD==='custom') return { from:PROD_FROM||'0000-01-01', to:PROD_TO||'9999-12-31' };
  return { from:'0000-01-01', to:'9999-12-31' };  // all
}
function jobsInProdPeriod(jobs){
  var r=prodRange();
  return jobs.filter(function(j){ var d=localDay(j.billedAt); return d && d>=r.from && d<=r.to; });
}
function setProd(p){
  PROD_PERIOD=p;
  if(p==='custom' && !PROD_FROM){ PROD_FROM=todayISO().slice(0,7)+'-01'; PROD_TO=todayISO(); }
  render();
}
function prodPeriodLabel(){
  if(PROD_PERIOD==='all') return 'All time';
  if(PROD_PERIOD==='today') return 'Today · '+fmtDate(todayISO());
  var r=prodRange(); return fmtDate(r.from)+' – '+fmtDate(r.to);
}

/* KPI listing order — every staff member shown, sorted by role rank. Roles not
   listed (e.g. Parts Salesman) sort last but are still included. */
var KPI_ROLE_ORDER=['SV','Secretary','SA','SM','Mechanic'];
function kpiRoleRank(role){ var i=KPI_ROLE_ORDER.indexOf(role); return i<0?KPI_ROLE_ORDER.length:i; }
/* Actual hands-on hours for a job = time spent in status B2 (on-going, parts
   complete), from the clipboard log. Each B2 interval is capped at 8h so a job
   left open overnight without a stop log can't inflate the number. */
function jobB2Hours(j){
  var log=(j.statusLog||[]).filter(function(e){return e&&e.time;}).slice().sort(function(a,b){return a.time<b.time?-1:1;});
  var CAP=8*3600000, total=0;
  for(var i=0;i<log.length;i++){
    if(log[i].code!=='B2') continue;
    var start=new Date(log[i].time).getTime();
    var end=(i+1<log.length)? new Date(log[i+1].time).getTime() : Date.now();
    var dur=end-start; if(!(dur>0)) continue; if(dur>CAP) dur=CAP;
    total+=dur;
  }
  return total/3600000;
}
/* When the mechanic finished (first Release-group log, i.e. job done). */
function jobDoneTime(j){
  var log=(j.statusLog||[]).filter(function(e){return e&&e.time;}).slice().sort(function(a,b){return a.time<b.time?-1:1;});
  for(var i=0;i<log.length;i++){ if(String(log[i].code||'').charAt(0)==='C') return log[i].time; }
  return j.billedAt||null;
}
/* On-time = finished on or before the job's ETD. null when there's no ETD.
   localDay() because the ETD is a local date but the finish stamp is UTC ISO. */
function jobOnTime(j){
  if(!j.etd) return null;
  var done=jobDoneTime(j); if(!done) return null;
  var d=localDay(done);
  if(!d) return null;
  return d <= String(j.etd).slice(0,10);
}
/* Efficiency % cell = standard (job) hrs ÷ actual B2 hrs, coloured. */
function effCell(std, act){ var e=Math.round((std/act)*100); return '<b style="color:'+(e>=100?'#1a7f37':'#b26b00')+'">'+e+'%</b>'; }
/* Efficiency / on-time status band → colour class (both are "higher is better"). */
function effBand(p){ return p==null?'st-na':(p>=100?'st-good':p>=85?'st-warn':'st-bad'); }
function otBand(p){ return p==null?'st-na':(p>=90?'st-good':p>=75?'st-warn':'st-bad'); }
/* Status bars (percent) with a 100% reference marker on the track. items:
   [{label, pct, disp, band}]. Native title tooltips per row. */
function perfStatBars(items){
  var max=Math.max(100, Math.max.apply(null, items.map(function(i){return i.pct||0;}).concat([0])));
  var refPos=Math.round(100/max*100);
  return '<div class="bars perf-bars">'+items.map(function(i){
    var w=(i.pct==null)?0:Math.round(Math.min(i.pct,max)/max*100);
    return '<div class="bar-row" title="'+esc(i.label)+': '+esc(i.disp)+'"><div class="bar-lab">'+esc(i.label)+'</div>'+
      '<div class="bar-track"><div class="bar-ref" style="left:'+refPos+'%"></div><div class="bar-fill '+i.band+'" style="width:'+w+'%"></div></div>'+
      '<div class="bar-val">'+esc(i.disp)+'</div></div>';
  }).join('')+'</div>';
}
/* Full mechanic-performance dashboard for the period: team tiles, comparison
   charts, and a per-mechanic scorecard grid. Reads the same `list` the table uses. */
function mechPerfSection(list){
  var m=list.filter(function(r){ return isMechanicRole(r.role) && (r.jobs>0 || r.hours>0 || r.actual>0); });
  if(!m.length) return '<div class="card"><h2>Mechanic performance review</h2>'+emptyState('No mechanic activity in this period.')+'</div>';
  m.forEach(function(r){
    r.eff = r.actual>0 ? Math.round(r.hours/r.actual*100) : null;
    r.ot  = r.otTotal>0 ? Math.round(r.otHit/r.otTotal*100) : null;
    r.revhr = r.actual>0 ? round2(r.labor/r.actual) : 0;
    r.avgHrs = r.jobs ? round2(r.hours/r.jobs) : 0;
    r.avgLabor = r.jobs ? round2(r.labor/r.jobs) : 0;
  });
  var T={jobs:0,hours:0,actual:0,otHit:0,otTotal:0,labor:0,commission:0,comebacks:0};
  m.forEach(function(r){ T.jobs+=r.jobs; T.hours+=r.hours; T.actual+=r.actual; T.otHit+=r.otHit; T.otTotal+=r.otTotal; T.labor+=r.labor; T.commission+=r.commission; T.comebacks+=(r.comebacks||0); });
  var teamEff=T.actual>0?Math.round(T.hours/T.actual*100):null;
  var teamOt =T.otTotal>0?Math.round(T.otHit/T.otTotal*100):null;
  var teamRev=T.actual>0?round2(T.labor/T.actual):0;
  var tiles='<div class="kpis">'+
    kpi('Mechanics', m.length)+
    kpi('Jobs done', T.jobs)+
    kpi('Standard hrs', num(round2(T.hours)), 'from job orders')+
    kpi('Actual hrs (B2)', num(round2(T.actual)), 'from the log')+
    kpi('Team efficiency', teamEff!=null?teamEff+'%':'—', 'std ÷ actual')+
    kpi('Team on-time', teamOt!=null?teamOt+'%':'—', T.otTotal?('vs ETD · '+T.otHit+'/'+T.otTotal):'no ETDs')+
    kpi('Revenue / hr', peso(teamRev), 'labor ÷ actual hr')+
    kpi('Labor billed', peso(round2(T.labor)))+
    kpi('Comebacks', T.comebacks, T.jobs?('warranty rework · '+Math.round(T.comebacks/T.jobs*100)+'% of jobs'):'warranty rework')+
  '</div>';
  var byEff=m.slice().sort(function(a,b){return (b.eff==null?-1:b.eff)-(a.eff==null?-1:a.eff);});
  var effBars=perfStatBars(byEff.map(function(r){return {label:r.name, pct:r.eff, band:effBand(r.eff), disp:r.eff!=null?r.eff+'%':'—'};}));
  var otBars=perfStatBars(m.slice().sort(function(a,b){return (b.ot==null?-1:b.ot)-(a.ot==null?-1:a.ot);}).map(function(r){return {label:r.name, pct:r.ot, band:otBand(r.ot), disp:r.ot!=null?(r.ot+'% ('+r.otHit+'/'+r.otTotal+')'):'—'};}));
  var jobBars=bars(m.slice().sort(function(a,b){return b.jobs-a.jobs;}).map(function(r){return {label:r.name, value:r.jobs};}));
  var revBars=bars(m.slice().sort(function(a,b){return b.revhr-a.revhr;}).map(function(r){return {label:r.name, value:r.revhr};}), peso);
  var hrsMax=Math.max(1, Math.max.apply(null, m.map(function(r){return Math.max(r.hours,r.actual);}).concat([0])));
  var hrsBars='<div class="bars perf-bars">'+m.slice().sort(function(a,b){return b.actual-a.actual;}).map(function(r){
    var aw=Math.round(r.actual/hrsMax*100), sp=Math.round(r.hours/hrsMax*100), over=r.actual>r.hours+0.001;
    return '<div class="bar-row" title="'+esc(r.name)+' — actual '+num(round2(r.actual))+'h vs estimate '+num(round2(r.hours))+'h"><div class="bar-lab">'+esc(r.name)+'</div>'+
      '<div class="bar-track"><div class="bar-ref" style="left:'+sp+'%"></div><div class="bar-fill '+(over?'st-bad':'st-good')+'" style="width:'+aw+'%"></div></div>'+
      '<div class="bar-val">'+num(round2(r.actual))+'h</div></div>';
  }).join('')+'</div>';
  var cards=byEff.map(function(r){
    function row(k,v){ return '<div class="perf-kv"><span>'+k+'</span><b>'+v+'</b></div>'; }
    var eb=r.eff==null?'<span class="muted">—</span>':'<span class="perf-badge '+effBand(r.eff)+'">'+r.eff+'%</span>';
    var ob=r.ot==null?'<span class="muted">—</span>':'<span class="perf-badge '+otBand(r.ot)+'">'+r.ot+'%</span>';
    return '<div class="perf-card"><div class="perf-card-h"><b>'+esc(r.name)+'</b> <span class="muted small">'+esc(roleLabel(r.role))+'</span></div>'+
      '<div class="perf-badges">'+eb+'<span class="muted small">efficiency</span>'+ob+'<span class="muted small">on-time</span></div>'+
      row('Jobs done', r.jobs)+ row('Standard hrs', num(round2(r.hours)))+ row('Actual hrs', num(round2(r.actual)))+
      row('Avg std hrs / job', num(r.avgHrs))+ row('Labor billed', peso(r.labor))+ row('Revenue / actual hr', peso(r.revhr))+
      row('Comebacks', (r.comebacks>0?('<span class="st-bad-t">'+r.comebacks+'</span>'+(r.jobs?' ('+Math.round(r.comebacks/r.jobs*100)+'%)':'')):'0'))+
      row('Avg labor / job', peso(r.avgLabor))+ row('Commission', peso(r.commission))+'</div>';
  }).join('');
  return '<div class="card"><h2>Mechanic performance review</h2>'+
    '<p class="muted small"><b>How to read.</b> <b class="st-good-t">Efficiency</b> = standard job hrs ÷ actual worked hrs: <span class="st-good-t">green ≥ 100%</span> (beat the estimate), <span class="st-warn-t">amber 85–99%</span>, <span class="st-bad-t">red &lt; 85%</span>; the marker on each bar is the 100% break-even. <b>On-time</b> = finished on/before ETD (green ≥ 90%). <b>Actual hrs</b> is the per-mechanic labor timer when used, else time in status B2 from the log (capped 8h/interval). <b class="st-bad-t">Comebacks</b> are warranty rework charged to the mechanic — a fast tech with high comebacks is not actually cheap.</p>'+
    tiles+
    '<div class="perf-grid2">'+
      '<div><h3 class="perf-h">Efficiency % <span class="muted small">· marker = 100%</span></h3>'+effBars+'</div>'+
      '<div><h3 class="perf-h">On-time % <span class="muted small">· vs ETD</span></h3>'+otBars+'</div>'+
      '<div><h3 class="perf-h">Actual hrs vs estimate <span class="muted small">· bar = actual · marker = estimate · green ≤ estimate</span></h3>'+hrsBars+'</div>'+
      '<div><h3 class="perf-h">Jobs completed</h3>'+jobBars+'</div>'+
      '<div><h3 class="perf-h">Revenue per actual hr</h3>'+revBars+'</div>'+
    '</div>'+
    '<h3 class="perf-h" style="margin-top:16px">Per-mechanic scorecards</h3><div class="perf-cards">'+cards+'</div>'+
  '</div>';
}
VIEWS.productivity = function(){
  var jobs=jobsInProdPeriod(billedJobs());
  var staff=(S.staff||[]).slice().sort(function(a,b){ return kpiRoleRank(a.role)-kpiRoleRank(b.role) || String(a.name||'').localeCompare(String(b.name||'')); });
  var byId={};
  var list=staff.map(function(s){ var r={ id:s.id, name:s.name, role:s.role, on:(s.commission!==false), jobs:0, hours:0, actual:0, otHit:0, otTotal:0, labor:0, commission:0, comebacks:0 }; byId[s.id]=r; return r; });
  jobs.forEach(function(j){
    // Evaluation figure: pool split among EVERYONE assigned, ignoring the payout toggle.
    var cm=jobLaborCommissionMapAll(j,S); var lab=laborTotal(j.lines);
    var mechs=(j.mechanicIds||[]).filter(function(x){return x&&x!=='TBA';});
    // every distinct staff assigned in ANY capacity — job count
    var assigned=[]; mechs.concat([j.saId,j.assessedBy,j.partsSalesman]).forEach(function(x){ if(x&&x!=='TBA'&&assigned.indexOf(x)<0) assigned.push(x); });
    assigned.forEach(function(id){ var r=byId[id]; if(r) r.jobs++; });
    // job hours & labor billed are mechanic productivity metrics — split among mechanics.
    // Actual hrs: prefer the per-mechanic timer; fall back to an even split of the B2 estimate.
    var timed=jobHasTimer(j); var actualH=jobB2Hours(j); var onTime=jobOnTime(j);
    mechs.forEach(function(mid){ var r=byId[mid]; if(!r) return;
      r.hours=round2(r.hours+(Number(j.jobHours)||0)/mechs.length);
      r.labor=round2(r.labor+lab/mechs.length);
      r.actual=round2(r.actual+(timed? jobMechActualHours(j,mid) : actualH/mechs.length));
      if(onTime!==null){ r.otTotal++; if(onTime) r.otHit++; }
    });
    Object.keys(cm).forEach(function(id){ var r=byId[id]; if(r) r.commission=round2(r.commission+cm[id]); });
    // Comeback attribution: counts against the at-fault mechanic (the one who did the original job).
    if(j.comebackMechId){ var rc=byId[j.comebackMechId]; if(rc) rc.comebacks++; }
  });
  var rows=list.map(function(m){
    var toggle='<label class="switch" title="Include in commission payout"><input type="checkbox" '+(m.on?'checked':'')+
      ' onchange="toggleStaffCommission(\''+m.id+'\',this.checked)"><span class="track"><span class="knob"></span></span></label>';
    var commCell = m.on ? '<b>'+peso(m.commission)+'</b>'
      : '<span class="muted" title="Evaluation only — excluded from payout">'+peso(m.commission)+'</span>';
    return '<tr><td><b>'+esc(m.name)+'</b> <span class="muted small">'+esc(roleLabel(m.role))+'</span></td><td class="r">'+m.jobs+'</td><td class="r">'+num(m.hours)+'</td>'+
      '<td class="r">'+num(m.actual)+'</td>'+
      '<td class="r">'+(m.actual>0? effCell(m.hours,m.actual) : '<span class="muted">—</span>')+'</td>'+
      '<td class="r">'+(m.otTotal>0? Math.round(m.otHit/m.otTotal*100)+'% <span class="muted small">('+m.otHit+'/'+m.otTotal+')</span>' : '<span class="muted">—</span>')+'</td>'+
      '<td class="r">'+(m.comebacks>0? '<b class="st-bad-t">'+m.comebacks+'</b>'+(m.jobs?' <span class="muted small">('+Math.round(m.comebacks/m.jobs*100)+'%)</span>':'') : '<span class="muted">0</span>')+'</td>'+
      '<td class="r">'+peso(m.labor)+'</td><td class="r">'+peso(m.jobs?round2(m.labor/m.jobs):0)+'</td><td class="r">'+commCell+'</td><td class="center">'+toggle+'</td></tr>';
  }).join('');
  var commBars=list.filter(function(m){return m.commission>0;}).map(function(m){return {label:m.name,value:m.commission};});
  var seg=['all','today','week','month','custom'].map(function(p){
    var lab={all:'All time',today:'Today',week:'This week',month:'This month',custom:'Custom'}[p];
    return '<button class="seg-b'+(PROD_PERIOD===p?' on':'')+'" onclick="setProd(\''+p+'\')">'+lab+'</button>';
  }).join('');
  var custom = PROD_PERIOD==='custom' ? '<div class="row gap" style="align-items:center">'+
    '<input type="date" value="'+attr(PROD_FROM)+'" onchange="PROD_FROM=this.value;render()"> <span class="muted">to</span> '+
    '<input type="date" value="'+attr(PROD_TO)+'" onchange="PROD_TO=this.value;render()"></div>' : '';
  return '<div class="page"><div class="page-head"><h1>Staff Productivity</h1>'+
    '<div class="row gap"><button class="btn ghost" onclick="printMechCommission()">⎙ Mechanic commissions</button>'+
    '<button class="btn primary" onclick="printPayout()">⎙ Payout sheet</button></div></div>'+
    '<div class="row gap" style="align-items:center;flex-wrap:wrap"><div class="seg">'+seg+'</div>'+custom+
      '<span class="muted small">'+esc(prodPeriodLabel())+'</span></div>'+
    '<p class="muted small mt8">Commission is each staff member’s own admin-set rate × the job’s labor (set per person on the Staff page). The Commission column is the <b>evaluation</b> figure — shown even for staff switched off (greyed). The <b>Payout sheet</b> pays only staff with <b>Payout</b> on.</p>'+
    '<p class="muted small">Job hrs = standard hours from the Job Order. Actual hrs = the per-mechanic labor <b>timer</b> when used, else time in status <b>B2</b> from the log (each interval capped at 8h). Efficiency = Job hrs ÷ Actual hrs (green ≥ 100%). On-time = finished on/before ETD. <b>Comebacks</b> = warranty rework charged to the mechanic (% of their jobs) — watch this next to efficiency.</p>'+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Staff</th><th class="r">Jobs</th><th class="r">Job hrs</th><th class="r">Actual hrs</th><th class="r">Efficiency</th><th class="r">On-time</th><th class="r">Comebacks</th><th class="r">Labor billed</th><th class="r">Avg/job</th><th class="r">Commission</th><th class="center">Payout</th></tr></thead><tbody>'+(rows||'<tr><td colspan="11" class="muted center">No staff.</td></tr>')+'</tbody></table></div>'+
    mechPerfSection(list)+
    '<div class="card"><h2>Commission by staff</h2>'+(commBars.length?bars(commBars,peso):emptyState('No commissions in this period.'))+'</div></div>';
};

/* ---- Receivables (A/R) ---------------------------------------------------- */
function arJobs(){ return S.jobs.filter(function(j){return (j.stage==='Final Billing'||j.stage==='Released') && !jobVoided(j) && jobBalance(j)>0.001;}); }
function agingBucket(days){ if(days<=30) return '0-30'; if(days<=60) return '31-60'; if(days<=90) return '61-90'; return '90+'; }
VIEWS.receivables = function(){
  var ar=arJobs();
  var buckets={'0-30':0,'31-60':0,'61-90':0,'90+':0};
  var byCust={};
  ar.forEach(function(j){ var days=j.billedAt?Math.max(0,daysBetween(j.billedAt, new Date().toISOString())):0;
    var b=agingBucket(days); var bal=jobBalance(j); buckets[b]=round2(buckets[b]+bal);
    var key=j.owner||j.plate; (byCust[key]=byCust[key]||{name:key,total:0,jobs:[]}); byCust[key].total=round2(byCust[key].total+bal);
    byCust[key].jobs.push({ j:j, days:days, bucket:b, bal:bal }); });
  var total=round2(Object.keys(buckets).reduce(function(s,k){return s+buckets[k];},0));
  var custList=Object.keys(byCust).map(function(k){return byCust[k];}).sort(function(a,b){return b.total-a.total;});
  var custHTML=custList.length? custList.map(function(c){
    return '<div class="card"><div class="card-head"><h2>'+esc(c.name)+'</h2><div class="row gap"><b>'+peso(c.total)+'</b>'+
      '<button class="btn sm ghost" onclick="printStatement(\''+attr(encodeURIComponent(c.name))+'\')">⎙ Statement</button></div></div>'+
      '<table class="tbl sm"><thead><tr><th>JO #</th><th>Billed</th><th>Age</th><th>Bucket</th><th class="r">Balance</th><th></th></tr></thead><tbody>'+
      c.jobs.map(function(x){return '<tr><td>'+esc(x.j.no)+'</td><td>'+esc(fmtDate(x.j.billedAt))+'</td><td>'+x.days+'d</td><td>'+chip(x.bucket,x.bucket==='90+'?'due':'')+'</td>'+
        '<td class="r">'+peso(x.bal)+'</td><td class="r"><button class="btn xs primary" onclick="collectAR(\''+x.j.id+'\')">Collect</button></td></tr>';}).join('')+
      '</tbody></table></div>';
  }).join('') : emptyState('No outstanding receivables.');
  return '<div class="page"><div class="page-head"><h1>Receivables (A/R)</h1></div>'+
    '<div class="kpis">'+kpi('Total A/R',peso(total))+kpi('0–30',peso(buckets['0-30']))+kpi('31–60',peso(buckets['31-60']))+
      kpi('61–90',peso(buckets['61-90']))+kpi('90+',peso(buckets['90+']),buckets['90+']>0?'<span class="amber">overdue</span>':'')+'</div>'+
    custHTML+'</div>';
};
function collectAR(id){
  var j=jobById(id); var bal=jobBalance(j);
  openModal('Collect payment — '+j.no,
    '<div class="grid2">'+field('Amount','<input id="arAmt" type="number" step="0.01" value="'+attr(bal)+'">')+
    field('Method','<select id="arMethod"><option>Cash</option><option>GCash</option><option>Card</option><option>Bank transfer</option></select>')+'</div>',
    { onOk:'saveAR', okText:'Record' }); setTimeout(function(){arCtx=id;},10);
}
var arCtx=null;
function saveAR(){ var j=jobById(arCtx); var amt=Number(val('arAmt'))||0; if(amt<=0){toast('Enter amount','err');return;}
  j.payments.push({ amount:amt, method:val('arMethod'), date:new Date().toISOString() });
  persist(); closeModal(); toast('Payment recorded'); render(); }
