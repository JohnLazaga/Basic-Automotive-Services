/* ============================================================================
   PART 13 — Parts reference catalog (read-only SKU lookup).
   Loads the login-protected, compressed catalog docs from Firestore
   (collection "catalog"), decompresses them in the browser, and builds an
   in-memory SKU -> {name, net, srp} index. Preloaded after sign-in so the
   line-editor lookup is instant. Never touches stock (SQL is the source).
   ========================================================================== */

var CATALOG = null;          /* { sku: [name, net, srp] } */
var CATALOG_STATE = 'idle';  /* idle | loading | ready | error */
var CATALOG_META = null;

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
  if (typeof FB==='undefined' || !FB.ready || !FB.user) return;
  if (CATALOG_STATE==='loading') return;
  if (CATALOG_STATE==='ready' && !force) return;
  CATALOG_STATE='loading';
  try {
    var meta = await FB.db.collection('catalog').doc('_meta').get();
    if (!meta.exists){ CATALOG={}; CATALOG_STATE='ready'; return; }
    CATALOG_META = meta.data();
    var map = {};
    for (var i=0; i<CATALOG_META.chunks; i++){
      var d = await FB.db.collection('catalog').doc('chunk_'+i).get();
      if (!d.exists) continue;
      var arr = JSON.parse(await gunzipB64(d.data().data));
      for (var k=0;k<arr.length;k++){ var r=arr[k]; map[String(r[0])] = [r[1], r[2], r[3]]; }
    }
    CATALOG = map; CATALOG_STATE='ready';
    if (typeof console!=='undefined') console.log('Parts catalog ready: '+Object.keys(map).length+' SKUs (v'+CATALOG_META.version+')');
    // refresh the SKU hint if a line modal is open
    if (typeof document!=='undefined'){ var m=document.getElementById('skuMsg'); if(m && typeof catalogHint==='function') m.textContent=catalogHint(); }
  } catch(e){
    if (typeof console!=='undefined') console.error('catalog load failed', e);
    CATALOG_STATE='error';
  }
}

function catalogLookup(sku){
  if (!CATALOG) return null;
  var r = CATALOG[String(sku).trim()];
  return r ? { name:r[0], net:r[1], srp:r[2] } : null;
}
function catalogCount(){ return CATALOG ? Object.keys(CATALOG).length : 0; }
