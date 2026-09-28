/* ============================================================================
   PART 17 — Operating expenses & business P&L (per branch)

   Job-level profit (revenue − parts cost − commission, part7) says what each
   job earns; it says nothing about rent, power, salaries and the rest of what
   it costs to keep the doors open. This module records those costs and puts
   them against the month's job profit for a true net figure.

   Everything lives in ONE collection, `expenses`, as three kinds of record:
     expense    one-off cost on a date             {date, category, desc, amount, method, ref}
     recurring  fixed monthly cost, auto-posted    {category, desc, amount, startMonth, endMonth}
     pay        a staff member's base pay          {staffId, name, basis:'month'|'day', amount,
                                                    daysPerMonth, from}
   Base pay is kept here, NOT on the staff record: every signed-in account can
   read `staff`, while `expenses` is readable only by admins and the Secretary
   (firestore.rules) — and the collection is only synced for those users
   (syncCollections in part11). A raise is a NEW pay record with a later `from`
   month, so past months keep the pay that applied then.

   Access: admins and the Secretary (Accounts) record expenses and pay; the P&L
   itself is admin-only, like every other profit figure (canSeeProfit).
   ========================================================================== */

var EXPENSE_CATEGORIES = ['Rent','Electricity','Water','Internet & phone','Government contributions',
  'Supplies','Repairs & maintenance','Fuel & transport','Taxes & permits','Marketing',
  'Loan amortization','Miscellaneous'];
var PAYROLL_CATEGORY = 'Salaries (base pay)';
var EXPENSE_METHODS = ['Cash','GCash','Bank transfer','Card','Check'];
var DEFAULT_WORK_DAYS = 26;

/* Admins and the Secretary. A hard gate, matching the database rule — not a
   grantable capability, because the rule cannot read the permission matrix.
   Pre-auth / local / tests: true, like can(). */
function canFinance(){
  if (typeof CURRENT_USER==='undefined' || !CURRENT_USER) return true;
  return !!CURRENT_USER.isAdmin || CURRENT_USER.role==='Secretary';
}

function monthOf(d){ return String(d||'').slice(0,7); }
function expRecords(kind){ return (S.expenses||[]).filter(function(x){ return x && x.kind===kind; }); }
function fmtMonth(m){
  if(!/^\d{4}-\d{2}$/.test(m||'')) return m||'—';
  var names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[Number(m.slice(5))-1]+' '+m.slice(0,4);
}
function addMonths(m, n){
  var y=Number(m.slice(0,4)), mo=Number(m.slice(5))-1+n;
  y+=Math.floor(mo/12); mo=((mo%12)+12)%12;
  return y+'-'+String(mo+1).padStart(2,'0');
}

/* ---- What a month costs --------------------------------------------------- */
function recurringFor(m){
  return expRecords('recurring').filter(function(r){
    return r.startMonth && r.startMonth<=m && (!r.endMonth || m<=r.endMonth);
  });
}
function oneOffFor(m){ return expRecords('expense').filter(function(e){ return monthOf(e.date)===m; }); }
/* The pay record in force for a staff member in month m: the latest `from` on or
   before m (ties → the most recently saved). Amount 0 = no base pay. */
function payFor(staffId, m){
  var best=null;
  expRecords('pay').forEach(function(p){
    if(p.staffId!==staffId || !p.from || p.from>m) return;
    if(!best || p.from>best.from || (p.from===best.from && String(p.at||'')>String(best.at||''))) best=p;
  });
  return best;
}
function monthlyPay(p){
  if(!p) return 0;
  var a=Number(p.amount)||0;
  return round2(p.basis==='day' ? a*(Number(p.daysPerMonth)||DEFAULT_WORK_DAYS) : a);
}
/* Base pay per person for month m — everyone who has ever had a pay record,
   so a staff record deleted later still shows under the name it was paid as. */
