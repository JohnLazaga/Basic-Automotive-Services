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

/* ---- PMS reminders ---------------------------------------------------------
   A reminder is only meaningful for a unit whose PMS was actually performed
   here. A job "performed PMS" when its tablet checklist was completed OR it
   billed the reserved PMS LABOR line (shops that skip the checklist still bill
   PMS). Anything else — a plain repair, a manually typed date — never prompts. */
function jobPerformedPms(j){
  if(!j) return false;
  if(j.pms && j.pms.status==='done') return true;
  return (j.lines||[]).some(function(l){ return !!l && l.type==='labor' && l.ref===PMS_LABOR_ID; });
}
/* True when at least one released job on this vehicle performed a PMS. */
function vehiclePmsPerformed(v){
  if(!v) return false;
  var plate=String(v.plate||'').toUpperCase();
  return (S.jobs||[]).some(function(j){
    return j.stage==='Released' && jobPerformedPms(j) &&
      (j.vehicleId===v.id || (plate && String(j.plate||'').toUpperCase()===plate));
  });
}
/* 'due' (date passed) · 'soon' (within 14 days) · '' (nothing to show). */
function pmsReminderState(v){
  if(!v || !v.nextServiceDate || !vehiclePmsPerformed(v)) return '';
  if(v.nextServiceDate < todayISO()) return 'due';
  if(v.nextServiceDate <= todayISO(new Date(Date.now()+14*86400000))) return 'soon';
  return '';
}
/* Schedule the next PMS off a release: 3 months out, 5,000 km on. */
function scheduleNextService(v, reading){
  var nd=new Date(); nd.setMonth(nd.getMonth()+3);
  v.nextServiceDate=todayISO(nd); v.nextServiceOdo=(reading||v.odometer||0)+5000;
}
function clearNextService(v){ v.nextServiceDate=''; v.nextServiceOdo=''; }
/* The ✕ on a board reminder (and "Clear reminder" on the vehicle page). */
function dismissPmsReminder(id){
  var v=vehicleById(id); if(!v) return;
  confirmModal('Dismiss PMS reminder',
    'Clear the next-service reminder for '+v.plate+'? The vehicle stays on file — the reminder comes back automatically when its next PMS is released.',
    function(){ clearNextService(v); persist(); if(typeof publishPortalDoc==='function') publishPortalDoc(v.id); toast('Reminder dismissed'); render(); },
    'Dismiss', true);
}
function alertStrip(){
  var alerts=[];
  // PMS reminders — only units where a PMS was actually performed (see above)
  S.vehicles.forEach(function(v){
    var st=pmsReminderState(v); if(!st) return;
    alerts.push({ kind:st, text:(st==='due'?'PMS overdue':'PMS due soon')+': '+v.plate+' ('+v.make+' '+v.model+') · '+fmtDate(v.nextServiceDate),
      act:"go('vehicle','"+v.id+"')", dismiss:"dismissPmsReminder('"+v.id+"')" });
  });
  // low stock
  S.parts.forEach(function(p){
    if ((p.stock||0) <= (p.reorder||0)) alerts.push({ kind:'low', text:'Low stock: '+p.name+' ('+p.stock+' left)', act:"go('parts')" });
  });
  if (!alerts.length) return '';
  return '<div class="alertstrip">'+alerts.slice(0,6).map(function(a){
    if(a.dismiss) return '<span class="alert a-'+a.kind+'"><button class="alert-go" onclick="'+a.act+'">'+esc(a.text)+'</button>'+
      '<button class="alert-x" onclick="'+a.dismiss+'" title="Dismiss this reminder" aria-label="Dismiss reminder">✕</button></span>';
    return '<button class="alert a-'+a.kind+'" onclick="'+a.act+'">'+esc(a.text)+'</button>';
  }).join('')+ (alerts.length>6?'<span class="alert-more">+'+(alerts.length-6)+' more</span>':'') +'</div>';
}

/* ---- KPI header ----------------------------------------------------------- */
function boardKPIs(){
  var active = S.jobs.filter(function(j){return j.stage!=='Released' && !jobCancelled(j);});
  var wip = round2(active.reduce(function(s,j){return s+jobGross(j);},0));
  var dueCount = active.filter(isUpdateDue).length;
  var released = S.jobs.filter(function(j){return j.stage==='Released';});
  var todayRev = round2(released.filter(function(j){return j.payments&&j.payments.some(function(p){return localDay(p.date)===todayISO();});})
    .reduce(function(s,j){return s+jobPaid(j);},0));
  var money = (typeof isAdminOrSV==='function') ? isAdminOrSV() : true;   // WIP value + collections: Admin / Supervisor only
  return '<div class="kpis">'+
    kpi('Active units', active.length, dueCount?dueCount+' need update':'all current') +
    (money ? kpi('Open WIP value', peso(wip)) : '') +
    kpi('Updates due', dueCount, dueCount?'<span class="amber">needs clipboard</span>':'all current') +
    (money ? kpi("Today's collections", peso(todayRev)) : '') +
  '</div>';
}

