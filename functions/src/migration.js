// functions/src/migration.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
// HAPUS BARIS INI: admin.initializeApp(); // <--- BARIS INI YANG HARUS DIHAPUS

async function migrateExistingUsernamesToLowercase() {
  const usersRef = admin.firestore().collection('users');
  const snapshot = await usersRef.get();

  const batch = admin.firestore().batch();
  let updateCount = 0;

  snapshot.forEach(doc => {
    const userData = doc.data();
    if (userData.username && !userData.usernameLower) {
      const usernameOriginal = userData.username;
      const usernameLower = usernameOriginal.toLowerCase();

      const userDocRef = usersRef.doc(doc.id);
      batch.update(userDocRef, { usernameLower: usernameLower });
      updateCount++;
    }
  });

  if (updateCount > 0) {
    console.log(`Committing batch update for ${updateCount} users...`);
    await batch.commit();
    console.log('Migration complete. All existing users in "users" collection now have "usernameLower" field.');
  } else {
    console.log('No users to migrate or all already have usernameLower field.');
  }
}

exports.runUsernameLowercaseMigration = functions.https.onCall(async (data, context) => {
   // PERHATIAN: Untuk keamanan, Anda harus menambahkan pemeriksaan otentikasi/otorisasi di sini
   // agar fungsi ini hanya dapat dipanggil oleh pengguna atau sistem yang berwenang.
   // Contoh: if (!context.auth) { throw new functions.https.HttpsError('unauthenticated', 'Function must be called while authenticated.'); }
   // Atau batasi hanya untuk admin: if (!context.auth.token.admin) { throw new functions.https.HttpsError('permission-denied', 'Only admins can run this migration.'); }

   console.log('Migration function triggered.');
   await migrateExistingUsernamesToLowercase();
   return { status: 'Migration initiated. Check Cloud Function logs for details.' };
});