function payrollFor(m){
  var ids={}; expRecords('pay').forEach(function(p){ ids[p.staffId]=1; });
  return Object.keys(ids).map(function(id){
    var p=payFor(id, m), s=staffById(id);
    return { staffId:id, name:(s&&s.name)||(p&&p.name)||'—', role:(s&&s.role)||'', pay:p, amount:monthlyPay(p) };
  }).filter(function(r){ return r.amount>0; });
}
/* Operating expenses for month m, grouped by category. */
function opexFor(m){
  var byCat={}, total=0;
  function add(cat, amt){ amt=Number(amt)||0; if(!amt) return; byCat[cat]=round2((byCat[cat]||0)+amt); total=round2(total+amt); }
  recurringFor(m).forEach(function(r){ add(r.category||'Miscellaneous', r.amount); });
  oneOffFor(m).forEach(function(e){ add(e.category||'Miscellaneous', e.amount); });
  payrollFor(m).forEach(function(p){ add(PAYROLL_CATEGORY, p.amount); });
  return { byCat:byCat, total:total };
}
/* Month P&L. Job side uses the same released-job, ex-VAT figures as Reports,
   bucketed by the month the job was billed (the Revenue-by-month basis). */
function plFor(m){
  var rel=releasedJobs().filter(function(j){ return localDay(j.billedAt||j.dateIn).slice(0,7)===m; });
  var rev=0, parts=0, comm=0;
  rel.forEach(function(j){ rev+=jobRevenueExVat(j); parts+=jobCostOfParts(j); comm+=jobLaborCommission(j,S).pool; });
  rev=round2(rev); parts=round2(parts); comm=round2(comm);
  var gross=round2(rev-parts-comm), opex=opexFor(m), net=round2(gross-opex.total);
  return { month:m, jobs:rel.length, revenue:rev, partsCost:parts, commission:comm, gross:gross,
    opex:opex, net:net, margin: rev ? Math.round(net/rev*100) : 0 };
}

/* ---- Page ----------------------------------------------------------------- */
var EXP_MONTH='';
function expMonth(){ return EXP_MONTH || todayISO().slice(0,7); }
/* A <select> of months, not <input type=month>: a native month box fires change
   mid-typing and a re-render would replace it under the cursor. */
