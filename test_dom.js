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
