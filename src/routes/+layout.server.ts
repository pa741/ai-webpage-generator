import type { LayoutServerLoad } from './$types';
import { getAppCheck } from 'firebase-admin/app-check';
import { logger } from '$lib/logger';
import '$lib/firebase_admin';

const log = logger.child('layout');

export const load: LayoutServerLoad = async (data) => {
    if (import.meta.env.DEV) {
        return { token: 'dev-token' };
    }

    let validationCookie = data.locals.validationCookie;
    if (validationCookie) {
        try {
            await getAppCheck().verifyToken(validationCookie);
            log.debug('app_check_ok');
        } catch (error) {
            log.warn('app_check_invalid', { error });
            data.cookies.delete('__session', { path: '/' });
            validationCookie = undefined;
        }
    } else {
        log.debug('app_check_no_cookie');
    }

    return { token: validationCookie };
};
