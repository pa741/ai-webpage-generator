import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from '$lib/logger';
import '$lib/firebase_admin';

const log = logger.child('component-loader');
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

    const stop = log.time('resolve', { requested_ids: uniqueIds });
    const db = getFirestore();
    const docs = await Promise.all(
        uniqueIds.map((id) => db.collection(COMPONENTS_COLLECTION).doc(id).get())
    );

    const missing: string[] = [];
    const noPath: string[] = [];
    const refs = await Promise.all(docs.map(async (doc) => {
        if (!doc.exists) {
            missing.push(doc.id);
            return undefined;
        }
        const data = doc.data() as { gsPath?: unknown; shortDeck?: unknown };
        const gsPath = typeof data.gsPath === 'string' ? data.gsPath : '';
        if (!gsPath) {
            noPath.push(doc.id);
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

    const resolved = refs.filter((item): item is ComponentScriptRef => Boolean(item));
    stop({
        resolved_count: resolved.length,
        missing,
        without_gs_path: noPath
    });
    if (missing.length > 0) {
        log.warn('components_missing', { ids: missing });
    }
    return resolved;
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
        log.warn('signed_url_failed_fallback_public', { gsPath, error });
        const encodedObjectPath = objectPath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return `https://storage.googleapis.com/${bucketName}/${encodedObjectPath}`;
    }
}
