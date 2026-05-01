import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from '$lib/logger';
import '$lib/firebase_admin';

const log = logger.child('component-loader');
const COMPONENTS_COLLECTION = 'components';
const USERS_COLLECTION = 'users';
const USER_COMPONENTS_SUBCOLLECTION = 'components';
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

// Kept in sync with BUILT_IN_COMPONENTS in functions/src/component-manager.ts.
// Built-ins ship as Svelte-compiled custom elements in the page bundle; we
// must NOT inject a <script> for them.
const BUILT_IN_COMPONENT_IDS = new Set<string>([
    'google-login'
]);

export interface ComponentScriptRef {
    id: string;
    src: string;
    shortDesc: string;
}
async function getDependenciesOfComponent(id: string): Promise<string[]> {
    const db = getFirestore();
    const doc = await db.collection(COMPONENTS_COLLECTION).doc(id).get();
    if (!doc.exists) {
        return [];
    }
    const data = doc.data();
    if (!data || !Array.isArray(data.dependencies)) {
        return [];
    }
    return data.dependencies.filter((d): d is string => typeof d === 'string' && d.trim().length > 0);
}
export async function resolveComponentScripts(
    ids: string[],
    userId?: string | null
): Promise<ComponentScriptRef[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    if (uniqueIds.length === 0) {
        return [];
    }

    const stop = log.time('resolve', { requested_ids: uniqueIds, userId: userId ?? null });
    const db = getFirestore();

    const externalIds = uniqueIds.filter((id) => !BUILT_IN_COMPONENT_IDS.has(id));
    const builtIns = uniqueIds.filter((id) => BUILT_IN_COMPONENT_IDS.has(id));
    let allIdsToResolve = new Set(externalIds);
    for (const id of externalIds) {
        const deps = await getDependenciesOfComponent(id);
        deps.forEach((dep) => allIdsToResolve.add(dep));
    }
    let allIdsArray = Array.from(allIdsToResolve);
    

    const docPairs = await Promise.all(allIdsArray.map(async (id) => {
        const [defaultDoc, userDoc] = await Promise.all([
            db.collection(COMPONENTS_COLLECTION).doc(id).get(),
            userId
                ? db.collection(USERS_COLLECTION).doc(userId).collection(USER_COMPONENTS_SUBCOLLECTION).doc(id).get()
                : Promise.resolve(null as DocumentSnapshot | null)
        ]);
        return { id, defaultDoc, userDoc };
    }));

    const missing: string[] = [];
    const noPath: string[] = [];
    const overrides: string[] = [];

    const refs = await Promise.all(docPairs.map(async ({ id, defaultDoc, userDoc }) => {
        const userData = userDoc?.exists ? (userDoc.data() as { gsPath?: unknown; shortDesc?: unknown }) : undefined;
        const defaultData = defaultDoc.exists ? (defaultDoc.data() as { gsPath?: unknown; shortDesc?: unknown }) : undefined;

        const userGsPath = typeof userData?.gsPath === 'string' ? userData.gsPath : '';
        const defaultGsPath = typeof defaultData?.gsPath === 'string' ? defaultData.gsPath : '';

        let gsPath = '';
        let shortDesc = '';
        if (userGsPath) {
            gsPath = userGsPath;
            shortDesc = typeof userData?.shortDesc === 'string' ? userData!.shortDesc : '';
            overrides.push(id);
        } else if (defaultGsPath) {
            gsPath = defaultGsPath;
            shortDesc = typeof defaultData?.shortDesc === 'string' ? defaultData!.shortDesc : '';
        } else if (!defaultDoc.exists && !(userDoc?.exists)) {
            missing.push(id);
            return undefined;
        } else {
            noPath.push(id);
            return undefined;
        }

        const src = await signGsPath(gsPath);
        if (!src) {
            return undefined;
        }
        return { id, src, shortDesc } as ComponentScriptRef;
    }));

    const resolved = refs.filter((item): item is ComponentScriptRef => Boolean(item));
    stop({
        resolved_count: resolved.length,
        resolved_scripts: resolved.map((r) => ({ id: r.id, src: r.src })),
        missing,
        without_gs_path: noPath,
        overrides,
        built_ins_skipped: builtIns
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