/* ---- Board view ----------------------------------------------------------- */
var BOARD_Q='';
/* JO # and OR # are matched too — a unit awaiting release carries both, and the
   counter is usually holding a receipt or a job order slip rather than knowing
   the plate. The number is also matched bare (JO-0042 found by typing 42), since
   nobody says the prefix out loud. */
function boardMatch(j){
  if(!BOARD_Q) return true; var q=BOARD_Q.toLowerCase();
  var mechs=staffSearchStr((j.mechanicIds||[]).concat([j.saId]));
  // People tagged in the clipboard log — lets a mechanic find "messages for me".
  var tagged=staffSearchStr((j.statusLog||[]).reduce(function(a,e){ return a.concat(logEntryFor(e)); },[]));
  return [j.plate,j.owner,j.contactPerson,j.make,j.model,j.make+' '+j.model,mechs,tagged,
          j.no,j.orNumber,digitsOf(j.no),digitsOf(j.orNumber)]
    .some(function(x){ return String(x||'').toLowerCase().indexOf(q)>=0; });
}
/* "JO-0042" -> "42": the digits with the prefix and any leading zeros dropped. */
function digitsOf(v){ var m=/(\d+)/.exec(String(v||'')); return m? String(Number(m[1])) : ''; }
function boardBody(){
  var active = S.jobs.filter(function(j){return j.stage!=='Released' && !jobCancelled(j);}).filter(boardMatch);
  /* The board is active units only, so a released JO — which is exactly what an
     OR number usually belongs to — can never appear here. Hand the same query to
     Job Orders, which searches the full history, instead of dead-ending. */
  if(BOARD_Q && !active.length)
    return '<div class="empty">No active units match “'+esc(BOARD_Q)+'”.'+
      '<div class="mt8"><button class="btn sm" onclick="boardSearchAllJobs()">Search all job orders instead</button></div></div>';
  return BOARD_MODE==='kanban'? boardKanban(active) : BOARD_MODE==='bays'? boardBays(active) : BOARD_MODE==='mechs'? boardMechs(active) : boardList(active);
}
function boardSearch(v){ BOARD_Q=v; var el=document.getElementById('boardBody'); if(el) el.innerHTML=boardBody(); }
/* Carry the board's query over to Job Orders, which covers released units too. */
function boardSearchAllJobs(){ if(typeof JOB_Q!=='undefined') JOB_Q=BOARD_Q; go('jobs'); }
VIEWS.board = function(){
  var toggle = '<div class="seg">'+
    ['kanban','list','bays','mechs'].map(function(m){
      var on=BOARD_MODE===m?' on':''; var lab={kanban:'Kanban',list:'List',bays:'Service Bays',mechs:'Mechanics'}[m];
      return '<button class="seg-b'+on+'" onclick="setBoardMode(\''+m+'\')">'+lab+'</button>';
    }).join('')+'</div>';
  var search='<input class="searchbox" id="boardSearch" value="'+attr(BOARD_Q)+'" oninput="boardSearch(this.value)" placeholder="Search JO # / OR # / plate / owner / make / model / mechanic…" autocomplete="off">';
  return '<div class="page">'+
    '<div class="page-head"><h1>Operations Board</h1><div class="row gap wrap">'+search+toggle+'</div></div>'+
    messageStrip()+ alertStrip()+ boardKPIs()+ '<div id="boardBody">'+boardBody()+'</div>'+
  '</div>';
};

/* ---- Tagged-message inbox ----------------------------------------------------
   Every clipboard entry addressed to someone (entry.for) is a message. It stays
   unread for each tagged person until they press "Got it" on the board, which
   stamps entry.ack[staffId]. The board strip lists who has unread messages so
   whoever is at the counter (or the person themselves) sees it without opening
   a job. Released and cancelled units drop out — that unit is done with. */
