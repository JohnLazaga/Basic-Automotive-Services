/* ============================================================================
   PART 7 — Reports, Daily Close, Productivity, Receivables
   Commission logic uses jobLaborCommission() everywhere (single source).
   ========================================================================== */

function releasedJobs(){ return S.jobs.filter(function(j){return j.stage==='Released';}); }
function billedJobs(){ return S.jobs.filter(function(j){return j.stage==='Final Billing'||j.stage==='Released';}); }

function jobCostOfParts(j){
  return round2((j.lines||[]).reduce(function(s,l){ if(l.type!=='part'||!l.ref) return s; var p=partById(l.ref); return s+(p?(p.cost||0)*(l.qty||0):0); },0));
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
    '</div></div></div>';
};

/* Commission across a set of jobs.
   Mechanics: labor×rate÷#mechs split evenly (the pool).
   Service Adviser on the job: its own labor×rate (same 5% rate, not split).
   Other roles: their configured commissionBase/rate. */
function commissionTable(jobs){
  var map={};
  function add(id,amt){ if(!id||id==='TBA') return; var s=staffById(id); if(!s) return;
    if(!map[id]) map[id]={ name:s.name, role:s.role, amount:0 }; map[id].amount=round2(map[id].amount+amt); }
  jobs.forEach(function(j){
    var rate=(Number(S.shop.mechCommissionRate)||0)/100;
    var lc=jobLaborCommission(j,S);
    (j.mechanicIds||[]).filter(function(x){return x&&x!=='TBA';}).forEach(function(mid){ add(mid, lc.perMech); });
    // roles attached to the job
    [j.saId, j.assessedBy, j.partsSalesman].forEach(function(sid){
      var s=staffById(sid); if(!s||isMechanicRole(s.role)) return;        // mechanics handled via the pool
      if(s.role==='SA'){ add(sid, round2(laborTotal(j.lines)*rate)); return; }  // Service Adviser: 5% of labor
      if(s.commissionBase==='labor') add(sid, round2(laborTotal(j.lines)*(s.commissionRate||0)/100));
      else if(s.commissionBase==='total') add(sid, round2(jobGross(j)*(s.commissionRate||0)/100));
    });
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
  var net=round2(billed.reduce(function(s,j){return s+jobGross(j);},0));
  var disc=round2(billed.reduce(function(s,j){return s+discountAmount(j);},0));
  var vs=vatSplit(net,S);
  var partsRev=round2(billed.reduce(function(s,j){return s+partsTotal(j.lines);},0));
  var laborRev=round2(billed.reduce(function(s,j){return s+laborTotal(j.lines);},0));
  var comm=commissionTable(billed);

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
      '<div class="card"><h2>Day\'s commissions</h2>'+(comm.length?comm.map(function(c){return line2(esc(c.name),peso(c.amount));}).join(''):emptyState('—'))+'</div>'+
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

VIEWS.productivity = function(){
  var jobs=jobsInProdPeriod(billedJobs());
  var mechs=mechanicStaff().map(function(m){ return { id:m.id, name:m.name, role:m.role, jobs:0, hours:0, labor:0, commission:0 }; });
  var byId={}; mechs.forEach(function(m){byId[m.id]=m;});
  jobs.forEach(function(j){
    var lc=jobLaborCommission(j,S); var lab=laborTotal(j.lines);
    var assigned=(j.mechanicIds||[]).filter(function(x){return x&&x!=='TBA';});
    assigned.forEach(function(mid){ var r=byId[mid]; if(!r) return; r.jobs++; r.hours=round2(r.hours+(Number(j.jobHours)||0)/assigned.length);
      r.labor=round2(r.labor+lab/assigned.length); r.commission=round2(r.commission+lc.perMech); });
  });
  var rows=mechs.map(function(m){
    return '<tr><td><b>'+esc(m.name)+'</b> <span class="muted small">'+esc(roleLabel(m.role))+'</span></td><td class="r">'+m.jobs+'</td><td class="r">'+num(m.hours)+'</td>'+
      '<td class="r">'+peso(m.labor)+'</td><td class="r">'+peso(m.jobs?round2(m.labor/m.jobs):0)+'</td><td class="r"><b>'+peso(m.commission)+'</b></td></tr>';
  }).join('');
  var commBars=mechs.filter(function(m){return m.commission>0;}).map(function(m){return {label:m.name,value:m.commission};});
  var seg=['all','today','week','month','custom'].map(function(p){
    var lab={all:'All time',today:'Today',week:'This week',month:'This month',custom:'Custom'}[p];
    return '<button class="seg-b'+(PROD_PERIOD===p?' on':'')+'" onclick="setProd(\''+p+'\')">'+lab+'</button>';
  }).join('');
  var custom = PROD_PERIOD==='custom' ? '<div class="row gap" style="align-items:center">'+
    '<input type="date" value="'+attr(PROD_FROM)+'" onchange="PROD_FROM=this.value;render()"> <span class="muted">to</span> '+
    '<input type="date" value="'+attr(PROD_TO)+'" onchange="PROD_TO=this.value;render()"></div>' : '';
  return '<div class="page"><div class="page-head"><h1>Mechanic Productivity</h1>'+
    '<button class="btn primary" onclick="printPayout()">⎙ Payout sheet</button></div>'+
    '<div class="row gap" style="align-items:center;flex-wrap:wrap"><div class="seg">'+seg+'</div>'+custom+
      '<span class="muted small">'+esc(prodPeriodLabel())+'</span></div>'+
    '<p class="muted small mt8">All mechanics (Senior & Junior) earn '+(S.shop.mechCommissionRate||5)+'% of labor, split evenly among those assigned to each billed job.</p>'+
    '<div class="card pad0"><table class="tbl"><thead><tr><th>Mechanic</th><th class="r">Jobs</th><th class="r">Job hrs</th><th class="r">Labor billed</th><th class="r">Avg/job</th><th class="r">Commission</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="muted center">No mechanics.</td></tr>')+'</tbody></table></div>'+
    '<div class="card"><h2>Commission by mechanic</h2>'+(commBars.length?bars(commBars,peso):emptyState('No commissions in this period.'))+'</div></div>';
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
