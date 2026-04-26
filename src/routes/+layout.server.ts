import type { LayoutServerLoad } from './$types';
import { getAppCheck } from 'firebase-admin/app-check';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import '$lib/firebase_admin';

interface ComponentScriptRef {
    id: string;
    src: string;
    gsPath: string;
    shortDeck: string;
}

const COMPONENTS_COLLECTION = 'components';
const COMPONENT_SCRIPT_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedComponentScripts: ComponentScriptRef[] = [];
let cachedComponentScriptsExpiresAt = 0;

async function getComponentScripts(): Promise<ComponentScriptRef[]> {
    const now = Date.now();
    if (now < cachedComponentScriptsExpiresAt) {
        return cachedComponentScripts;
    }

    const db = getFirestore();
    const snapshot = await db.collection(COMPONENTS_COLLECTION).get();

    const refs = await Promise.all(snapshot.docs.map(async (doc) => {
        const data = doc.data() as { gsPath?: unknown; shortDeck?: unknown };
        const gsPath = typeof data.gsPath === 'string' ? data.gsPath : '';
        if (!gsPath) {
            return undefined;
        }

        const src = await getScriptSrcFromGsPath(gsPath);
        if (!src) {
            return undefined;
        }

        return {
            id: doc.id,
            src,
            gsPath,
            shortDeck: typeof data.shortDeck === 'string' ? data.shortDeck : ''
        } as ComponentScriptRef;
    }));

    cachedComponentScripts = refs
        .filter((item): item is ComponentScriptRef => Boolean(item))
        .sort((a, b) => a.id.localeCompare(b.id));
    cachedComponentScriptsExpiresAt = now + COMPONENT_SCRIPT_CACHE_TTL_MS;
    return cachedComponentScripts;
}

async function getScriptSrcFromGsPath(gsPath: string): Promise<string | null> {
    if (gsPath.startsWith('http://') || gsPath.startsWith('https://')) {
        return gsPath;
    }

    const match = gsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
        return null;
    }

    const bucketName = match[1];
    const objectPath = match[2];
    const storage = getStorage();
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);

    try {
        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + (60 * 60 * 1000)
        });
        return signedUrl;
    } catch (error) {
        console.error(`Unable to generate signed url for ${gsPath}`, error);
        const encodedObjectPath = objectPath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return `https://storage.googleapis.com/${bucketName}/${encodedObjectPath}`;
    }
}

export const load: LayoutServerLoad = async (data) => {
    let componentScripts: ComponentScriptRef[] = [];

    try {
        componentScripts = await getComponentScripts();
    } catch (error) {
        console.error('Failed to fetch component scripts:', error);
    }

    if(import.meta.env.DEV){
        console.log("Running in development mode, skipping App Check validation.");
        return {
            token: 'dev-token',
            componentScripts,
        };
    }
    let validationCookie = data.locals.validationCookie;
    if (validationCookie) {
        try {
            const appCheck = getAppCheck();
            await appCheck.verifyToken(validationCookie);
            //data.locals.validationCookie = validationCookie; // Store the valid token in locals
            console.log('App Check Server token is valid');
        } catch (error) {
            console.error('App Check token validation failed:', error);
            // If validation fails, clear the cookie
            data.cookies.delete('__session', { path: '/' });
            validationCookie = undefined; // Clear the variable as well
        }
    }
    return {
        token: validationCookie,
        componentScripts,
    };
};


