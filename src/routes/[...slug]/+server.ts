
import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";
import { getAppCheck } from "firebase-admin/app-check";

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {

    let token = event.request.headers.get('x-__session') || event.request.headers.get('__session');


    if (!token) {
        return new Response('Missing App Check token', {
            status: 400, // Bad Request
            headers: {
                'Content-Type': 'text/plain'
            }
        });
    }
    //console.log("Received App Check token:", token);
    try {
        await getAppCheck().verifyToken(token);
        //console.log('App Check token is valid');
    } catch (error) {
        console.error('Invalid App Check token:', error);
        return new Response('Invalid App Check token', {
            status: 403, // Forbidden
            headers: {
                'Content-Type': 'text/plain',
                'X-Robots-Tag': 'noindex, nofollow', // Prevent indexing of this page
            }
        });
    }
    event.cookies.set('__session', token || '', {
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        path: '/'
    });
    return new Response('App Check token set successfully', {
        status: 200, // OK
    });

}