function messageAcked(e, staffId){ return !!(e && e.ack && e.ack[staffId]); }
/* Unread messages for one person (or everyone when staffId is null), newest first. */
function unreadMessages(staffId){
  var out=[];
  (S.jobs||[]).forEach(function(j){
    if(j.stage==='Released' || !jobLive(j)) return;
    (j.statusLog||[]).forEach(function(e, idx){
      logEntryFor(e).forEach(function(id){
        if(staffId && id!==staffId) return;
        if(messageAcked(e,id)) return;
        out.push({ job:j, entry:e, idx:idx, staffId:id });
      });
    });
  });
  out.sort(function(a,b){ return String(b.entry.time).localeCompare(String(a.entry.time)); });
  return out;
}
/* Staff ids that belong to the signed-in account: an explicit link (the
   account's "Staff record", set under Accounts & Roles) or a same-name match. */
function myStaffIds(){
  if(typeof CURRENT_USER==='undefined' || !CURRENT_USER) return [];
  var ids=[]; var nm=String(CURRENT_USER.name||'').trim().toLowerCase();
  (S.staff||[]).forEach(function(st){
    if((CURRENT_USER.staffId && st.id===CURRENT_USER.staffId) || (nm && String(st.name||'').trim().toLowerCase()===nm)) ids.push(st.id);
  });
  return ids;
}
/* One chip per person with unread messages; the signed-in person's chip comes
   first, in red, labelled "You". */