function monthSelect(id, sel, onchange, allowBlank){
  var now=todayISO().slice(0,7), opts=[];
  for(var i=12;i>=-36;i--) opts.push(addMonths(now,i));
  if(sel && opts.indexOf(sel)<0) opts.push(sel);
  return '<select id="'+id+'" style="width:auto"'+(onchange?' onchange="'+onchange+'"':'')+'>'+
    (allowBlank?'<option value="">— no end —</option>':'')+
    opts.map(function(m){ return '<option value="'+m+'"'+(m===sel?' selected':'')+'>'+fmtMonth(m)+'</option>'; }).join('')+
  '</select>';
}
VIEWS.expenses = function(){
  if(!canFinance()) return '<div class="page">'+emptyState('Expenses are for admins and the Secretary.')+'</div>';
  var m=expMonth();
  return '<div class="page"><div class="page-head"><h1>Expenses &amp; P&amp;L</h1><div class="row gap wrap">'+
      '<button class="btn sm ghost" onclick="EXP_MONTH=addMonths(expMonth(),-1);render()">‹</button>'+
      monthSelect('expMonthSel', m, 'EXP_MONTH=this.value;render()')+
      '<button class="btn sm ghost" onclick="EXP_MONTH=addMonths(expMonth(),1);render()">›</button>'+
      '<button class="btn primary" onclick="openExpense()">＋ Add expense</button></div></div>'+
    (canSeeProfit()? plCard(m) : '')+
    expensesCard(m)+
    recurringCard(m)+
    payrollCard(m)+
  '</div>';
};
function plCard(m){
  var p=plFor(m);
  var cats=Object.keys(p.opex.byCat).sort(function(a,b){ return p.opex.byCat[b]-p.opex.byCat[a]; });
  var trend=[]; for(var i=5;i>=0;i--) trend.push(plFor(addMonths(m,-i)));
  return '<div class="card"><h2>Profit &amp; loss · '+esc(fmtMonth(m))+' <span class="muted small">· ex-VAT · '+p.jobs+' released job'+(p.jobs===1?'':'s')+'</span></h2>'+
    '<div class="kpis">'+kpi('Gross profit (jobs)',peso(p.gross))+kpi('Operating expenses',peso(p.opex.total))+
      kpi('Net profit','<span class="'+(p.net<0?'st-bad-t':'st-good-t')+'">'+peso(p.net)+'</span>', p.margin+'% of revenue')+'</div>'+
    line2('Revenue (ex-VAT)',peso(p.revenue))+line2('− Parts cost',peso(p.partsCost))+line2('− Labor commission',peso(p.commission))+
    line2('Gross profit from jobs','<b>'+peso(p.gross)+'</b>')+
    '<div class="bill-sep"></div>'+
    (cats.length ? cats.map(function(c){ return line2('− '+esc(c),peso(p.opex.byCat[c])); }).join('') : '<div class="muted small">No expenses recorded for this month.</div>')+
    line2('Operating expenses','<b>'+peso(p.opex.total)+'</b>')+
    '<div class="bill-sep"></div>'+
    line2('Net profit','<b class="'+(p.net<0?'st-bad-t':'st-good-t')+'">'+peso(p.net)+'</b>')+
    '<table class="tbl sm mt8"><thead><tr><th>Month</th><th class="r">Gross profit</th><th class="r">Expenses</th><th class="r">Net profit</th></tr></thead><tbody>'+
      trend.map(function(t){ return '<tr><td>'+esc(fmtMonth(t.month))+'</td><td class="r">'+peso(t.gross)+'</td><td class="r">'+peso(t.opex.total)+'</td>'+
        '<td class="r '+(t.net<0?'st-bad-t':'')+'">'+peso(t.net)+'</td></tr>'; }).join('')+
    '</tbody></table>'+
    '<p class="muted small mt8">Gross profit = ex-VAT revenue of jobs released that month − parts cost − labor commission (same as Reports). '+
      'Operating expenses = recurring items + one-off expenses dated that month + base pay. Commission is already in gross profit, so base pay excludes it.</p></div>';
}
function expensesCard(m){
  var list=oneOffFor(m).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var total=round2(list.reduce(function(s,e){ return s+(Number(e.amount)||0); },0));
  return '<div class="card"><div class="card-head"><h2>One-off expenses · '+esc(fmtMonth(m))+'</h2><span class="muted small">'+peso(total)+'</span></div>'+
    (list.length ? '<table class="tbl sm"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid via</th><th class="r">Amount</th><th></th></tr></thead><tbody>'+
      list.map(function(e){ return '<tr><td>'+esc(fmtDate(e.date))+'</td><td>'+esc(e.category)+'</td><td>'+esc(e.desc||'')+(e.ref?' <span class="muted small">'+esc(e.ref)+'</span>':'')+'</td>'+
        '<td>'+esc(e.method||'')+'</td><td class="r">'+peso(e.amount)+'</td>'+
        '<td class="r"><button class="btn sm ghost" onclick="openExpense(\''+e.id+'\')">Edit</button></td></tr>'; }).join('')+
      '</tbody></table>' : emptyState('No one-off expenses this month.'))+'</div>';
}
function recurringCard(m){
  var all=expRecords('recurring').sort(function(a,b){ return String(a.category).localeCompare(String(b.category)); });
  var on=recurringFor(m), onIds={}; on.forEach(function(r){ onIds[r.id]=1; });
  var total=round2(on.reduce(function(s,r){ return s+(Number(r.amount)||0); },0));
  return '<div class="card"><div class="card-head"><h2>Recurring monthly expenses</h2><div class="row gap">'+
      '<span class="muted small">'+peso(total)+' in '+esc(fmtMonth(m))+'</span>'+
      '<button class="btn sm ghost" onclick="openRecurring()">＋ Add recurring</button></div></div>'+
    (all.length ? '<table class="tbl sm"><thead><tr><th>Category</th><th>Description</th><th>Runs</th><th class="r">Per month</th><th></th></tr></thead><tbody>'+
      all.map(function(r){ return '<tr'+(onIds[r.id]?'':' class="muted"')+'><td>'+esc(r.category)+'</td><td>'+esc(r.desc||'')+'</td>'+
        '<td>'+esc(fmtMonth(r.startMonth))+' – '+(r.endMonth?esc(fmtMonth(r.endMonth)):'ongoing')+'</td><td class="r">'+peso(r.amount)+'</td>'+
        '<td class="r"><button class="btn sm ghost" onclick="openRecurring(\''+r.id+'\')">Edit</button></td></tr>'; }).join('')+
      '</tbody></table>' : emptyState('Add rent, internet, loan amortization and other fixed monthly costs once — they count every month automatically.'))+'</div>';
}
function payrollCard(m){
  var staff=(S.staff||[]).slice().sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
  var total=0;
  var rows=staff.map(function(s){
    var p=payFor(s.id, m), amt=monthlyPay(p); total+=amt;
    var basis=!p||!Number(p.amount) ? '<span class="muted">not set</span>'
      : p.basis==='day' ? peso(p.amount)+'/day × '+(Number(p.daysPerMonth)||DEFAULT_WORK_DAYS)+' days' : peso(p.amount)+'/month';
    return '<tr><td>'+esc(s.name)+' <span class="muted small">'+esc(roleLabel(s.role))+'</span></td><td>'+basis+
      (p&&p.from?' <span class="muted small">since '+esc(fmtMonth(p.from))+'</span>':'')+'</td>'+
      '<td class="r">'+(amt?peso(amt):'—')+'</td><td class="r"><button class="btn sm ghost" onclick="openPay(\''+s.id+'\')">Set pay</button></td></tr>';
  }).join('');
  return '<div class="card"><div class="card-head"><h2>Base pay · '+esc(fmtMonth(m))+'</h2><span class="muted small">'+peso(round2(total))+'</span></div>'+
    '<p class="muted small">Fixed salary or daily rate only. Commissions are computed from jobs and already counted in gross profit — don\'t include them here. '+
      'Employer SSS / PhilHealth / Pag-IBIG shares go under recurring expenses (Government contributions).</p>'+
    (staff.length ? '<table class="tbl sm"><thead><tr><th>Staff</th><th>Base pay</th><th class="r">Per month</th><th></th></tr></thead><tbody>'+rows+
      '</tbody></table>' : emptyState('No staff yet.'))+'</div>';
}

