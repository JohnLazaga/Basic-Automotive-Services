/* ============================================================================
   BASIC by JMSI — Shop Operations System
   PART 1 — Core: brand, logo, utilities, storage adapter, data model, seed
   Vanilla JS. No frameworks. Render functions are PURE (return HTML strings).
   ========================================================================== */

'use strict';

/* App version — stamped by build.js from the VERSION file + build date. Shown on
   the login screen and in the sidebar so each branch's installed version is
   visible (branches update by refreshing the page). */
var APP_VERSION = '__APP_VERSION__';

/* ---- Brand / logo --------------------------------------------------------- */
var BRAND = { red:'#F21717', redDark:'#CC0F0F', gold:'#FFC000' };

/* Official "Basic" symbol composited on a black rounded box is supplied by the
   build as a pre-defined LOGO_URI (src/logo.js, prepended before this file).
   If it isn't present, fall back to a clean red rounded-square "B" monogram. */
var LOGO_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>" +
  "<rect width='128' height='128' rx='28' fill='#111111'/>" +
  "<text x='64' y='64' dy='.34em' text-anchor='middle' font-family=\"-apple-system,Segoe UI,Roboto,sans-serif\" " +
  "font-size='80' font-weight='800' fill='#F21717'>B</text></svg>";

/* Print-safe mark: the official symbol recoloured WHITE on the black box, supplied
   by the build as LOGO_URI_PRINT (src/logo.js). The red symbol goes near-black on a
   mono/greyscale printer, so the QR sticker would print as a solid black square.
   Fallback below is a white "B" monogram, used only if logo.js isn't prepended. */
var LOGO_SVG_PRINT =
  "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>" +
  "<rect width='128' height='128' rx='28' fill='#111111'/>" +
  "<text x='64' y='64' dy='.34em' text-anchor='middle' font-family=\"-apple-system,Segoe UI,Roboto,sans-serif\" " +
  "font-size='80' font-weight='800' fill='#FFFFFF'>B</text></svg>";

/* btoa exists in modern browsers and Node 16+; guard anyway. */
function _b64(s){
  try { return (typeof btoa==='function') ? btoa(s) : Buffer.from(s,'binary').toString('base64'); }
  catch(e){ return Buffer.from(s,'binary').toString('base64'); }
}
var LOGO_URI;       /* mark: red symbol on black box — set by prepended logo.js */
var LOGO_URI_PRINT; /* same box, symbol in white (for print) — set by prepended logo.js */
var LOGO_LOCKUP;    /* full primary lockup (dark bg) — set by prepended logo.js */
var LOGO_BG;        /* the lockup's background color, for seamless dark surfaces */
if (typeof LOGO_URI === 'undefined' || !LOGO_URI){
  LOGO_URI = 'data:image/svg+xml;base64,' + _b64(LOGO_SVG);
}
if (typeof LOGO_URI_PRINT === 'undefined' || !LOGO_URI_PRINT){
  LOGO_URI_PRINT = 'data:image/svg+xml;base64,' + _b64(LOGO_SVG_PRINT);
}
if (typeof LOGO_LOCKUP === 'undefined' || !LOGO_LOCKUP){ LOGO_LOCKUP = LOGO_URI; }
if (typeof LOGO_BG === 'undefined' || !LOGO_BG){ LOGO_BG = '#181818'; }

/* ---- Status codes --------------------------------------------------------- */
var STATUS = {
  A1:'Unit received, waiting for diagnosis',
  A2:'Unit diagnosed, waiting for parts quotation',
  A3:'Unit diagnosed, waiting for mechanic',
  B1:'On-going job, waiting for parts',
  B2:'On-going job, parts complete',
  B3:'Job stopped, waiting for parts',
  B4:'Job stopped, other reasons',
  C1:'Job done, waiting for test drive & clearance',
  C2:'Release not cleared, return to mechanic',
  C3:'Release cleared, forward to billing'
};
var STATUS_ORDER = ['A1','A2','A3','B1','B2','B3','B4','C1','C2','C3'];
function statusGroup(code){ return code ? code.charAt(0) : 'A'; }
var STATUS_GROUP_NAME = { A:'Diagnosis', B:'In Progress', C:'Release' };

