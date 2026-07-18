/* ============================================================================
   PART 7 — Reports, Daily Close, Productivity, Receivables
   Commission logic uses jobLaborCommission() everywhere (single source).
   ========================================================================== */

function releasedJobs(){ return S.jobs.filter(function(j){return j.stage==='Released';}); }
function billedJobs(){ return S.jobs.filter(function(j){return j.stage==='Final Billing'||j.stage==='Released';}); }

function jobCostOfParts(j){
  return round2((j.lines||[]).reduce(function(s,l){
    if(l.type!=='part') return s;
    var unitCost = (l.netPrice!=null && l.netPrice!=='') ? Number(l.netPrice)||0 : (l.ref ? ((partById(l.ref)||{}).cost||0) : 0);
    return s + unitCost*(Number(l.qty)||0);
  },0));
}

/* ---- Reports & Analytics -------------------------------------------------- */
VIEWS.reports = function(){
  var rel=releasedJobs();
  var revenue=round2(rel.reduce(function(s,j){return s+jobGross(j);},0));
  var partsCost=round2(rel.reduce(function(s,j){return s+jobCostOfParts(j);},0));
  var gp=round2(revenue-partsCost);
  var margin=revenue? Math.round(gp/revenue*100):0;
  var wip=round2(S.jobs.filter(function(j){return j.stage!=='Released';}).reduce(function(s,j){return s+jobGross(j);},0));
  var avg=rel.length? round2(revenue/rel.length):0;

  // revenue by month
  var byMonth={};
  rel.forEach(function(j){ var m=(j.billedAt||j.dateIn||'').slice(0,7); if(!m) return; byMonth[m]=round2((byMonth[m]||0)+jobGross(j)); });
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
    '<div class="kpis">'+kpi('Revenue (released)',peso(revenue))+kpi('Gross profit',peso(gp))+kpi('Margin',margin+'%')+
      kpi('Open WIP',peso(wip))+kpi('Avg ticket',peso(avg))+'</div>'+
    '<div class="cols"><div class="colmain">'+
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
    orSeriesCard()+
  '</div>';
};

/* ---- OR numbers by series (with corresponding JO #s) ---------------------- */
/* Every issued Official Receipt, ordered by its numeric series, paired with the
   Job Order it billed. Detects gaps (missing numbers) in the sequence. */
function orSeriesRows(){
  return (S.jobs||[]).filter(function(j){ return j.orNumber; }).map(function(j){
    var m=/(\d+)/.exec(String(j.orNumber));
    return { n:m?Number(m[1]):0, or:j.orNumber, jo:j.no, date:j.billedAt||j.dateIn||'',
             owner:j.owner||'', plate:j.plate||'', amount:jobGross(j), id:j.id };
  }).sort(function(a,b){ return a.n-b.n || String(a.or).localeCompare(String(b.or)); });
}
function orSeriesGaps(rows){
  var gaps=[];
  for (var i=1;i<rows.length;i++){
    var prev=rows[i-1].n, cur=rows[i].n;
    if (cur-prev>1){ gaps.push({ from:prev+1, to:cur-1, count:cur-prev-1 }); }
  }
  return gaps;
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
    return '<tr onclick="go(\'job\',\''+r.id+'\')" style="cursor:pointer">'+
      '<td><b>'+esc(r.or)+'</b></td><td>'+esc(r.jo)+'</td>'+
      '<td>'+esc(fmtDate(r.date))+'</td>'+
      '<td>'+esc(r.owner)+(r.plate?' <span class="muted small">'+esc(r.plate)+'</span>':'')+'</td>'+
      '<td class="r">'+peso(r.amount)+'</td></tr>';
  }).join('');
}
function orSeriesSearch(v){ OR_Q=v; var el=document.getElementById('orSeriesBody'); if(el) el.innerHTML=orSeriesRowsHTML(); }
function orSeriesCard(){
  var rows=orSeriesRows();
  if (!rows.length) return '<div class="card"><h2>OR numbers by series</h2>'+emptyState('No OR numbers issued yet.')+'</div>';
  var gaps=orSeriesGaps(rows);
  var gapNote = gaps.length
    ? '<div class="muted small" style="color:var(--brand)">⚠ '+gaps.reduce(function(s,g){return s+g.count;},0)+
      ' missing OR number(s): '+gaps.map(function(g){ return g.count===1?('OR-'+g.from):('OR-'+g.from+'–OR-'+g.to); }).join(', ')+'</div>'
    : '<div class="muted small">✓ No gaps — series is continuous.</div>';
  return '<div class="card"><div class="card-head"><h2>OR numbers by series</h2>'+
    '<button class="btn sm ghost" onclick="printOrSeries()">⎙ Print</button></div>'+
    '<div class="muted small mb8">'+rows.length+' receipts · '+esc(rows[0].or)+' → '+esc(rows[rows.length-1].or)+'</div>'+
    gapNote+
    '<input class="searchbox mt8" id="orSeriesSearch" value="'+attr(OR_Q)+'" oninput="orSeriesSearch(this.value)" placeholder="Search OR # / JO # / customer / plate…" autocomplete="off">'+
    '<div class="card pad0 mt8"><table class="tbl click"><thead><tr><th>OR #</th><th>JO #</th><th>Date</th><th>Sold to</th><th class="r">Amount</th></tr></thead>'+
    '<tbody id="orSeriesBody">'+orSeriesRowsHTML()+'</tbody></table></div></div>';
}
function docOrSeries(){
  var rows=orSeriesFiltered();
  var tot=round2(rows.reduce(function(s,r){return s+r.amount;},0));
  var body=docHeader('OR Numbers by Series')+
    '<div class="meta"><div><b>Receipts</b>'+rows.length+'</div>'+
      '<div><b>Range</b>'+(rows.length?esc(rows[0].or)+' → '+esc(rows[rows.length-1].or):'—')+'</div></div>'+
    '<table><thead><tr><th>OR #</th><th>JO #</th><th>Date</th><th>Sold to</th><th class="r">Amount</th></tr></thead><tbody>'+
    rows.map(function(r){ return '<tr><td>'+esc(r.or)+'</td><td>'+esc(r.jo)+'</td><td>'+esc(fmtDate(r.date))+'</td><td>'+esc(r.owner)+'</td><td class="r">'+peso(r.amount)+'</td></tr>'; }).join('')+
    '<tr class="tot"><td></td><td></td><td></td><td class="r">Total</td><td class="r">'+peso(tot)+'</td></tr>'+
    '</tbody></table>';
  return docShell('OR numbers by series', body);
}
function printOrSeries(){ printDoc(docOrSeries()); }

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

