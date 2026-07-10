/* ============================================================================
   PART 13 — Parts reference catalog (read-only SKU lookup).
   Builds an in-memory SKU -> {name, net, srp} index, preloaded after sign-in
   so the line-editor lookup is instant. Never touches stock.

   Two sources, chosen by the branch config (BRANCH.partsSource):
     • 'local' — this branch's own parts server on the LAN (BRANCH.partsUrl).
                 One gzipped download from /api/all. Works offline, no cloud.
     • 'cloud' — the login-protected, compressed catalog docs in Firestore.
   ========================================================================== */

var CATALOG = null;          /* { sku: [name, net, srp] } */
var CATALOG_STATE = 'idle';  /* idle | loading | ready | error */
var CATALOG_META = null;

/* Serve parts from the branch's local server? (config-driven, no Firebase needed) */
function partsFromLocal(){
  return typeof BRANCH!=='undefined' && BRANCH && BRANCH.partsSource==='local' && !!BRANCH.partsUrl;
}

async function gunzipB64(b64){
  var bytes = Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); });
  if (typeof DecompressionStream!=='undefined'){
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  // very old browser fallback: no decompression available
  throw new Error('gzip not supported in this browser');
}

async function loadCatalog(force){
  if (CATALOG_STATE==='loading') return 'busy';
  if (CATALOG_STATE==='ready' && !force) return 'ready';
  if (partsFromLocal()) return loadCatalogLocal();
  return loadCatalogCloud();
}

/* ---- local branch server: one gzipped download of the whole catalog ---- */
async function loadCatalogLocal(){
  CATALOG_STATE='loading';
  try {
    var base = String(BRANCH.partsUrl).replace(/\/+$/,'');
    var res = await fetch(base + '/api/all');           // Content-Encoding: gzip (auto-decoded)
    if (!res.ok) throw new Error('HTTP '+res.status);
    var data = await res.json();
    var arr = data.parts || [];
    var map = {};
    for (var k=0;k<arr.length;k++){ var r=arr[k]; map[String(r[0])] = [r[1], r[2], r[3]]; }
    CATALOG = map; CATALOG_STATE='ready';
    CATALOG_META = { version:data.version, count:arr.length, source:'local' };
    if (typeof console!=='undefined') console.log('Parts catalog (local) ready: '+arr.length+' SKUs (v'+data.version+') from '+base);
    if (typeof document!=='undefined'){ var m=document.getElementById('skuMsg'); if(m && typeof catalogHint==='function') m.textContent=catalogHint(); }
  } catch(e){
    if (typeof console!=='undefined') console.error('local catalog load failed', e);
    CATALOG_STATE='error';
  }
}

/* ---- cloud (Firestore) source ----
   Returns a short status string: 'unchanged' | 'updated' | 'empty' | 'noauth' | 'error'. */
async function loadCatalogCloud(){
  if (typeof FB==='undefined' || !FB.ready || !FB.user) return 'noauth';
  CATALOG_STATE='loading';
  try {
    var meta = await bcol('catalog').doc('_meta').get();
    if (!meta.exists){ CATALOG={}; CATALOG_META=null; CATALOG_STATE='ready'; return 'empty'; }
    var data = meta.data();
    // Already hold this exact version? The version is a content hash, so a matching
    // one means the catalog is unchanged — skip re-downloading every chunk.
    if (CATALOG && CATALOG_META && CATALOG_META.version===data.version && Object.keys(CATALOG).length){
      CATALOG_STATE='ready';
      if (typeof console!=='undefined') console.log('Parts catalog already current (v'+data.version+') — no re-download.');
      return 'unchanged';
    }
    // Fetch all chunk docs in parallel, then build the index.
    var gets = [];
    for (var i=0; i<data.chunks; i++) gets.push(bcol('catalog').doc('chunk_'+i).get());
    var docs = await Promise.all(gets);
    var map = {};
    for (var j=0; j<docs.length; j++){
      var d = docs[j];
      if (!d.exists) continue;
      var arr = JSON.parse(await gunzipB64(d.data().data));
      for (var k=0;k<arr.length;k++){ var r=arr[k]; map[String(r[0])] = [r[1], r[2], r[3]]; }
    }
    // Commit only after a successful rebuild (a failed refresh keeps the old catalog).
    CATALOG = map; CATALOG_META = data; CATALOG_STATE='ready';
    if (typeof console!=='undefined') console.log('Parts catalog ready: '+Object.keys(map).length+' SKUs (v'+data.version+')');
    // refresh the SKU hint if a line modal is open
    if (typeof document!=='undefined'){ var m=document.getElementById('skuMsg'); if(m && typeof catalogHint==='function') m.textContent=catalogHint(); }
    return 'updated';
  } catch(e){
    if (typeof console!=='undefined') console.error('catalog load failed', e);
    CATALOG_STATE='error';
    return 'error';
  }
}

function catalogLookup(sku){
  if (!CATALOG) return null;
  var r = CATALOG[String(sku).trim()];
  return r ? { name:r[0], net:r[1], srp:r[2] } : null;
}
function catalogCount(){ return CATALOG ? Object.keys(CATALOG).length : 0; }