/* ---- Utilities ------------------------------------------------------------ */
var PHP = new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' });
function peso(n){ return PHP.format(Number(n)||0); }
function num(n){ return (Number(n)||0).toLocaleString('en-PH'); }
function round2(n){ return Math.round((Number(n)||0)*100)/100; }
/* Odometer reading: thousands comma + " km". */
function odo(n){ return num(Number(n)||0)+' km'; }
/* Fuel level as a percentage. Numeric -> "n%"; legacy free-text shown as-is; blank -> "—". */
function fmtFuel(f){ if(f===''||f===null||f===undefined) return '—'; return isFinite(f)? (Number(f)+'%') : String(f); }

function esc(s){
  if (s===null || s===undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function attr(s){ return esc(s); }

var _idc = 0;
function uid(p){ _idc++; return (p||'id') + '_' + Date.now().toString(36) + '_' + _idc.toString(36); }

function todayISO(d){ d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function fmtDate(iso){ if(!iso) return '—';
  var d = new Date(iso + (iso.length<=10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
}
function fmtDateTime(iso){ if(!iso) return '—'; var d=new Date(iso); if(isNaN(d)) return iso;
  return d.toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function daysBetween(a,b){ var ms = new Date(b) - new Date(a); return Math.floor(ms/86400000); }

/* ---- Line / money math (single source of truth) --------------------------- */
function lineTotal(l){ return round2((Number(l.qty)||0) * (Number(l.price)||0)); }
function sumLines(lines, type){
  return round2((lines||[]).reduce(function(s,l){
    if (type && l.type!==type) return s; return s + lineTotal(l);
  },0));
}
function partsTotal(lines){ return sumLines(lines,'part'); }
function laborTotal(lines){ return sumLines(lines,'labor'); }
function addlTotal(job){
  return round2(((job&&job.addlWork)||[]).reduce(function(s,a){
    return s + (a.approved ? (Number(a.amount)||0) : 0);
  },0));
}
function grossBeforeDiscount(job){
  return round2(sumLines(job.lines) + addlTotal(job));
}
/* VATable base = SRP/line total (prices are VAT-EXCLUSIVE; NO discount here —
   the discount is applied to the Total Amount Due, after VAT). */
function jobNet(job){ return grossBeforeDiscount(job); }
/* Subtotal = VATable + 12% VAT, before discount. */
function jobSubtotal(job){
  var n = jobNet(job);
  if (!S || !S.shop || !S.shop.vatReg) return n;
  var rate = (Number(S.shop.vatRate)||12)/100;
  return round2(n * (1 + rate));
}
/* Discounts are value-based (peso amounts) applied to three consolidated
   buckets: parts, labor and "other" (free-text reference). On printouts they
   are consolidated into a single Discount amount — never itemised. */
function discParts(job){ var d=(job&&job.discount)||{}; return round2(Number(d.parts)||0); }
function discLabor(job){ var d=(job&&job.discount)||{}; return round2(Number(d.labor)||0); }
function discOther(job){ var d=(job&&job.discount)||{}; return round2(Number(d.other)||0); }
/* Sum of the value-based buckets, with backward compatibility for the old
   {type, value} shape (treated as a single consolidated amount). */
function discountRaw(job){
  var d = job && job.discount; if(!d) return 0;
  if (d.parts!==undefined || d.labor!==undefined || d.other!==undefined){
    return round2((Number(d.parts)||0)+(Number(d.labor)||0)+(Number(d.other)||0));
  }
  var base = jobSubtotal(job);                    // legacy {type,value}
  if (d.type==='percent') return round2(base * (Number(d.value)||0)/100);
  return round2(Number(d.value)||0);
}
/* Discount is taken off the (VAT-inclusive) Total Amount Due; capped at it. */
function discountAmount(job){ return round2(Math.min(discountRaw(job), jobSubtotal(job))); }
/* Labor value net of the labor discount — the base for commission. */
function discountedLabor(job){ return round2(Math.max(0, laborTotal(job.lines) - discLabor(job))); }
/* Total Amount Due = subtotal (VATable + VAT) − discount. */
function jobGross(job){ return round2(jobSubtotal(job) - discountAmount(job)); }

/* VAT-EXCLUSIVE split: input is the VATable base; VAT (12%) is added on top.
   vatable = base, vat = base × rate, gross (total due) = base + vat. */
function vatSplit(base, S){
  base = round2(base);
  if (!S || !S.shop || !S.shop.vatReg) return { vatable: base, vat:0, gross:base, exempt:true };
  var rate = (Number(S.shop.vatRate)||12)/100;
  var vat = round2(base * rate);
  var gross = round2(base + vat);
  return { vatable:base, vat:vat, gross:gross, exempt:false };
}

/* EXPLICIT per-staff rate (% of labor) for NON-mechanic assignees (Service
   Adviser, assessor, parts salesman), set by an admin on the Staff page. There is
   NO fallback: a blank/unset rate means NO commission (0). The shop default rate
   is the MECHANIC pool rate only — it must not leak onto non-mechanic roles.
   Mechanics do NOT use this — they split the shop-rate pool evenly (see below). */
function staffCommissionRate(idOrStaff){
  var s = (idOrStaff && typeof idOrStaff==='object') ? idOrStaff : staffById(idOrStaff);
  if(!s) return 0;
  var r = s.commissionRate;
  if(r===undefined || r===null || r==='') return 0;   // no rate set → no commission (no mechanic-default fallback)
  return Number(r)||0;
}
/* Labor-commission map for a job — the single source of truth for payout & KPI.
   ONLY the Mechanic(s) field earns the labor pool. Those mechanics split ONE pool
   EQUALLY: pool = labor × shop mechanic rate (S.shop.mechCommissionRate); each
   earns pool ÷ (# mechanics assigned).
   e.g. ₱1000 labor @ 5% → 1 mech ₱50, 2 mechs ₱25 each, 3 mechs ₱16.67 each.
   The divisor is the count of mechanics ASSIGNED (not just toggle-on), so
   excluding one from payout never inflates the others' shares.
   NON-mechanic assignees (SA, the "Assessed by" senior mechanic, parts salesman)
   do NOT share the pool: each earns their OWN explicitly-set rate × labor, and
   nothing at all if no rate is set for them.
   includeAll=true ignores the payout toggle (evaluation/KPI figure); default
   returns only commission-eligible (toggle-on) staff (actual payout). */
function _laborCommissionMap(job, includeAll){
  var labor = discountedLabor(job);
  var map = {};
  // distinct mechanics actually assigned to this job (blank / "TBA" excluded)
  var mechs = [];
  (job.mechanicIds||[]).forEach(function(id){ if(id && id!=='TBA' && mechs.indexOf(id)<0) mechs.push(id); });
  if(mechs.length){
    var share = round2(labor * (Number(S.shop.mechCommissionRate)||0)/100 / mechs.length);  // equal per-mechanic share
    mechs.forEach(function(id){
      if(!staffById(id)) return;
      if(!includeAll && !commissionEligible(id)) return;   // toggled out of payout
      map[id] = share;
    });
  }
  // Non-mechanic assignees: own EXPLICIT rate × labor, undivided; nothing if unset.
  [job.saId, job.assessedBy, job.partsSalesman].forEach(function(id){
    if(!id || id==='TBA' || mechs.indexOf(id)>=0) return;  // skip blanks & anyone already paid as a mechanic
    if(!staffById(id)) return;
    if(!includeAll && !commissionEligible(id)) return;
    var amt = round2(labor * staffCommissionRate(id)/100);
    if(amt>0) map[id] = amt;                               // only when an explicit rate earns something
  });
  return map;
}
/* Actual payout map — mechanics' equal split + non-mechanics' own rate (toggle-on only). */
function jobLaborCommissionMap(job, S){ return _laborCommissionMap(job, false); }
/* Evaluation map — same, but ignoring the payout toggle so an excluded person
   still shows the commission they WOULD earn. */
function jobLaborCommissionMapAll(job, S){ return _laborCommissionMap(job, true); }
/* Total labor-commission cost of a job (toggle-on staff) and the assignee count. */
function jobLaborCommission(job, S){
  var m = jobLaborCommissionMap(job, S); var ids = Object.keys(m);
  var pool = round2(ids.reduce(function(t,id){ return t + m[id]; }, 0));
  return { pool:pool, count:ids.length, map:m };
}
/* Every staff member is entitled to commission by default; an admin can switch
   an individual off via the Staff Productivity toggle (sets staff.commission=false). */
function commissionEligible(idOrStaff){
  var s = (idOrStaff && typeof idOrStaff==='object') ? idOrStaff : staffById(idOrStaff);
  return !!s && s.commission !== false;
}

/* ---- Payment helpers ------------------------------------------------------ */
function jobPaid(job){ return round2(((job.payments)||[]).reduce(function(s,p){return s+(Number(p.amount)||0);},0)); }
function jobBalance(job){ return round2(jobGross(job) - jobPaid(job)); }

/* ---- Storage adapter ------------------------------------------------------
   Tries window.storage (async get/set) -> localStorage -> in-memory.        */
var STORE_KEY = 'bas_ops_v2';
var _mem = {};
var Storage = {
  async get(k){
    try {
      if (typeof window!=='undefined' && window.storage && window.storage.get){
        return await window.storage.get(k);
      }
    } catch(e){}
    try { if (typeof localStorage!=='undefined'){ var v=localStorage.getItem(k); return v==null?null:v; } } catch(e){}
    return (k in _mem) ? _mem[k] : null;
  },
  async set(k,v){
    try {
      if (typeof window!=='undefined' && window.storage && window.storage.set){
        await window.storage.set(k,v); return true;
      }
    } catch(e){}
    try { if (typeof localStorage!=='undefined'){ localStorage.setItem(k,v); return true; } } catch(e){}
    _mem[k]=v; return true;
  }
};

/* ---- Global state --------------------------------------------------------- */
var S = null;                 // the single state object
var SAVE_TIMER = null;

function persist(){
  // debounced save with indicator. In cloud mode, sync changed records to
  // Firestore; otherwise fall back to the local storage adapter.
  setSaveState('saving');
  if (SAVE_TIMER) clearTimeout(SAVE_TIMER);
  SAVE_TIMER = setTimeout(function(){
    if (typeof dataLocal==='function' && dataLocal()){
      localPersist().then(function(){ setSaveState('saved'); })
        .catch(function(e){ console.error('local save failed', e); setSaveState('saved'); });
    } else if (typeof cloudOn==='function' && cloudOn() && typeof FB!=='undefined' && FB && FB.ready && FB.user){
      cloudPersist().then(function(){ setSaveState('saved'); })
        .catch(function(e){ console.error('cloud save failed', e); setSaveState('saved'); });
    } else {
      Storage.set(STORE_KEY, JSON.stringify(S)).then(function(){ setSaveState('saved'); });
    }
  }, 400);
}
function setSaveState(st){
  if (typeof document==='undefined') return;
  var el = document.getElementById('saveState');
  if (!el) return;
  el.textContent = st==='saving' ? 'Saving…' : 'All changes saved';
  el.setAttribute('data-st', st);
}

function counters(){ return S.counters; }
/* Highest numeric suffix already used by records of this kind — so a stale/behind
   counter (offline device, cross-device sync race) can never reissue a live number. */
function maxSeriesNo(kind){
  var coll = { jo:S.jobs, est:S.estimates, po:S.purchaseOrders }[kind] || [];
  var hi=0;
  coll.forEach(function(r){ if(r&&r.no){ var m=/(\d+)/.exec(String(r.no)); if(m){ var v=Number(m[1]); if(v>hi) hi=v; } } });
  return hi;
}
function nextNo(kind, prefix, pad){
  var c = S.counters;
  c[kind] = Math.max((c[kind]||0), maxSeriesNo(kind)) + 1;   // never below any existing record
  return prefix + String(c[kind]).padStart(pad||4,'0');
}
/* Atomic series-number allocator — mirrors allocateOrNumber. In cloud mode a
   Firestore transaction on meta/<kind>counter hands out each number exactly once,
   even across simultaneous devices. Offline (or if the transaction fails / is not
   permitted) it falls back to the local seed-from-max path, so creation never
   blocks. Returns a Promise. */
function allocateSeriesNumber(kind, prefix, pad){
  var seed = Math.max((Number((S.counters||{})[kind])||0), maxSeriesNo(kind)) + 1;
  function local(){
    if(!S.counters) S.counters={};
    S.counters[kind] = Math.max(Number(S.counters[kind])||0, seed);
    return prefix + String(S.counters[kind]).padStart(pad||4,'0');
  }
  if (typeof dataLocal==='function' && dataLocal()){
    // Server-atomic allocation on the branch mini-PC (no duplicate OR/JO numbers).
    return _postJSON(branchBase()+'/data/counter/'+encodeURIComponent(kind), { seed: seed })
      .then(function(d){ if(!d||!d.ok) throw new Error((d&&d.error)||'counter'); if(!S.counters)S.counters={}; S.counters[kind]=d.value; return prefix + String(d.value).padStart(pad||4,'0'); })
      .catch(function(){ return local(); });
  }
  if (typeof cloudOn==='function' && cloudOn() && typeof FB!=='undefined' && FB && FB.ready && FB.db && FB.user){
    var ref = bcol('meta').doc(kind+'counter');
    return FB.db.runTransaction(function(t){
      return t.get(ref).then(function(doc){
        var stored = (doc.exists && Number(doc.data().next)>0) ? Number(doc.data().next) : 0;
        var issue = Math.max(stored, seed);                 // never reuse / never go backward
        t.set(ref, { next: issue+1, updatedAt:new Date().toISOString() }, { merge:true });
        return issue;
      });
    }).then(function(issue){
      if(!S.counters) S.counters={};
      S.counters[kind] = issue;
      return prefix + String(issue).padStart(pad||4,'0');
    }).catch(function(){ return local(); });               // permission/offline → safe local seed
  }
  return Promise.resolve(local());
}

/* ---- Roles --------------------------------------------------------------- */
/* Internal role KEYS are unchanged (avoids data migration); only labels change. */
var ROLE_LABELS = { SV:'Supervisor', SA:'Service Adviser', SM:'Senior Mechanic', Mechanic:'Junior Mechanic', 'Parts Salesman':'Parts Salesman', Secretary:'Secretary' };
function roleLabel(role){ return ROLE_LABELS[role] || role || '—'; }
/* Roles that earn the shop's labor-commission rate (5% of labor). Mechanics
   split the pool; the Service Adviser on a job earns their own 5%. */
function earnsLaborCommission(role){ return isMechanicRole(role) || role==='SA'; }
/* Both Senior (SM) and Junior (Mechanic) mechanics earn labor commission and
   can be assigned to jobs. */
function isMechanicRole(role){ return role==='SM' || role==='Mechanic'; }
function mechanicStaff(){ return (S.staff||[]).filter(function(s){return isMechanicRole(s.role);}); }

/* ---- Lookups -------------------------------------------------------------- */
function staffById(id){ return (S.staff||[]).find(function(s){return s.id===id;}) || null; }
function staffName(id){ if(!id||id==='TBA') return 'TBA'; var s=staffById(id); return s?s.name:'—'; }
/* Searchable text for one or more staff ids — includes each person's name AND
   nickname, so searches match either. */
function staffSearchStr(ids){
  return (Array.isArray(ids)?ids:[ids]).map(function(id){
    var s=(id&&id!=='TBA')?staffById(id):null; return s?((s.name||'')+' '+(s.nickname||'')):'';
  }).join(' ');
}
/* Name only if the referenced staff actually holds the given role — guards
   signature blocks against stale references (e.g. an SA stored in a field
   that must be a Supervisor). Wrong-role references print as blank. */
function staffNameIfRole(id, role){ var s=staffById(id); return (s && s.role===role) ? s.name : ''; }
function staffByRole(role){ return (S.staff||[]).filter(function(s){return s.role===role;}); }
function bayById(id){ return (S.bays||[]).find(function(b){return b.id===id;}) || null; }
function bayName(id){ if(!id||id==='TBA') return 'TBA'; var b=bayById(id); return b?b.name:'—'; }
function partById(id){ return (S.parts||[]).find(function(p){return p.id===id;}) || null; }
function vehicleById(id){ return (S.vehicles||[]).find(function(v){return v.id===id;}) || null; }
function vehicleByPlate(plate){
  if(!plate) return null; var pn = plate.trim().toUpperCase();
  return (S.vehicles||[]).find(function(v){return (v.plate||'').toUpperCase()===pn;}) || null;
}
function jobByNo(no){ return (S.jobs||[]).find(function(j){return j.no===no;}) || null; }
function jobById(id){ return (S.jobs||[]).find(function(j){return j.id===id;}) || null; }
function estById(id){ return (S.estimates||[]).find(function(e){return e.id===id;}) || null; }
function mechName(ids){ return (ids||[]).map(staffName).join(', ') || 'TBA'; }

/* ---- Seed (realistic sample shop) ----------------------------------------- */
/* ---- PMS LABOR — a standard, always-present labor item -------------------
   Every branch's Labor Catalog carries "PMS LABOR" as its first entry. The
   NAME is fixed (staff can't rename or delete it) but the RATE is editable per
   branch. Its stable id also lets the labor flow recognise a PMS job
   (isPmsLabor) for the tablet-checklist feature. */
var PMS_LABOR_ID='lb_pms';
var PMS_LABOR_NAME='PMS LABOR';
function isPmsLabor(l){ return !!l && l.id===PMS_LABOR_ID; }
/* Guarantee the reserved item exists (creating it if a branch lacks it).
   Returns true if it had to be created, so the caller can persist. */
function ensurePmsLabor(){
  if(!Array.isArray(S.labor)) S.labor=[];
  var found=null;
  for(var i=0;i<S.labor.length;i++){ if(S.labor[i] && S.labor[i].id===PMS_LABOR_ID){ found=S.labor[i]; break; } }
  if(!found){ S.labor.unshift({ id:PMS_LABOR_ID, name:PMS_LABOR_NAME, price:0, cost:0, pms:true, locked:true }); return true; }
  found.name=PMS_LABOR_NAME; found.pms=true; found.locked=true;   // keep it canonical
  return false;
}
/* The labor catalog with the reserved PMS item forced first — order-independent
   of how storage/live-sync happens to return the rows. */
function laborList(){
  var arr=Array.isArray(S.labor)?S.labor.slice():[];
  arr.sort(function(a,b){ return (isPmsLabor(b)?1:0)-(isPmsLabor(a)?1:0); });
  return arr;
}
function seedState(){
  var sv = { id:uid('st'), name:'Ramon Cruz', role:'SV', commissionBase:'none', commissionRate:0 };
  var sa = { id:uid('st'), name:'Liza Mariano', role:'SA', commissionBase:'total', commissionRate:1 };
  var sm = { id:uid('st'), name:'Boy Santiago', role:'SM', commissionBase:'none', commissionRate:0 };
  var m1 = { id:uid('st'), name:'Jun Reyes', role:'Mechanic', commissionBase:'labor', commissionRate:5 };
  var m2 = { id:uid('st'), name:'Toto Bautista', role:'Mechanic', commissionBase:'labor', commissionRate:5 };
  var ps = { id:uid('st'), name:'Nene Flores', role:'Parts Salesman', commissionBase:'none', commissionRate:0 };

  var bayA = { id:uid('bay'), name:'Bay A1' };
  var bayB = { id:uid('bay'), name:'Bay B2' };
  var bayL = { id:uid('bay'), name:'Lift 1' };

  var p1 = { id:uid('pt'), partNo:'OF-1042', name:'Oil Filter', cost:120, price:220, stock:24, reorder:6, source:'local' };
  var p2 = { id:uid('pt'), partNo:'EO-5W40', name:'Engine Oil 5W-40 (1L)', cost:280, price:480, stock:40, reorder:12, source:'local' };
  var p3 = { id:uid('pt'), partNo:'BP-FRT', name:'Front Brake Pads', cost:850, price:1450, stock:8, reorder:4, source:'local' };
  var p4 = { id:uid('pt'), partNo:'AF-2201', name:'Air Filter', cost:240, price:430, stock:3, reorder:6, source:'local' };

  var l1 = { id:uid('lb'), name:'Change Oil Labor', price:350, cost:0 };
  var l2 = { id:uid('lb'), name:'Brake Service Labor', price:800, cost:0 };
  var l3 = { id:uid('lb'), name:'General Diagnosis', price:500, cost:0 };
  var l4 = { id:PMS_LABOR_ID, name:PMS_LABOR_NAME, price:1800, cost:0, pms:true, locked:true };

  var v1 = { id:uid('vh'), plate:'ABC 1234', owner:'Maria Dela Cruz', address:'12 Mapagkawanggawa St., Fairview, QC',
             contactPerson:'Maria Dela Cruz', contactNumber:'0917 555 1234', chassis:'MHFXX1234X0012345',
             year:2019, make:'Toyota', model:'Vios', variant:'1.3 E', odometer:48250, nextServiceDate:'2026-09-01', nextServiceOdo:53000 };
  var v2 = { id:uid('vh'), plate:'XYZ 8899', owner:'Jowil Motor Sales Inc.', address:'Commonwealth Ave., Fairview, QC',
             contactPerson:'Fleet Desk', contactNumber:'0998 222 1010', chassis:'JN1XX8899X0098765',
             year:2021, make:'Mitsubishi', model:'Montero Sport', odometer:31200, nextServiceDate:'2026-07-05', nextServiceOdo:35000 };

  var now = new Date();
  var job1 = {
    id:uid('job'), no:'JO-0001', stage:'Job Order',
    plate:v1.plate, vehicleId:v1.id, owner:v1.owner, address:v1.address,
    contactPerson:v1.contactPerson, contactNumber:v1.contactNumber, chassis:v1.chassis,
    year:v1.year, make:v1.make, model:v1.model, variant:v1.variant, customerTin:'',
    dateIn:todayISO(now), etd:todayISO(new Date(now.getTime()+86400000)), odometer:48250, jobHours:3,
    assessedBy:sm.id, saId:sa.id, mechanicIds:[m1.id], bayId:bayA.id,
    lines:[
      { id:uid('ln'), type:'part', ref:p1.id, desc:'Oil Filter', qty:1, price:220 },
      { id:uid('ln'), type:'part', ref:p2.id, desc:'Engine Oil 5W-40 (1L)', qty:4, price:480 },
      { id:uid('ln'), type:'labor', ref:l1.id, desc:'Change Oil Labor', qty:1, price:350 },
      { id:uid('ln'), type:'labor', ref:l3.id, desc:'General Diagnosis', qty:1, price:500 }
    ],
    partsSalesman:ps.id, siRef:'SI-2026-0456', pmsRef:'PMS-7781',
    notes:'Customer reports ticking noise on cold start. Check oil level & filter.',
    inspection:{ odometer:48250, fuel:50, lights:'None', condition:'Good, minor scratches RR door', testDrive:'' },
    checklist:{ created:true, leaveUnit:true, items:{ 'Spare tire':true,'Jack & wrench':true,'Floor mats':true,'Stereo':true,'OR/CR':false,'Valuables':false }, bodyNotes:'Scratch on rear right door logged.' },
    status:'B2', statusLog:[
      { time:new Date(now.getTime()-7200000).toISOString(), code:'A1', by:sa.id, note:'Unit received at front desk.' },
      { time:new Date(now.getTime()-5400000).toISOString(), code:'A3', by:sm.id, note:'Diagnosed: routine PMS + oil leak check.' },
      { time:new Date(now.getTime()-1800000).toISOString(), code:'B2', by:m1.id, note:'Parts complete, work ongoing.' }
    ],
    addlWork:[], approvedReleaseBy:null,
    discount:{ parts:0, labor:0, other:0, otherNote:'' }, payments:[], orNumber:null, billedAt:null, releaseSignature:null,
    photos:[], inventoryDeducted:false
  };

  var appt1 = { id:uid('ap'), date:todayISO(new Date(now.getTime()+86400000)), time:'09:00', plate:'XYZ 8899',
    customer:'Jowil Motor Sales Inc.', contactNumber:'0998 222 1010', vehicle:'2021 Mitsubishi Montero Sport',
    service:'PMS 35,000 km', assignedTo:sa.id, bayId:bayB.id, status:'Confirmed', notes:'Fleet unit', jobId:null };
  var appt2 = { id:uid('ap'), date:todayISO(new Date(now.getTime()+3*86400000)), time:'13:00', plate:'',
    customer:'Walk-in (Cruz)', contactNumber:'0917 555 1234', vehicle:'2019 Toyota Vios',
    service:'Brake inspection', assignedTo:sa.id, bayId:'TBA', status:'Booked', notes:'', jobId:null };

  var po1 = { id:uid('po'), no:'PO-0001', date:todayISO(now), supplier:'Fairview Auto Supply',
    status:'Ordered', lines:[ { partId:p4.id, name:'Air Filter', qty:12, cost:240 }, { partId:p3.id, name:'Front Brake Pads', qty:6, cost:850 } ],
    notes:'Restock fast movers.', receivedDate:null };

  return {
    version:2,
    shop:{ name:'Basic by JMSI', legal:'Jowil Motor Sales Inc.',
      address:'Commonwealth Ave., Fairview, Quezon City', contact:'(02) 8555-0100 · 0917 555 0100',
      tin:'009-123-456-000', businessStyle:'Basic by JMSI', vatReg:true, vatRate:12, orNext:1001,
      portalUrl:(typeof BRANCH!=='undefined'&&BRANCH.publicUrl)||'https://basicautomotiveservices.com', mechCommissionRate:5,
      partsSource:'local', partsApi:'', partsSyncedAt:null, theme:'light',
      checkpoints:['09:00','11:00','13:00','15:00','16:30'] },
    staff:[sv,sa,sm,m1,m2,ps],
    bays:[bayA,bayB,bayL],
    parts:[p1,p2,p3,p4],
    labor:[l4,l1,l2,l3],
    vehicles:[v1,v2],
    estimates:[],
    jobs:[job1],
    appointments:[appt1,appt2],
    purchaseOrders:[po1],
    counters:{ est:0, jo:1, or:1000, po:1 }
  };
}

/* ---- Boot ----------------------------------------------------------------- */
async function loadState(){
  var raw = await Storage.get(STORE_KEY);
  if (raw){
    try { S = JSON.parse(raw); } catch(e){ S = null; }
  }
  if (!S || S.version!==2){ S = seedState(); persist(); }
  // migration safety: ensure arrays exist
  ['staff','bays','parts','labor','vehicles','estimates','jobs','appointments','purchaseOrders'].forEach(function(k){
    if (!Array.isArray(S[k])) S[k]=[];
  });
  if (!S.counters) S.counters = { est:0, jo:0, or:1000, po:0 };
  if (S.shop && !S.shop.theme) S.shop.theme = 'light';
  if (ensurePmsLabor()) persist();   // guarantee the standard PMS LABOR item
  return S;
}

/* Export for Node smoke test */
if (typeof module!=='undefined' && module.exports){
  module.exports = { /* filled at bottom of concatenated build */ };
}
