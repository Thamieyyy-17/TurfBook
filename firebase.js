import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseConfigured = ['apiKey','authDomain','projectId','appId'].every(k => !!firebaseConfig[k]);
export const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, 'asia-south1') : null;
export const call = (name, data) => httpsCallable(functions, name)(data).then(r => r.data);
export const ownerEmail = code => call('ownerLogin', { code }).then(r => r.email);
export async function ownerSignIn(code, password) {
  const email = await ownerEmail(code);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const token = await credential.user.getIdTokenResult(true);
  if (!token.claims.ownerId) { await signOut(auth); throw new Error('This account is not enabled as a TurfBook owner.'); }
  return credential.user;
}
export async function adminSignInAndBootstrap(secret) {
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  await call('bootstrapAdmin', { secret });
  await credential.user.getIdToken(true);
  return credential.user;
}
export const watchTurfs = cb => onSnapshot(collection(db,'turfs'), s => cb(s.docs.map(d=>({id:d.id,...d.data()}))));
export const watchSettings = cb => onSnapshot(doc(db,'settings','public'), s => cb(s.exists()?s.data():{}));
export { signOut };
