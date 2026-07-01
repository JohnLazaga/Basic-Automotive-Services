/* ============================================================================
   PART 3 — Operations Board (Kanban / List / Bay grid) + Appointments
   ========================================================================== */

var BOARD_MODE = 'kanban'; // kanban | list | bays
function setBoardMode(m){ BOARD_MODE=m; render(); }

/* ---- Update-due detection ------------------------------------------------- */
function lastCheckpointDue(){
  var cps = (S.shop.checkpoints||[]).slice().sort();
  var now = new Date(); var hm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  var due=null;
  cps.forEach(function(cp){ if (cp<=hm) due=cp; });
  return due; // most recent checkpoint passed today, or null
}
function isUpdateDue(job){
  if (job.stage!=='Job Order' || statusGroup(job.status)==='C') return false;
  var cp = lastCheckpointDue(); if(!cp) return false;
  var log = job.statusLog||[]; if(!log.length) return true;
  var lastTime = new Date(log[log.length-1].time);
  var today = new Date(); var cpDate = new Date(today.getFullYear(),today.getMonth(),today.getDate(),
    parseInt(cp.slice(0,2),10), parseInt(cp.slice(3),10));
  return lastTime < cpDate;
}

function alertStrip(){
  var alerts=[];
  // PMS reminders
  var today = todayISO();
  S.vehicles.forEach(function(v){
    if (v.nextServiceDate && v.nextServiceDate <= todayISO(new Date(Date.now()+14*86400000))){
      var due = v.nextServiceDate < today;
      alerts.push({ kind:due?'due':'soon', text:(due?'PMS overdue':'PMS due soon')+': '+v.plate+' ('+v.make+' '+v.model+') · '+fmtDate(v.nextServiceDate),
        act:"go('vehicle','"+v.id+"')" });
    }
  });
  // low stock
  S.parts.forEach(function(p){
    if ((p.stock||0) <= (p.reorder||0)) alerts.push({ kind:'low', text:'Low stock: '+p.name+' ('+p.stock+' left)', act:"go('parts')" });
  });
  if (!alerts.length) return '';
  return '<div class="alertstrip">'+alerts.slice(0,6).map(function(a){
    return '<button class="alert a-'+a.kind+'" onclick="'+a.act+'">'+esc(a.text)+'</button>';
  }).join('')+ (alerts.length>6?'<span class="alert-more">+'+(alerts.length-6)+' more</span>':'') +'</div>';
}

/* ---- KPI header ----------------------------------------------------------- */
function boardKPIs(){
  var active = S.jobs.filter(function(j){return j.stage!=='Released';});
  var wip = round2(active.reduce(function(s,j){return s+jobGross(j);},0));
  var dueCount = active.filter(isUpdateDue).length;
  var released = S.jobs.filter(function(j){return j.stage==='Released';});
  var todayRev = round2(released.filter(function(j){return j.payments&&j.payments.some(function(p){return (p.date||'').slice(0,10)===todayISO();});})
    .reduce(function(s,j){return s+jobPaid(j);},0));
  return '<div class="kpis">'+
    kpi('Active units', active.length, dueCount?dueCount+' need update':'all current') +
    kpi('Open WIP value', peso(wip)) +
    kpi('Updates due', dueCount, dueCount?'<span class="amber">needs clipboard</span>':'all current') +
    kpi("Today's collections", peso(todayRev)) +
  '</div>';
}

