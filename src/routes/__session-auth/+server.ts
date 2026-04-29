import { json } from '@sveltejs/kit';
import { getAuth } from 'firebase-admin/auth';
import { logger } from '$lib/logger';
import '$lib/firebase_admin';
import type { RequestHandler } from './$types';

const log = logger.child('session-auth');

const COOKIE_NAME = 'authToken';
// Firebase ID tokens expire after ~1 hour. The Firebase JS SDK automatically
// refreshes them and re-fires onAuthStateChanged, which re-POSTs the new
// token to this endpoint, so a 1-hour cookie matches the token's lifetime.
const COOKIE_MAX_AGE_SECONDS = 60 * 60;

export const POST: RequestHandler = async ({ request, cookies }) => {
    let body: { idToken?: string } = {};
    try {
        body = await request.json();
    } catch {
        return json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
    if (!idToken) {
        return json({ ok: false, error: 'missing_id_token' }, { status: 400 });
    }

    try {
        const decoded = await getAuth().verifyIdToken(idToken);
        cookies.set(COOKIE_NAME, idToken, {
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: COOKIE_MAX_AGE_SECONDS
        });
        log.info('session_auth_set', { uid: decoded.uid });
        return json({ ok: true, uid: decoded.uid });
    } catch (error) {
        log.warn('session_auth_invalid', { error });
        return json({ ok: false, error: 'invalid_id_token' }, { status: 401 });
    }
};

export const DELETE: RequestHandler = async ({ cookies }) => {
    cookies.delete(COOKIE_NAME, { path: '/' });
    log.info('session_auth_cleared');
    return json({ ok: true });
};
