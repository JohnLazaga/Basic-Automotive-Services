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