function messageStrip(){
  var all=unreadMessages(null); if(!all.length) return '';
  var mine=myStaffIds();
  var count={}; var order=[];
  all.forEach(function(m){ if(!count[m.staffId]){ count[m.staffId]=0; order.push(m.staffId); } count[m.staffId]++; });
  order.sort(function(a,b){ var ma=mine.indexOf(a)>=0?0:1, mb=mine.indexOf(b)>=0?0:1; return (ma-mb) || staffName(a).localeCompare(staffName(b)); });
  return '<div class="msgstrip">'+order.map(function(id){
    var me=mine.indexOf(id)>=0, n=count[id];
    return '<button class="msgchip'+(me?' me':'')+'" onclick="openInbox(\''+id+'\')" title="Open messages for '+attr(staffName(id))+'">📣 '+
      esc(me?'You · '+staffName(id):staffName(id))+' <b>'+n+'</b> '+(n===1?'message':'messages')+'</button>';
  }).join('')+'</div>';
}
function openInbox(staffId){
  var list=unreadMessages(staffId);
  var body=list.length? list.map(function(m){
    var j=m.job, e=m.entry;
    return '<div class="inbox-row"><div class="inbox-body">'+
      '<div class="inbox-head"><a onclick="closeModal();go(\'job\',\''+j.id+'\')"><b>'+esc(j.no)+'</b> · '+esc(j.plate)+'</a>'+statusBadge(e.code)+
        '<span class="inbox-veh">'+esc(jobVehicleLabel(j))+(j.owner?' · '+esc(j.owner):'')+'</span></div>'+
      '<div class="inbox-note">'+esc(e.note||'')+'</div>'+
      '<div class="log-meta">'+esc(staffName(e.by))+' · '+esc(fmtDateTime(e.time))+'</div></div>'+
      '<div class="inbox-acts">'+
        '<button class="btn sm primary" onclick="ackMessage(\''+j.id+'\','+m.idx+',\''+staffId+'\')">✓ Got it</button>'+
        '<button class="btn sm ghost" onclick="replyToMessage(\''+j.id+'\','+m.idx+',\''+staffId+'\')">↩ Reply</button>'+
      '</div></div>';
  }).join('') : emptyState('No unread messages.');
  openModal('Messages for '+staffName(staffId), '<div class="inbox">'+body+'</div>',
    { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>', width:'640px' });
}
/* "Got it": stamps the reader on the entry. The stamp stays on the job's log
   ("read by …"), so the sender can see it landed. */
function ackMessage(jobId, idx, staffId){
  var j=jobById(jobId); var e=j && (j.statusLog||[])[idx]; if(!e) return;
  e.ack=e.ack||{}; e.ack[staffId]=new Date().toISOString();
  persist(); render();
  if(unreadMessages(staffId).length) openInbox(staffId); else { closeModal(); toast('All read'); }
}

/* "2019 Toyota Vios 1.3 E" for a job — the unit as the shop says it out loud.
   Falls back to the vehicle record when the job snapshot is thin. */
function jobVehicleLabel(j){
  if(!j) return '';
  var v=(j.vehicleId && typeof vehicleById==='function') ? vehicleById(j.vehicleId) : null;
  var parts=[j.year||(v&&v.year), j.make||(v&&v.make), j.model||(v&&v.model), j.variant||(v&&v.variant)];
  return parts.filter(function(x){ return x!=null && String(x).trim()!==''; }).join(' ').trim();
}

/* ---- Reply -------------------------------------------------------------------
   A reply is just another clipboard entry on the same job, logged BY the person
   who was tagged and addressed back TO whoever wrote the message (plus anyone
   else it was addressed to, so a two-mechanic thread stays together). Sending
   also marks the original read — you have plainly seen it if you answered it.
   The status code is carried over so a reply never silently moves the job. */
var _replyCtx=null;
function replyRecipients(e, meId){
  var to=[]; if(e && e.by && e.by!==meId) to.push(e.by);
  logEntryFor(e).forEach(function(id){ if(id!==meId && to.indexOf(id)<0) to.push(id); });
  return to;
}
function replyToMessage(jobId, idx, staffId){
  var j=jobById(jobId); var e=j && (j.statusLog||[])[idx]; if(!e) return;
  var to=replyRecipients(e, staffId);
  if(!to.length){ toast('Nobody to reply to on this message','err'); return; }
  _replyCtx={ jobId:jobId, idx:idx, staffId:staffId };
  openModal('Reply · '+j.no+' · '+j.plate+(jobVehicleLabel(j)?' · '+jobVehicleLabel(j):''),
    '<div class="reply-quote"><div class="log-meta">'+esc(staffName(e.by))+' · '+esc(fmtDateTime(e.time))+'</div>'+
      '<div class="inbox-note">'+esc(e.note||'')+'</div></div>'+
    '<div class="fld"><span class="fld-l">To</span><div class="tags">'+
      to.map(function(id){ return '<span class="chip gold">'+esc(staffName(id))+'</span>'; }).join(' ')+'</div>'+
      '<span class="fld-h">Replying as '+esc(staffName(staffId))+' — it lands on this job\'s clipboard log.</span></div>'+
    field('Your reply','<textarea id="rpNote" rows="3" placeholder="e.g. Copy. Torqued to 110 Nm, hub refitted."></textarea>'),
    { onOk:'sendReply', okText:'↩ Send reply', width:'560px',
      after:function(){ var t=document.getElementById('rpNote'); if(t){ try{ t.focus(); }catch(err){} } } });
}
function sendReply(){
  if(!_replyCtx) return;
  var j=jobById(_replyCtx.jobId); var e=j && (j.statusLog||[])[_replyCtx.idx]; if(!e){ closeModal(); return; }
  var note=val('rpNote');
  if(!String(note).trim()){
    toast('Write your reply before sending','err');
    var el=document.getElementById('rpNote'); var box=(el && el.closest) ? el.closest('.fld') : null;
    if(box){ box.classList.add('needfill');
      var clr=function(){ if(String(val('rpNote')).trim()){ box.classList.remove('needfill'); el.removeEventListener('input',clr); } };
      el.addEventListener('input',clr);
    }
    if(el){ try{ el.focus(); }catch(err){} }
    return;
  }
  var me=_replyCtx.staffId;
  j.statusLog.push(buildLogEntry(e.code || j.status, me, note, replyRecipients(e, me)));
  e.ack=e.ack||{}; e.ack[me]=new Date().toISOString();     // answering it counts as reading it
  var staffId=me; _replyCtx=null;
  persist(); closeModal(); toast('Reply logged');
  render();
  if(unreadMessages(staffId).length) openInbox(staffId);
}

/* Time of the most recent status/clipboard log entry for a job (or '—'). */
function lastLogTimeLabel(j){
  var log=j.statusLog||[]; if(!log.length) return '—';
  return fmtDateTime(log[log.length-1].time);
}
/* "📣 for Jun, Toto" while anyone still has an unread message on this job. */
function lastLogForLabel(j){
  var ids=[];
  (j.statusLog||[]).forEach(function(e){ logEntryFor(e).forEach(function(id){ if(!messageAcked(e,id) && ids.indexOf(id)<0) ids.push(id); }); });
  if(!ids.length) return '';
  return '📣 for '+ids.map(staffName).join(', ');
}
function jobCardMini(j){
  var due = isUpdateDue(j);
  return '<div class="jcard" onclick="go(\'job\',\''+j.id+'\')">'+
    '<div class="jcard-top">'+statusBadge(j.status)+'<span class="plate">'+esc(j.plate)+'</span>'+
      (j.owner?'<span class="jcard-owner">'+esc(j.owner)+'</span>':'')+
      (due?'<span class="duedot" title="Update due">●</span>':'')+'</div>'+
    '<div class="jcard-veh">'+esc(j.year+' '+j.make+' '+j.model)+'</div>'+
    '<div class="jcard-meta"><span>'+esc(bayName(j.bayId))+'</span><span>'+esc(mechName(j.mechanicIds))+'</span></div>'+
    '<div class="jcard-meta"><span class="muted small">⏱ last log '+esc(lastLogTimeLabel(j))+'</span>'+
      (lastLogForLabel(j)?'<span class="jcard-for">'+esc(lastLogForLabel(j))+'</span>':'')+'</div>'+
    '<div class="jcard-foot"><span class="muted">'+esc(j.no)+'</span>'+(canSeeJobPrices()?'<span class="bill">'+peso(jobGross(j))+'</span>':'')+'</div>'+
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
  var showPrice = canSeeJobPrices();
  var rows = active.map(function(j){
    var due=isUpdateDue(j);
    return '<tr onclick="go(\'job\',\''+j.id+'\')">'+
      '<td><b>'+esc(j.no)+'</b></td><td>'+esc(j.plate)+'</td>'+
      '<td>'+esc(j.make+' '+j.model)+(j.owner?' <span class="muted small">· '+esc(j.owner)+'</span>':'')+'</td>'+
      '<td>'+statusBadge(j.status)+(due?' <span class="amber">⚑ due</span>':'')+'</td>'+
      '<td>'+esc(bayName(j.bayId))+'</td>'+
      '<td>'+esc(mechName(j.mechanicIds))+'</td>'+
      '<td>'+esc(lastLogTimeLabel(j))+'</td>'+
      '<td>'+esc(fmtDate(j.etd))+'</td>'+
      (showPrice?'<td class="r">'+peso(jobGross(j))+'</td>':'')+'</tr>';
  }).join('');
  return '<div class="card pad0"><table class="tbl click">'+
    '<thead><tr><th>JO #</th><th>Plate</th><th>Vehicle</th><th>Status</th><th>Bay</th><th>Mechanic(s)</th><th>Last log</th><th>ETD</th>'+
    (showPrice?'<th class="r">Running bill</th>':'')+'</tr></thead>'+
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
function boardMechs(active){
  // Group active jobs under each mechanic (a job with several mechanics shows under each).
  var byMech = {};
  active.forEach(function(j){ (j.mechanicIds||[]).forEach(function(id){ if(id&&id!=='TBA') (byMech[id]=byMech[id]||[]).push(j); }); });
  var mechs = (S.staff||[]).filter(function(s){ return isMechanicRole(s.role); })
    .sort(function(a,b){ return kpiRoleRank(a.role)-kpiRoleRank(b.role) || (a.name<b.name?-1:1); });
  var cells = mechs.map(function(s){
    var jobs = byMech[s.id]||[];
    return '<div class="baycell"><div class="bay-name">'+esc(s.name)+
        ' <span class="muted small">· '+esc(roleLabel(s.role))+'</span>'+
        '<span class="kcount" title="Active jobs">'+jobs.length+'</span></div>'+
      (jobs.length? jobs.map(function(j){ return '<div class="bay-car" onclick="go(\'job\',\''+j.id+'\')">'+
        '🚗 '+esc(j.plate)+' '+statusBadge(j.status)+
        '<div class="muted small">'+esc(j.make+' '+j.model)+' · '+esc(bayName(j.bayId))+'</div></div>'; }).join('')
        : '<div class="bay-empty">No active jobs</div>')+'</div>';
  }).join('');
  var unassigned = active.filter(function(j){ return !(j.mechanicIds||[]).some(function(id){ return id&&id!=='TBA'; }); });
  var none = '<div class="baycell nobay"><div class="bay-name">No mechanic assigned'+
      '<span class="kcount">'+unassigned.length+'</span></div>'+
    (unassigned.length? unassigned.map(function(j){ return '<div class="bay-car" onclick="go(\'job\',\''+j.id+'\')">🚗 '+esc(j.plate)+' '+statusBadge(j.status)+'</div>'; }).join('')
      : '<div class="bay-empty">—</div>')+'</div>';
  if(!mechs.length) return emptyState('No mechanics on staff. Add them in Records → Staff.');
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
function delAppt(id){
  if (typeof requireDelete==='function' && !requireDelete('appointments')) return;
  S.appointments=S.appointments.filter(function(x){return x.id!==id;}); persist(); closeModal(); render(); }
function checkInAppt(id){
  var a=S.appointments.find(function(x){return x.id===id;}); if(!a) return;
  createJobFromAppt(a).then(function(job){
    a.status='Arrived'; a.jobId=job.id; persist();
    toast('Checked in · '+job.no+' created'); go('job', job.id);
  });
}

function field(label, control, hint){
  return '<label class="fld"><span class="fld-l">'+esc(label)+'</span>'+control+
    (hint?'<span class="fld-h">'+esc(hint)+'</span>':'')+'</label>';
}
