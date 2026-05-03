import { db, app } from '$lib/firebase';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

function gsPathToPublicUrl(gsPath: string): string | null {
    const match = gsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, bucket, objectPath] = match;
    if (import.meta.env.DEV) {
        return `http://127.0.0.1:9199/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
    }
    const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
    return `https://storage.googleapis.com/${bucket}/${encoded}`;
}

/**
 * Subscribes to Firestore snapshots for the given component IDs (default scope
 * and the authenticated user's override scope). When a component is updated,
 * reads the new gsPath directly from the snapshot, fetches the JS source,
 * renames the custom element tag to a versioned name (e.g. my-component →
 * my-component-v3f9a), injects it via a blob URL, then swaps all existing DOM
 * instances to the new tag — avoiding the customElements.define() collision
 * restriction with no server round-trip and no prompt changes.
 *
 * Returns a cleanup function that unsubscribes all listeners.
 */
export function watchComponents(componentIds: string[]): () => void {
    if (!componentIds.length) return () => {};

    const auth = getAuth(app);
    const baseline = new Map<string, number>();
    const unsubscribers: (() => void)[] = [];
    const reloading = new Set<string>();

    async function hotReload(componentId: string, gsPath: string) {
        if (reloading.has(componentId)) return;
        reloading.add(componentId);
        try {
            const publicUrl = gsPathToPublicUrl(gsPath);
            if (!publicUrl) return;

            const textRes = await fetch(publicUrl);
            if (!textRes.ok) return;
            const source = await textRes.text();

            // Rename the customElements.define tag so it doesn't collide with the
            // already-registered original. A random suffix makes each reload unique.
            const version = Math.random().toString(36).slice(2, 8);
            const newTag = `${componentId}-v${version}`;
            const patched = source.replace(
                /customElements\.define\(\s*(['"`])([^'"`]+)\1/,
                `customElements.define('${newTag}'`
            );

            const blob = new Blob([patched], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            await new Promise<void>((resolve) => {
                const script = document.createElement('script');
                script.type = 'module';
                script.src = blobUrl;
                script.onload = () => resolve();
                script.onerror = () => resolve();
                document.head.appendChild(script);
            });
            URL.revokeObjectURL(blobUrl);

            // Swap every live instance to the new versioned tag, preserving attributes.
            document.querySelectorAll(componentId).forEach((el) => {
                const replacement = document.createElement(newTag);
                for (const attr of Array.from(el.attributes)) {
                    replacement.setAttribute(attr.name, attr.value);
                }
                el.replaceWith(replacement);
            });
        } finally {
            reloading.delete(componentId);
        }
    }

    function subscribe(segments: string[], componentId: string) {
        const key = segments.join('/');
        const ref = doc(db, segments[0], ...segments.slice(1));
        const unsub = onSnapshot(ref, (snap: DocumentSnapshot) => {
            if (!snap.exists()) return;
            const data = snap.data() as { updatedAt?: { toMillis?: () => number }; gsPath?: string } | undefined;
            const updatedAt = data?.updatedAt?.toMillis?.() ?? 0;
            const gsPath = data?.gsPath ?? '';
            if (!baseline.has(key)) {
                baseline.set(key, updatedAt);
                return;
            }
            if (updatedAt > (baseline.get(key) ?? 0) && gsPath) {
                baseline.set(key, updatedAt);
                hotReload(componentId, gsPath);
            }
        });
        unsubscribers.push(unsub);
    }

    for (const id of componentIds) {
        subscribe(['components', id], id);
    }

    const authUnsub = onAuthStateChanged(auth, (user) => {
        if (!user) return;
        for (const id of componentIds) {
            subscribe(['users', user.uid, 'components', id], id);
        }
    });
    unsubscribers.push(authUnsub);

    return () => unsubscribers.forEach((u) => u());
}