/* ---- Board view ----------------------------------------------------------- */
var BOARD_Q='';
function boardMatch(j){
  if(!BOARD_Q) return true; var q=BOARD_Q.toLowerCase();
  return [j.plate,j.owner,j.contactPerson].some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
function boardBody(){
  var active = S.jobs.filter(function(j){return j.stage!=='Released';}).filter(boardMatch);
  if(BOARD_Q && !active.length) return emptyState('No active units match “'+esc(BOARD_Q)+'”.');
  return BOARD_MODE==='kanban'? boardKanban(active) : BOARD_MODE==='bays'? boardBays(active) : boardList(active);
}
function boardSearch(v){ BOARD_Q=v; var el=document.getElementById('boardBody'); if(el) el.innerHTML=boardBody(); }
VIEWS.board = function(){
  var toggle = '<div class="seg">'+
    ['kanban','list','bays'].map(function(m){
      var on=BOARD_MODE===m?' on':''; var lab={kanban:'Kanban',list:'List',bays:'Service Bays'}[m];
      return '<button class="seg-b'+on+'" onclick="setBoardMode(\''+m+'\')">'+lab+'</button>';
    }).join('')+'</div>';
  var search='<input class="searchbox" id="boardSearch" value="'+attr(BOARD_Q)+'" oninput="boardSearch(this.value)" placeholder="Search plate / owner / contact…" autocomplete="off">';
  return '<div class="page">'+
    '<div class="page-head"><h1>Operations Board</h1><div class="row gap wrap">'+search+toggle+'</div></div>'+
    alertStrip()+ boardKPIs()+ '<div id="boardBody">'+boardBody()+'</div>'+
  '</div>';
};

/* Time of the most recent status/clipboard log entry for a job (or '—'). */
function lastLogTimeLabel(j){
  var log=j.statusLog||[]; if(!log.length) return '—';
  return fmtDateTime(log[log.length-1].time);
}
function jobCardMini(j){
  var due = isUpdateDue(j);
  return '<div class="jcard" onclick="go(\'job\',\''+j.id+'\')">'+
    '<div class="jcard-top">'+statusBadge(j.status)+'<span class="plate">'+esc(j.plate)+'</span>'+
      (due?'<span class="duedot" title="Update due">●</span>':'')+'</div>'+
    '<div class="jcard-veh">'+esc(j.year+' '+j.make+' '+j.model)+'</div>'+
    '<div class="jcard-meta"><span>'+esc(bayName(j.bayId))+'</span><span>'+esc(mechName(j.mechanicIds))+'</span></div>'+
    '<div class="jcard-meta"><span class="muted small">⏱ last log '+esc(lastLogTimeLabel(j))+'</span></div>'+
    '<div class="jcard-foot"><span class="muted">'+esc(j.no)+'</span><span class="bill">'+peso(jobGross(j))+'</span></div>'+
  '</div>';
}
function boardKanban(active){
  var cols=['A','B','C'];
  return '<div class="kanban">'+cols.map(function(g){
    var inCol = active.filter(function(j){return statusGroup(j.status)===g;});
    return '<div class="kcol"><div class="kcol-head"><b>'+g+'</b> '+esc(STATUS_GROUP_NAME[g])+
      '<span class="kcount">'+inCol.length+'</span></div>'+
      '<div class="kcol-body">'+(inCol.length?inCol.map(jobCardMini).join(''):emptyState('No units'))+'</div></div>';
  }).join('')+'</div>';
}
function boardList(active){
  if(!active.length) return emptyState('No active units. Create a Job Order from Appointments or Ingress.');
  var rows = active.map(function(j){
    var due=isUpdateDue(j);
    return '<tr onclick="go(\'job\',\''+j.id+'\')">'+
      '<td><b>'+esc(j.no)+'</b></td><td>'+esc(j.plate)+'</td>'+
      '<td>'+esc(j.make+' '+j.model)+'</td>'+
      '<td>'+statusBadge(j.status)+(due?' <span class="amber">⚑ due</span>':'')+'</td>'+
      '<td>'+esc(bayName(j.bayId))+'</td>'+
      '<td>'+esc(mechName(j.mechanicIds))+'</td>'+
      '<td>'+esc(lastLogTimeLabel(j))+'</td>'+
      '<td>'+esc(fmtDate(j.etd))+'</td>'+
      '<td class="r">'+peso(jobGross(j))+'</td></tr>';
  }).join('');
  return '<div class="card pad0"><table class="tbl click">'+
    '<thead><tr><th>JO #</th><th>Plate</th><th>Vehicle</th><th>Status</th><th>Bay</th><th>Mechanic(s)</th><th>Last log</th><th>ETD</th><th class="r">Running bill</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}
function boardBays(active){
  var byBay = {}; active.forEach(function(j){ var k=j.bayId||'TBA'; (byBay[k]=byBay[k]||[]).push(j); });
  var cells = S.bays.map(function(b){
    var jobs = byBay[b.id]||[];
    return '<div class="baycell"><div class="bay-name">'+esc(b.name)+'</div>'+
      (jobs.length? jobs.map(function(j){ return '<div class="bay-car" onclick="go(\'job\',\''+j.id+'\')">'+
        '🚗 '+esc(j.plate)+' '+statusBadge(j.status)+'<div class="muted small">'+esc(j.make+' '+j.model)+'</div></div>'; }).join('')
        : '<div class="bay-empty">Empty</div>')+'</div>';
  }).join('');
  var noBay = (byBay['TBA']||[]);
  var none = '<div class="baycell nobay"><div class="bay-name">Not yet in a bay</div>'+
    (noBay.length? noBay.map(function(j){ return '<div class="bay-car" onclick="go(\'job\',\''+j.id+'\')">🚗 '+esc(j.plate)+' '+statusBadge(j.status)+'</div>'; }).join('')
      : '<div class="bay-empty">—</div>')+'</div>';
  return '<div class="baygrid">'+cells+none+'</div>';
}

/* ============================================================================
   APPOINTMENTS
   ========================================================================== */
var CAL = { y:null, m:null }; // current calendar month
function calInit(){ if(CAL.y===null){ var d=new Date(); CAL.y=d.getFullYear(); CAL.m=d.getMonth(); } }
function calShift(delta){ calInit(); CAL.m+=delta; if(CAL.m<0){CAL.m=11;CAL.y--;} if(CAL.m>11){CAL.m=0;CAL.y++;} render(); }
function calToday(){ var d=new Date(); CAL.y=d.getFullYear(); CAL.m=d.getMonth(); render(); }

var APPT_COLORS={ Booked:'#6E6E73', Confirmed:'#0a84ff', Arrived:'#34c759', 'No-show':'#FFC000', Cancelled:'#c7c7cc' };

VIEWS.appointments = function(){
  calInit();
  var first = new Date(CAL.y, CAL.m, 1);
  var startDow = first.getDay();
  var days = new Date(CAL.y, CAL.m+1, 0).getDate();
  var monthName = first.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  var cells='';
  for (var i=0;i<startDow;i++) cells+='<div class="cal-cell empty"></div>';
  for (var d=1; d<=days; d++){
    var iso = CAL.y+'-'+String(CAL.m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var ap = S.appointments.filter(function(a){return a.date===iso && a.status!=='Cancelled';});
    var isToday = iso===todayISO();
    var chips = ap.slice(0,3).map(function(a){
      return '<div class="cal-chip" style="background:'+APPT_COLORS[a.status]+'" onclick="event.stopPropagation();editAppt(\''+a.id+'\')">'+
        esc(a.time+' '+(a.plate||a.customer))+'</div>';
    }).join('') + (ap.length>3?'<div class="cal-more">+'+(ap.length-3)+'</div>':'');
    cells+='<div class="cal-cell'+(isToday?' today':'')+'" onclick="newAppt(\''+iso+'\')">'+
      '<div class="cal-d">'+d+'</div>'+chips+'</div>';
  }
  var dows=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(x){return '<div class="cal-dow">'+x+'</div>';}).join('');
  var upcoming = S.appointments.filter(function(a){return a.date>=todayISO() && a.status!=='Cancelled' && a.status!=='Arrived';})
    .sort(function(a,b){return (a.date+a.time)<(b.date+b.time)?-1:1;}).slice(0,8);
  var upList = upcoming.length? upcoming.map(function(a){
    return '<div class="up-row"><div><b>'+esc(fmtDate(a.date))+' '+esc(a.time)+'</b> · '+esc(a.customer)+
      ' <span class="muted">'+esc(a.vehicle||a.plate)+'</span></div>'+
      '<div class="up-act">'+chip(a.status)+
      (a.jobId? '<button class="btn xs" onclick="go(\'job\',\''+a.jobId+'\')">Open JO</button>'
        : '<button class="btn xs primary" onclick="checkInAppt(\''+a.id+'\')">Check in</button>')+
      '<button class="btn xs ghost" onclick="editAppt(\''+a.id+'\')">Edit</button></div></div>';
  }).join('') : emptyState('No upcoming appointments.');

  return '<div class="page">'+
    '<div class="page-head"><h1>Appointments</h1>'+
      '<div class="row gap"><button class="btn ghost" onclick="calShift(-1)">‹</button>'+
      '<button class="btn ghost" onclick="calToday()">Today</button>'+
      '<button class="btn ghost" onclick="calShift(1)">›</button>'+
      '<button class="btn primary" onclick="newAppt()">＋ Book</button></div></div>'+
    '<div class="cal-month">'+esc(monthName)+'</div>'+
    '<div class="card pad0"><div class="cal-grid">'+dows+cells+'</div></div>'+
    '<h2 class="sec">Upcoming</h2><div class="card">'+upList+'</div>'+
  '</div>';
};

function apptForm(a){
  a = a || {};
  return '<div class="grid2">'+
    field('Date','<input id="apDate" type="date" value="'+attr(a.date||todayISO())+'">')+
    field('Time','<input id="apTime" type="time" value="'+attr(a.time||'09:00')+'">')+
    field('Plate','<input id="apPlate" value="'+attr(a.plate||'')+'" oninput="apLookup()" placeholder="ABC 1234">')+
    field('Customer','<input id="apCust" value="'+attr(a.customer||'')+'">')+
    field('Contact #','<input id="apContact" value="'+attr(a.contactNumber||'')+'">')+
    field('Vehicle','<input id="apVeh" value="'+attr(a.vehicle||'')+'" placeholder="2019 Toyota Vios">')+
    field('Service','<input id="apSvc" value="'+attr(a.service||'')+'">')+
    field('Service Adviser','<select id="apSA">'+optionList(staffByRole('SA'),a.assignedTo,true)+'</select>')+
    field('Bay','<select id="apBay">'+optionList(S.bays,a.bayId,true)+'</select>')+
    field('Status','<select id="apStatus">'+['Booked','Confirmed','Arrived','No-show','Cancelled'].map(function(s){
      return '<option'+(a.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select>')+
    '</div>'+
    field('Notes','<textarea id="apNotes" rows="2">'+esc(a.notes||'')+'</textarea>');
}
function apLookup(){ var v=vehicleByPlate(val('apPlate')); if(v){ setVal('apCust',v.owner); setVal('apContact',v.contactNumber);
  setVal('apVeh', v.year+' '+v.make+' '+v.model); } }
function newAppt(date){
  openModal('Book appointment', apptForm({ date:date }), { onOk:'saveAppt', okText:'Book' });
}
function editAppt(id){
  var a=S.appointments.find(function(x){return x.id===id;}); if(!a) return;
  openModal('Edit appointment', apptForm(a), {
    footer:'<button class="btn danger ghost" onclick="delAppt(\''+id+'\')">Delete</button>'+
      '<span style="flex:1"></span><button class="btn ghost" onclick="closeModal()">Cancel</button>'+
      '<button class="btn primary" onclick="saveAppt(\''+id+'\')">Save</button>' });
}
function saveAppt(id){
  var data={ date:val('apDate'), time:val('apTime'), plate:val('apPlate'), customer:val('apCust'),
    contactNumber:val('apContact'), vehicle:val('apVeh'), service:val('apSvc'), assignedTo:val('apSA'),
    bayId:val('apBay'), status:val('apStatus'), notes:val('apNotes') };
  if (id){ var a=S.appointments.find(function(x){return x.id===id;}); Object.assign(a,data); }
  else { data.id=uid('ap'); data.jobId=null; S.appointments.push(data); }
  persist(); closeModal(); toast('Appointment saved'); render();
}
function delAppt(id){ S.appointments=S.appointments.filter(function(x){return x.id!==id;}); persist(); closeModal(); render(); }
function checkInAppt(id){
  var a=S.appointments.find(function(x){return x.id===id;}); if(!a) return;
  var job = createJobFromAppt(a);
  a.status='Arrived'; a.jobId=job.id; persist();
  toast('Checked in · '+job.no+' created'); go('job', job.id);
}

function field(label, control, hint){
  return '<label class="fld"><span class="fld-l">'+esc(label)+'</span>'+control+
    (hint?'<span class="fld-h">'+esc(hint)+'</span>':'')+'</label>';
}
