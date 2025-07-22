import type { LayoutServerLoad } from './$types';
import { getAppCheck } from 'firebase-admin/app-check';

export const load: LayoutServerLoad = async (data) => {

    let validationCookie = data.locals.validationCookie;
    console.log('Getting Validation cookie:', validationCookie);
    if (validationCookie) {
        try {
            const appCheck = getAppCheck();
            await appCheck.verifyToken(validationCookie);
            //data.locals.validationCookie = validationCookie; // Store the valid token in locals
            console.log('App Check Server token is valid:', validationCookie);
        } catch (error) {
            console.error('App Check token validation failed:', error);
            // If validation fails, clear the cookie
            data.cookies.delete('__session', { path: '/' });
            validationCookie = undefined; // Clear the variable as well
        }
    }
    return {
        token: validationCookie,
    };
};