/* ---- Dialogs -------------------------------------------------------------- */
var _expCtx=null;
function categorySelect(id, sel){
  return '<select id="'+id+'">'+EXPENSE_CATEGORIES.map(function(c){ return '<option'+(c===sel?' selected':'')+'>'+esc(c)+'</option>'; }).join('')+'</select>';
}
function openExpense(id){
  if(!canFinance()){ toast('Admins and the Secretary only','err'); return; }
  var e=id ? (S.expenses||[]).find(function(x){ return x.id===id; }) : null;
  _expCtx=id||null; e=e||{};
  var m=expMonth(), today=todayISO();
  var dflt=e.date || (m===today.slice(0,7) ? today : m+'-01');
  openModal(id?'Edit expense':'Add expense',
    '<div class="grid2">'+
      field('Date','<input id="exDate" type="date" value="'+attr(dflt)+'">')+
      field('Category',categorySelect('exCat', e.category||'Supplies'))+
      field('Description','<input id="exDesc" value="'+attr(e.desc||'')+'" placeholder="e.g. Shop rags, aircon repair">')+
      field('Amount (₱)','<input id="exAmt" type="number" step="0.01" min="0" value="'+attr(e.amount!=null?e.amount:'')+'">')+
      field('Paid via','<select id="exMethod">'+EXPENSE_METHODS.map(function(x){ return '<option'+(x===(e.method||'Cash')?' selected':'')+'>'+x+'</option>'; }).join('')+'</select>')+
      field('Reference','<input id="exRef" value="'+attr(e.ref||'')+'" placeholder="receipt / invoice #">')+
    '</div>',
    { footer:(id?'<button class="btn ghost" onclick="deleteExpenseRec(\''+id+'\')">Delete</button><span style="flex:1"></span>':'')+
        '<button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveExpense()">Save</button>', width:'560px' });
}
function saveExpense(){
  var amt=Number(val('exAmt'))||0, date=val('exDate');
  if(!date){ toast('Pick the date','err'); return; }
  if(!(amt>0)){ toast('Enter the amount','err'); return; }
  var data={ kind:'expense', date:date, category:val('exCat'), desc:val('exDesc'), amount:round2(amt),
    method:val('exMethod'), ref:val('exRef'), by:expBy(), at:new Date().toISOString() };
  upsertExpenseRec(_expCtx, data);
  EXP_MONTH=monthOf(date);
  closeModal(); toast('Expense saved'); render();
}
function openRecurring(id){
  if(!canFinance()){ toast('Admins and the Secretary only','err'); return; }
  var r=id ? (S.expenses||[]).find(function(x){ return x.id===id; }) : null;
  _expCtx=id||null; r=r||{};
  openModal(id?'Edit recurring expense':'Add recurring expense',
    '<div class="grid2">'+
      field('Category',categorySelect('rcCat', r.category||'Rent'))+
      field('Description','<input id="rcDesc" value="'+attr(r.desc||'')+'" placeholder="e.g. Shop lease, PLDT fiber">')+
      field('Amount per month (₱)','<input id="rcAmt" type="number" step="0.01" min="0" value="'+attr(r.amount!=null?r.amount:'')+'">')+
      '<div></div>'+
      field('Starts',monthSelect('rcStart', r.startMonth||expMonth()))+
      field('Ends (last month it applies)',monthSelect('rcEnd', r.endMonth||'', '', true))+
    '</div><p class="muted small">To stop a cost, set the last month it applies rather than deleting it — earlier months keep counting it.</p>',
    { footer:(id?'<button class="btn ghost" onclick="deleteExpenseRec(\''+id+'\')">Delete</button><span style="flex:1"></span>':'')+
        '<button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveRecurring()">Save</button>', width:'560px' });
}
function saveRecurring(){
  var amt=Number(val('rcAmt'))||0, start=val('rcStart'), end=val('rcEnd');
  if(!(amt>0)){ toast('Enter the monthly amount','err'); return; }
  if(end && end<start){ toast('The end month is before the start month','err'); return; }
  upsertExpenseRec(_expCtx, { kind:'recurring', category:val('rcCat'), desc:val('rcDesc'), amount:round2(amt),
    startMonth:start, endMonth:end||'', by:expBy(), at:new Date().toISOString() });
  closeModal(); toast('Recurring expense saved'); render();
}
function openPay(staffId){
  if(!canFinance()){ toast('Admins and the Secretary only','err'); return; }
  var s=staffById(staffId); if(!s) return;
  var m=expMonth(), p=payFor(staffId, m)||{};
  _expCtx=staffId;
  openModal('Base pay · '+s.name,
    '<div class="grid2">'+
      field('Paid','<select id="pyBasis" onchange="var d=document.getElementById(\'pyDaysF\'); if(d) d.style.display=this.value===\'day\'?\'\':\'none\'">'+
        '<option value="month"'+(p.basis!=='day'?' selected':'')+'>Monthly salary</option>'+
        '<option value="day"'+(p.basis==='day'?' selected':'')+'>Daily rate</option></select>')+
      field('Amount (₱)','<input id="pyAmt" type="number" step="0.01" min="0" value="'+attr(p.amount!=null?p.amount:'')+'" placeholder="0 = no base pay">')+
      '<div id="pyDaysF"'+(p.basis==='day'?'':' style="display:none"')+'>'+
        field('Working days per month','<input id="pyDays" type="number" step="1" min="1" max="31" value="'+attr(p.daysPerMonth||DEFAULT_WORK_DAYS)+'">')+'</div>'+
      field('Effective from',monthSelect('pyFrom', m))+
    '</div><p class="muted small">A change applies from the chosen month onward; earlier months keep the old pay.</p>',
    { footer:'<button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="savePay()">Save</button>', width:'520px' });
}
function savePay(){
  var s=staffById(_expCtx); if(!s) return;
  var amt=Number(val('pyAmt'))||0, basis=val('pyBasis')==='day'?'day':'month';
  if(amt<0){ toast('Pay cannot be negative','err'); return; }
  var from=val('pyFrom');
  /* Same staff + same month → replace that record; a new month → a new record (history). */
  var same=expRecords('pay').find(function(p){ return p.staffId===s.id && p.from===from; });
  upsertExpenseRec(same?same.id:null, { kind:'pay', staffId:s.id, name:s.name, basis:basis, amount:round2(amt),
    daysPerMonth: basis==='day' ? (Number(val('pyDays'))||DEFAULT_WORK_DAYS) : '', from:from, by:expBy(), at:new Date().toISOString() });
  closeModal(); toast('Base pay saved for '+s.name); render();
}
function expBy(){ return (typeof CURRENT_USER!=='undefined' && CURRENT_USER) ? (CURRENT_USER.name||CURRENT_USER.email||'') : ''; }
function upsertExpenseRec(id, data){
  if(!Array.isArray(S.expenses)) S.expenses=[];
  var rec=id ? S.expenses.find(function(x){ return x.id===id; }) : null;
  if(rec) Object.assign(rec, data); else { data.id=uid('ex'); S.expenses.push(data); }
  persist();
}
function deleteExpenseRec(id){
  if(!canFinance()){ toast('Admins and the Secretary only','err'); return; }
  S.expenses=(S.expenses||[]).filter(function(x){ return x.id!==id; });
  persist(); closeModal(); toast('Deleted'); render();
}
