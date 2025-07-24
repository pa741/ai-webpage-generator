import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';

let app = initializeApp({
    credential: applicationDefault()
});
export default app;

