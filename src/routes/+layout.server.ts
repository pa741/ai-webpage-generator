import type { LayoutServerLoad } from './$types';
import { getAppCheck } from 'firebase-admin/app-check';
import '$lib/firebase_admin';

export const load: LayoutServerLoad = async (data) => {
    if (import.meta.env.DEV) {
        return { token: 'dev-token' };
    }

    let validationCookie = data.locals.validationCookie;
    if (validationCookie) {
        try {
            await getAppCheck().verifyToken(validationCookie);
        } catch (error) {
            console.error('App Check token validation failed:', error);
            data.cookies.delete('__session', { path: '/' });
            validationCookie = undefined;
        }
    }

    return { token: validationCookie };
};
