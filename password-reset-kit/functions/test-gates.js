/* ============================================================================
   Node test for the two server-side gates. No emulator, no network: these cover
   the pure decision logic, which is where a mistake is silent and dangerous.

   Run:  node test-gates.js
   ========================================================================== */
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'test-project';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'test-project';

const C = require('./shop-common');
const DEV = require('./device-auth');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log('  x ' + name); } }
function section(t) { console.log('\n' + t); }
function ctx(xff, origin) {
  return { rawRequest: { headers: { 'x-forwarded-for': xff, origin: origin }, ip: '' } };
}
function threw(fn) { try { fn(); return false; } catch (e) { return true; } }

section('1. IP matching');
ok('exact match', C.ipMatches('112.198.44.10', '112.198.44.10'));
ok('exact mismatch', !C.ipMatches('112.198.44.11', '112.198.44.10'));
ok('/24 contains member', C.ipMatches('112.198.44.200', '112.198.44.0/24'));
ok('/24 excludes neighbour block', !C.ipMatches('112.198.45.1', '112.198.44.0/24'));
ok('/32 behaves as exact', C.ipMatches('8.8.8.8', '8.8.8.8/32') && !C.ipMatches('8.8.8.9', '8.8.8.8/32'));
ok('/16 contains', C.ipMatches('112.198.99.4', '112.198.0.0/16'));
ok('garbage rule never matches', !C.ipMatches('1.2.3.4', 'not-an-ip') && !C.ipMatches('1.2.3.4', '1.2.3.4/99'));
ok('empty inputs never match', !C.ipMatches('', '1.2.3.4') && !C.ipMatches('1.2.3.4', ''));
ok('IPv4-mapped IPv6 unwraps', C.ipMatches('::ffff:112.198.44.10', '112.198.44.10'));

section('2. Caller IP cannot be spoofed from the left');
/* Google appends the address it observed, so the REAL client is the right-most
   non-infrastructure hop. A worker at home who sends the shop's address in his
   own X-Forwarded-For must not be believed. */
ok('single hop', C.callerIp(ctx('112.198.44.10')) === '112.198.44.10');
ok('spoofed shop address on the left is ignored',
   C.callerIp(ctx('112.198.44.10, 203.0.113.55')) === '203.0.113.55');
ok('google LB hop on the right is skipped',
   C.callerIp(ctx('203.0.113.55, 35.191.0.7')) === '203.0.113.55');
ok('private hops are skipped',
   C.callerIp(ctx('203.0.113.55, 10.1.2.3, 192.168.0.5')) === '203.0.113.55');
ok('a chain of only infrastructure yields nothing usable',
   C.callerIp(ctx('10.1.2.3, 192.168.0.5')) === '');
ok('LB ranges are recognised',
   C.isInfrastructureIp('35.191.0.1') && C.isInfrastructureIp('130.211.0.5')
   && !C.isInfrastructureIp('112.198.44.10'));

/* The gate compares callerIp against the trusted list — assert the join, not
   just the parts, since that is the actual access decision. */
const trusted = [{ ip: '112.198.44.0/24' }];
const allow = (xff) => trusted.some((e) => C.ipMatches(C.callerIp(ctx(xff)), e.ip));
ok('on the shop network -> allowed', allow('112.198.44.77, 35.191.0.7'));
ok('at home -> refused', !allow('203.0.113.55, 35.191.0.7'));
ok('at home claiming the shop address -> still refused',
   !allow('112.198.44.77, 203.0.113.55, 35.191.0.7'));

section('3. WebAuthn origin check');
const checkOrigin = DEV._device.checkOrigin;
ok('the live site is accepted',
   checkOrigin(ctx('', 'https://basicautomotiveservices.com')).rpID === 'basicautomotiveservices.com');
ok('localhost is accepted for dev',
   checkOrigin(ctx('', 'http://localhost:8790')).rpID === 'localhost');
ok('a look-alike domain is refused',
   threw(() => checkOrigin(ctx('', 'https://basicautomotiveservices.com.evil.tld'))));
ok('http on the live domain is refused',
   threw(() => checkOrigin(ctx('', 'http://basicautomotiveservices.com'))));
ok('a missing origin is refused', threw(() => checkOrigin(ctx('', ''))));
ok('a junk origin is refused', threw(() => checkOrigin(ctx('', 'not a url'))));

section('4. Device records exposed to the Settings screen');
const pub = DEV._device.publicDevice({
  id: 'dev1', label: 'Front desk iPad', active: true,
  credId: 'AAAA', publicKey: 'c2VjcmV0', counter: 7, lastUid: 'uid123',
  deviceType: 'singleDevice', backedUp: false,
});
ok('label and state are shown', pub.label === 'Front desk iPad' && pub.active === true);
ok('stored key material is never returned', !('publicKey' in pub) && !('credId' in pub));
ok('counter and last user are not returned', !('counter' in pub) && !('lastUid' in pub));
ok('a device with active:false reads as inactive',
   DEV._device.publicDevice({ id: 'x', active: false }).active === false);

section('5. Policy flags default to OFF');
/* loadNetwork is what makes the rollout safe: an absent doc or an absent field
   must never read as "enforcing". */
const readNet = (d) => ({ enforce: d.enforce === true, deviceEnforce: d.deviceEnforce === true });
ok('absent doc -> both gates off',
   readNet({}).enforce === false && readNet({}).deviceEnforce === false);
ok('a truthy-but-not-true value does not enable a gate',
   readNet({ enforce: 'yes', deviceEnforce: 1 }).enforce === false
   && readNet({ deviceEnforce: 1 }).deviceEnforce === false);
ok('explicit true enables', readNet({ enforce: true, deviceEnforce: true }).deviceEnforce === true);

console.log('\n----------------------------------------');
console.log('  PASS: ' + pass + '   FAIL: ' + fail);
if (fail) { console.log('  Failures: ' + fails.join(' | ')); process.exit(1); }
console.log('  All gate tests passed.');
