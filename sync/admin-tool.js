/* Basic by JMSI — Staff Account Admin (runs on the shop PC only).
   Uses the Firebase Admin SDK (service account) to do the things the web app
   can't do client-side: reset a staff password, or fully remove an account.
   No Blaze required. The service account key stays local and is git-ignored. */
const path = require('path');
const readline = require('readline');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const auth = getAuth();
const db = getFirestore();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

(async () => {
  console.log('\n==============================================');
  console.log('   Basic by JMSI  —  Staff Account Admin');
  console.log('==============================================\n');

  const docs = (await db.collection('users').get()).docs.map((d) => Object.assign({ uid: d.id }, d.data()));
  docs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  if (!docs.length) { console.log('No staff accounts found.'); rl.close(); return; }

  console.log('Staff accounts:\n');
  docs.forEach((u, i) => {
    const who = u.username ? ('@' + u.username) : (u.email || '');
    const tag = u.isAdmin ? 'ADMIN' : (u.role || '');
    const off = u.active === false ? '  [disabled]' : '';
    console.log('  [' + (i + 1) + ']  ' + (u.name || '(no name)').padEnd(22) + who.padEnd(24) + tag + off);
  });

  const pick = (await ask('\nPick an account number (or press Enter to quit): ')).trim();
  if (!pick) { rl.close(); return; }
  const u = docs[parseInt(pick, 10) - 1];
  if (!u) { console.log('Invalid choice.'); rl.close(); return; }

  console.log('\nSelected: ' + (u.name || '') + '  (' + (u.username ? '@' + u.username : u.email) + ')');
  console.log('  [1]  Reset password');
  console.log('  [2]  Delete account (frees the username for reuse)');
  console.log('  [3]  Cancel');
  const act = (await ask('Action: ')).trim();

  if (act === '1') {
    const np = await ask('New password (min 6 characters): ');
    if (!np || np.length < 6) { console.log('\nPassword too short — nothing changed.'); rl.close(); return; }
    await auth.updateUser(u.uid, { password: np });
    console.log('\n  Password reset for ' + (u.username ? '@' + u.username : u.email) + '.');
    console.log('  Give them this new password — they can sign in right away.\n');
  } else if (act === '2') {
    const c = await ask('Type DELETE to permanently remove ' + (u.name || u.username) + ': ');
    if (c.trim() === 'DELETE') {
      await auth.deleteUser(u.uid).catch((e) => console.log('  (auth user already gone: ' + e.code + ')'));
      await db.collection('users').doc(u.uid).delete();
      console.log('\n  Account fully removed.\n');
    } else { console.log('\n  Aborted — nothing deleted.\n'); }
  } else {
    console.log('\n  Cancelled.\n');
  }
  rl.close();
})().catch((e) => { console.error('\nError:', e.message); rl.close(); process.exit(1); });
