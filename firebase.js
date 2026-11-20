import { initializeApp, getApps, getApp } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => Boolean(firebaseConfig[key]));
export const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
// Let the Firebase SDK choose a supported persistence mechanism for the WebView/browser.
// TurfBook application records are stored in Firestore.
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, 'asia-south1') : null;
let messagingInstance = null;
async function messaging() {
  if (!app || typeof window === 'undefined' || !('serviceWorker' in navigator) || !(await isSupported())) return null;
  if (!messagingInstance) messagingInstance = getMessaging(app);
  return messagingInstance;
}
export async function registerWebPush({ requestPermission = true } = {}) {
  const service = await messaging();
  if (!service || !('Notification' in window)) return null;
  if (Notification.permission === 'default' && requestPermission) await Notification.requestPermission();
  if (Notification.permission !== 'granted') return null;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error('Firebase VAPID public key is missing from the build configuration.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  return getToken(service, { vapidKey, serviceWorkerRegistration: registration });
}
export async function listenForWebMessages(callback) {
  const service = await messaging();
  return service ? onMessage(service, callback) : () => {};
}
export const call = (name, data) => {
  if (!functions) return Promise.reject(new Error('Firebase is not configured.'));
  return httpsCallable(functions, name)(data).then(result => result.data);
};

const ownerEmail = code => call('ownerLogin', { code }).then(result => result.email);
export async function ownerSignIn(code, password) {
  const email = await ownerEmail(code);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const token = await credential.user.getIdTokenResult(true);
  if (!token.claims.ownerId) {
    await signOut(auth);
    throw new Error('This account is not enabled as a TurfBook owner.');
  }
  return credential.user;
}

export async function isRegisteredAdmin(user) {
  if (!user || !db) return false;
  const adminSnapshot = await getDoc(doc(db, 'admins', user.uid));
  return adminSnapshot.exists() && adminSnapshot.data()?.active === true;
}

// Admin authorization is an explicit Firestore allow-list entry; no bootstrap callable or secret is used.
export async function adminSignIn() {
  let credential;
  if (Capacitor.isNativePlatform()) {
    // Native Google picker, then exchange its Google ID token into the JS Firebase Auth session.
    const nativeResult = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    const idToken = nativeResult.credential?.idToken;
    if (!idToken) throw new Error('Google sign-in did not return an ID token. Check the Android SHA-1 and OAuth setup.');
    credential = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } else {
    credential = await signInWithPopup(auth, new GoogleAuthProvider());
  }
  if (!(await isRegisteredAdmin(credential.user))) {
    await signOutTurfBook();
    throw new Error('This Google account is not registered as a TurfBook admin. Add its UID to Firestore admins first.');
  }
  return credential.user;
}

export async function signOutTurfBook() {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut().catch(() => {});
  }
  if (auth) await signOut(auth);
}

export const watchTurfs = (callback, onError) => onSnapshot(collection(db, 'turfs'), snapshot => callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() }))), onError);
export const watchSettings = (callback, onError) => onSnapshot(doc(db, 'settings', 'public'), snapshot => callback(snapshot.exists() ? snapshot.data() : {}), onError);
export { signOut };
