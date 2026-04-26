import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import '$lib/firebase_admin';

const COMPONENTS_COLLECTION = 'components';
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

export interface ComponentScriptRef {
    id: string;
    src: string;
    shortDeck: string;
}

export async function resolveComponentScripts(ids: string[]): Promise<ComponentScriptRef[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    if (uniqueIds.length === 0) {
        return [];
    }

    const db = getFirestore();
    const docs = await Promise.all(
        uniqueIds.map((id) => db.collection(COMPONENTS_COLLECTION).doc(id).get())
    );

    const refs = await Promise.all(docs.map(async (doc) => {
        if (!doc.exists) {
            return undefined;
        }
        const data = doc.data() as { gsPath?: unknown; shortDeck?: unknown };
        const gsPath = typeof data.gsPath === 'string' ? data.gsPath : '';
        if (!gsPath) {
            return undefined;
        }
        const src = await signGsPath(gsPath);
        if (!src) {
            return undefined;
        }
        return {
            id: doc.id,
            src,
            shortDeck: typeof data.shortDeck === 'string' ? data.shortDeck : ''
        } as ComponentScriptRef;
    }));

    return refs.filter((item): item is ComponentScriptRef => Boolean(item));
}

async function signGsPath(gsPath: string): Promise<string | null> {
    if (gsPath.startsWith('http://') || gsPath.startsWith('https://')) {
        return gsPath;
    }

    const match = gsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
        return null;
    }

    const bucketName = match[1];
    const objectPath = match[2];
    const file = getStorage().bucket(bucketName).file(objectPath);

    try {
        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + SIGNED_URL_TTL_MS
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