/* ---- Daily Close ---------------------------------------------------------- */
var DC_DATE=null;
VIEWS.dailyclose = function(){
  if(!DC_DATE) DC_DATE=todayISO();
  var date=DC_DATE;
  // payments on that date across all jobs
  var txns=[];
  S.jobs.forEach(function(j){ (j.payments||[]).forEach(function(p){ if((p.date||'').slice(0,10)===date) txns.push({ job:j, p:p }); }); });
  var byMethod={};
  txns.forEach(function(t){ byMethod[t.p.method]=round2((byMethod[t.p.method]||0)+t.p.amount); });
  var collections=round2(txns.reduce(function(s,t){return s+t.p.amount;},0));
  // jobs billed that day -> net sales / vat / discounts
  var billed=S.jobs.filter(function(j){return (j.billedAt||'').slice(0,10)===date;});
  var net=round2(billed.reduce(function(s,j){return s+jobNet(j);},0));   // VATable base (ex-VAT)
  var disc=round2(billed.reduce(function(s,j){return s+discountAmount(j);},0));
  var vs=vatSplit(net,S);
  var partsRev=round2(billed.reduce(function(s,j){return s+partsTotal(j.lines);},0));
  var laborRev=round2(billed.reduce(function(s,j){return s+laborTotal(j.lines);},0));

  return '<div class="page"><div class="page-head"><h1>Daily Close</h1>'+
    '<div class="row gap"><input type="date" value="'+attr(date)+'" onchange="DC_DATE=this.value;render()">'+
    '<button class="btn primary" onclick="printDailyClose()">⎙ Print EOD</button></div></div>'+
    '<div class="kpis">'+kpi('Collections',peso(collections))+kpi('Net sales (billed)',peso(net))+
      kpi('Output VAT',peso(vs.vat))+kpi('Discounts',peso(disc))+kpi('Transactions',txns.length)+'</div>'+
    '<div class="cols"><div class="colmain"><div class="card"><h2>Transactions · '+esc(fmtDate(date))+'</h2>'+
      (txns.length?'<table class="tbl"><thead><tr><th>JO #</th><th>Customer</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+
      txns.map(function(t){return '<tr><td>'+esc(t.job.no)+'</td><td>'+esc(t.job.owner)+'</td><td>'+esc(t.p.method)+'</td><td class="r">'+peso(t.p.amount)+'</td></tr>';}).join('')+
      '</tbody></table>':emptyState('No collections on this date.'))+'</div></div>'+
    '<div class="colside">'+
      '<div class="card"><h2>Collections by method</h2>'+(Object.keys(byMethod).length?Object.keys(byMethod).map(function(m){return line2(m,peso(byMethod[m]));}).join(''):emptyState('—'))+'</div>'+
      '<div class="card"><h2>Sales mix</h2>'+line2('Parts',peso(partsRev))+line2('Labor',peso(laborRev))+'</div>'+
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
  return jobs.filter(function(j){ var d=(j.billedAt||'').slice(0,10); return d && d>=r.from && d<=r.to; });
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
/* On-time = finished on or before the job's ETD. null when there's no ETD. */
function jobOnTime(j){
  if(!j.etd) return null;
  var done=jobDoneTime(j); if(!done) return null;
  return String(done).slice(0,10) <= String(j.etd).slice(0,10);
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
  var T={jobs:0,hours:0,actual:0,otHit:0,otTotal:0,labor:0,commission:0};
  m.forEach(function(r){ T.jobs+=r.jobs; T.hours+=r.hours; T.actual+=r.actual; T.otHit+=r.otHit; T.otTotal+=r.otTotal; T.labor+=r.labor; T.commission+=r.commission; });
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
      row('Jobs done', r.jobs)+ row('Standard hrs', num(round2(r.hours)))+ row('Actual hrs (B2)', num(round2(r.actual)))+
      row('Avg std hrs / job', num(r.avgHrs))+ row('Labor billed', peso(r.labor))+ row('Revenue / actual hr', peso(r.revhr))+
      row('Avg labor / job', peso(r.avgLabor))+ row('Commission', peso(r.commission))+'</div>';
  }).join('');
  return '<div class="card"><h2>Mechanic performance review</h2>'+
    '<p class="muted small"><b>How to read.</b> <b class="st-good-t">Efficiency</b> = standard job hrs ÷ actual worked hrs: <span class="st-good-t">green ≥ 100%</span> (beat the estimate), <span class="st-warn-t">amber 85–99%</span>, <span class="st-bad-t">red &lt; 85%</span>; the marker on each bar is the 100% break-even. <b>On-time</b> = finished on/before ETD (green ≥ 90%). <b>Actual hrs</b> is time in status B2 from the log (capped 8h/interval), so keep the log honest for these to mean anything.</p>'+
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
  var list=staff.map(function(s){ var r={ id:s.id, name:s.name, role:s.role, on:(s.commission!==false), jobs:0, hours:0, actual:0, otHit:0, otTotal:0, labor:0, commission:0 }; byId[s.id]=r; return r; });
  jobs.forEach(function(j){
    // Evaluation figure: pool split among EVERYONE assigned, ignoring the payout toggle.
    var cm=jobLaborCommissionMapAll(j,S); var lab=laborTotal(j.lines);
    var mechs=(j.mechanicIds||[]).filter(function(x){return x&&x!=='TBA';});
    // every distinct staff assigned in ANY capacity — job count
    var assigned=[]; mechs.concat([j.saId,j.assessedBy,j.partsSalesman]).forEach(function(x){ if(x&&x!=='TBA'&&assigned.indexOf(x)<0) assigned.push(x); });
    assigned.forEach(function(id){ var r=byId[id]; if(r) r.jobs++; });
    // job hours & labor billed are mechanic productivity metrics — split among mechanics
    var actualH=jobB2Hours(j); var onTime=jobOnTime(j);
    mechs.forEach(function(mid){ var r=byId[mid]; if(!r) return;
      r.hours=round2(r.hours+(Number(j.jobHours)||0)/mechs.length);
      r.labor=round2(r.labor+lab/mechs.length);
      r.actual=round2(r.actual+actualH/mechs.length);
      if(onTime!==null){ r.otTotal++; if(onTime) r.otHit++; }
    });
    Object.keys(cm).forEach(function(id){ var r=byId[id]; if(r) r.commission=round2(r.commission+cm[id]); });
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
    '<p class="muted small">Job hrs = standard hours from the Job Order. Actual hrs = time in status <b>B2</b> from the log (each interval capped at 8h). Efficiency = Job hrs ÷ Actual hrs (green ≥ 100%). On-time = finished on/before ETD (hits/total).</p>'+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Staff</th><th class="r">Jobs</th><th class="r">Job hrs</th><th class="r">Actual hrs</th><th class="r">Efficiency</th><th class="r">On-time</th><th class="r">Labor billed</th><th class="r">Avg/job</th><th class="r">Commission</th><th class="center">Payout</th></tr></thead><tbody>'+(rows||'<tr><td colspan="10" class="muted center">No staff.</td></tr>')+'</tbody></table></div>'+
    mechPerfSection(list)+
    '<div class="card"><h2>Commission by staff</h2>'+(commBars.length?bars(commBars,peso):emptyState('No commissions in this period.'))+'</div></div>';
};

/* ---- Receivables (A/R) ---------------------------------------------------- */
function arJobs(){ return S.jobs.filter(function(j){return (j.stage==='Final Billing'||j.stage==='Released') && jobBalance(j)>0.001;}); }
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
