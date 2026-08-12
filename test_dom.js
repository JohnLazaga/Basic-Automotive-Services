/* DOM-mock render test: exercise the real render() pipeline as a browser would,
   for every nav view + portal mode. Confirms innerHTML assembly + afterRender. */

/* ---- DOM mock ---- */
function El(){ this.innerHTML=''; this.textContent=''; this._cls={}; this.children=[]; this.style={}; }
El.prototype.setAttribute=function(k,v){ this['_'+k]=v; };
El.prototype.getContext=function(){ return { lineWidth:0,lineCap:'',strokeStyle:'',beginPath(){},moveTo(){},lineTo(){},stroke(){},clearRect(){},drawImage(){} }; };
El.prototype.appendChild=function(c){ this.children.push(c); return c; };
El.prototype.addEventListener=function(){};
El.prototype.classList={ add(){}, remove(){}, toggle(){} };
El.prototype.toDataURL=function(){ return 'data:image/png;base64,AA'; };
El.prototype.querySelector=function(){ return null; };
El.prototype.getBoundingClientRect=function(){ return {left:0,top:0,width:1,height:1}; };

const els = {};
function getEl(id){ return els[id] || (els[id]=new El()); }

global.localStorage={ getItem(){return null;}, setItem(){}, removeItem(){} };
global.document={
  getElementById:getEl,
  createElement:function(){ var e=new El(); e.classList={add(){},remove(){},toggle(){}}; return e; },
  querySelector:function(){ return null; },
  querySelectorAll:function(){ return []; },
  addEventListener:function(){},
  head:new El(), body:new El(), readyState:'complete'
};
global.window={ addEventListener:function(){}, scrollTo:function(){}, QRCode:function(){ this.x=1; } };
global.navigator={ clipboard:{ writeText(){} } };

const path=require('path');
const M=require(path.join(__dirname,'_bundle.js'));

let pass=0, fail=0;
function ok(n,c){ if(c)pass++; else { fail++; console.log('  ✗ '+n); } }

const s=M.seedState(); M.setS(s);

// initial mount (builds the persistent shell once)
M.setRoute('board', null); M.render();
ok('shell mounts with sidebar', getEl('app').innerHTML.indexOf('sidebar')>-1);

const views=['board','appointments','jobs','estimates','reports','dailyclose','productivity','receivables','vehicles','parts','labor','purchaseorders','staff','settings'];
console.log('Rendering every view through the real render() pipeline (content-swap):');
views.forEach(function(v){
  try {
    M.setRoute(v, null);
    M.render();
    const content=getEl('content');
    ok('render '+v, typeof content.innerHTML==='string' && content.innerHTML.length>150);
  } catch(e){ ok('render '+v, false); console.log('     '+(e&&e.message)); }
});

// detail routes (content-swap)
[['job',s.jobs[0].id],['vehicle',s.vehicles[0].id],['po',s.purchaseOrders[0].id]].forEach(function(r){
  try { M.setRoute(r[0], r[1]); M.render(); ok('render '+r[0]+' detail', getEl('content').innerHTML.length>150); }
  catch(e){ ok('render '+r[0]+' detail', false); console.log('     '+e.message); }
});

/* ---- SKU entry: a long SKU must not keep a shorter SKU's part ---------------
   The lookup fires on every keystroke, so typing a 6-digit SKU walks through its
   own prefixes. Where those prefixes are real SKUs and the full number is not,
   the box used to keep the last prefix's name and prices under a SKU that has
   neither — and the line got saved that way. */
console.log('\nSKU entry (prefix walk-past):');
(function(){
  // Fields the line editor drives. A real <input> stringifies .value — mirror it.
  ['lnSku','lnDesc','lnNet','lnPrice','skuMsg'].forEach(function(id){
    var e=getEl(id); e._v='';
    Object.defineProperty(e,'value',{ configurable:true,
      get:function(){ return this._v; }, set:function(x){ this._v=String(x); } });
  });
  M.setCatalog({ '10':['WIDE ANGLE MIRROR',38.4,80], '103':['FOOT VALVE REPAIR KIT',420,950],
                 '10347':['ENGINE SUPPORT',240,350] });          // note: no '103474'
  function type(sku){ for(var i=1;i<=sku.length;i++){ getEl('lnSku').value=sku.slice(0,i); M.skuLookup(); } }

  getEl('lnDesc').value=''; getEl('lnNet').value=0; getEl('lnPrice').value=0;
  type('103474');
  ok('unmatched SKU keeps no prefix part name', getEl('lnDesc').value==='');
  ok('unmatched SKU keeps no prefix net price', String(getEl('lnNet').value)==='0');
  ok('unmatched SKU keeps no prefix SRP',       String(getEl('lnPrice').value)==='0');

  // an exact SKU must still auto-fill
  getEl('lnSku').value='10347'; M.skuLookup();
  ok('exact SKU still auto-fills', getEl('lnDesc').value==='ENGINE SUPPORT' &&
     String(getEl('lnPrice').value)==='350');

  // details typed by hand on an unmatched SKU are the encoder's — never wiped
  getEl('lnSku').value='103474'; M.skuLookup();
  getEl('lnDesc').value='CUSTOM BRACKET'; getEl('lnNet').value=111;
  getEl('lnSku').value='1034745'; M.skuLookup();
  ok('hand-typed details survive further unmatched keystrokes',
     getEl('lnDesc').value==='CUSTOM BRACKET' && String(getEl('lnNet').value)==='111');
})();

