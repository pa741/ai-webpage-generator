import { initializeApp } from 'firebase/app';
import { getAnalytics, type Analytics, isSupported } from 'firebase/analytics';
import { getFirestore, collection, addDoc, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { browser } from '$app/environment';
import {
  PUBLIC_FIREBASE_API_KEY,
  PUBLIC_FIREBASE_AUTH_DOMAIN,
  PUBLIC_FIREBASE_PROJECT_ID,
  PUBLIC_FIREBASE_STORAGE_BUCKET,
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  PUBLIC_FIREBASE_APP_ID,
  PUBLIC_FIREBASE_MEASUREMENT_ID,
  PUBLIC_TURNSTILE_SITE_KEY
} from '$env/static/public';
import {
  CloudflareProviderOptions,
} from '@cloudflare/turnstile-firebase-app-check';
import { CustomProvider, initializeAppCheck, type AppCheck } from 'firebase/app-check';
// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: PUBLIC_FIREBASE_API_KEY,
  authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: PUBLIC_FIREBASE_APP_ID,
  measurementId: PUBLIC_FIREBASE_MEASUREMENT_ID
};
const HTTP_ENDPOINT = 'https://europe-west2-generativewebpage.cloudfunctions.net/ext-cloudflare-turnstile-app-check-provider-tokenExchange';

export const app = initializeApp(firebaseConfig);
let cpo: CloudflareProviderOptions | undefined = undefined;
let check: AppCheck | undefined = undefined;
if (browser) {

  cpo = new CloudflareProviderOptions(HTTP_ENDPOINT, PUBLIC_TURNSTILE_SITE_KEY);
  const provider = new CustomProvider(cpo);
  check = initializeAppCheck(app, { provider });
}
export { cpo, check };

// Initialize Cloudflare Turnstile App Check

export const db = getFirestore(app);
export { collection, addDoc, serverTimestamp, type Timestamp };

// Initialize Analytics and get a reference to the service
export let analytics: Analytics | null = null;

isSupported().then((supported) => {
  if (supported && browser) {
    analytics = getAnalytics(app);
  } else {
    console.warn('Firebase Analytics is not supported in this environment.');
  }
}).catch((error) => {
  console.error('Error initializing Firebase Analytics:', error);
});