/* ---- Board search covers JO # and OR # ------------------------------------ */
console.log('\nBoard search (JO # / OR #):');
(function(){
  var j=s.jobs.filter(function(x){ return x.stage!=='Released'; })[0];
  if(!j){ ok('board search: an active job exists to search for', false); return; }
  j.orNumber = j.orNumber || 'OR-9001';
  function hit(q){ M.setBoardQ(q); var r=M.boardMatch(j); M.setBoardQ(''); return r; }
  ok('board finds a unit by full JO #', hit(j.no));
  ok('board finds a unit by bare JO digits', hit(String(Number(/(\d+)/.exec(j.no)[1]))));
  ok('board finds a unit by OR #', hit(j.orNumber));
  ok('board still finds a unit by plate', hit(j.plate));
  ok('board rejects a number belonging to no unit', !hit('ZZZ-99999'));
})();

/* ---- Sync merge: a remote snapshot must not eat unsaved local edits ---------
   persist() is debounced, so between an edit and its write Firestore has never
   heard of it (hasPendingWrites is false). The old wholesale S[c] = incoming
   dropped the edit AND reset its sync baseline, so it was never written — the
   parts that went missing off a job order. */
console.log('\nSync merge (remote snapshot vs unsaved local edits):');
(function(){
  function sync(c){                       // pretend everything currently in S is synced
    var m={}; (s[c]||[]).forEach(function(r){ if(r&&r.id) m[r.id]=JSON.stringify(M.cloudDocForm(c,r)); });
    M.setCloudSnap(c,m);
  }
  function serverCopy(c){                 // what the server would send back
    return JSON.parse(JSON.stringify((s[c]||[]).map(function(r){ return M.cloudDocForm(c,r); })));
  }

  var job = s.jobs[0];
  sync('jobs');
  var remote = serverCopy('jobs');        // server's view, taken BEFORE the local edit

  // encoder adds a part; it exists only in memory (debounce still running)
  job.lines.push({ id:'ln_test_1', type:'part', sku:'99999', desc:'TEST BRAKE PAD', qty:2, price:500, netPrice:300 });

  M.applyRemoteSnapshot('jobs', remote);  // a snapshot lands mid-window

  var after = M.getS().jobs.find(function(j){ return j.id===job.id; });
  var kept  = (after.lines||[]).some(function(l){ return l.id==='ln_test_1'; });
  ok('unsaved line survives a remote snapshot', kept);

  // and it must still be pending, or cloudPersist would skip writing it
  var baseline = M.getCloudSnap('jobs')[job.id];
  ok('held-back record is still queued for write',
     baseline !== JSON.stringify(M.cloudDocForm('jobs', after)));

  // a record created locally and not yet on the server must not be deleted
  var fresh = { id:'job_test_new', no:'JO-9999', plate:'TEST-1', owner:'X', stage:'Job Order',
                status:'A1', lines:[], payments:[], statusLog:[], dateIn:M.todayISO() };
  M.getS().jobs.push(fresh);
  M.applyRemoteSnapshot('jobs', remote);       // snapshot still has no such job
  ok('locally-created record survives a remote snapshot',
     M.getS().jobs.some(function(j){ return j.id==='job_test_new'; }));

  // clean, already-synced records still take the server's copy (live updates work)
  M.getS().jobs = M.getS().jobs.filter(function(j){ return j.id!=='job_test_new'; });
  var target = M.getS().jobs.find(function(j){ return j.id===job.id; });
  target.lines = target.lines.filter(function(l){ return l.id!=='ln_test_1'; });
  sync('jobs');
  var edited = JSON.parse(JSON.stringify(remote));
  var row = edited.find(function(j){ return j.id===job.id; });
  row.owner = 'REMOTE RENAME';
  M.applyRemoteSnapshot('jobs', edited);
  ok('clean record still accepts remote changes',
     M.getS().jobs.find(function(j){ return j.id===job.id; }).owner==='REMOTE RENAME');
})();

// portal mode through render()
try {
  M.setPortalId(function(){ return s.vehicles[0].id; });
  M.render();
  const html=getEl('app').innerHTML;
  ok('portal renders via render() and hides shop UI', html.indexOf('p-plate')>-1 && html.indexOf('class="sidebar"')===-1);
  M.setPortalId(function(){ return null; });
} catch(e){ ok('portal via render()', false); console.log('     '+e.message); }

console.log('\n  PASS: '+pass+'  FAIL: '+fail);
if(fail) process.exit(1); else console.log('  ✓ Full render pipeline OK with DOM present.');
