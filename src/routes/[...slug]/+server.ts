
import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";
import { getAppCheck } from "firebase-admin/app-check";

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
    let pathname = event.url.pathname;
    let homepage = pathname === '/';
    let imagefiles = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'];
    let imageFile = imagefiles.some(ext => pathname.endsWith(ext));


    if (imageFile) {
        // Handle image generation
        let imageKey = pathname;
        let image = await GenerateImageFromRoute(imageKey);
        if (!image) {
            return new Response('Image not found', { status: 404 });
        }
        return new Response(image, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-Robots-Tag': 'noindex, nofollow', // Prevent indexing of this page
            }
        });
    }
    let token = event.request.headers.get('x-app-check-token') || event.request.headers.get('app-check-token');


    if (!token) {
        return new Response('Missing App Check token', {
            status: 400, // Bad Request
            headers: {
                'Content-Type': 'text/plain'
            }
        });
    }
    console.log("Received App Check token:", token);
    try {
        await getAppCheck().verifyToken(token);
        console.log('App Check token is valid');
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
    event.cookies.set('app-check-token', token || '', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/'
    });


    if (homepage) {
        // Handle homepage generation
        //let html = await GenerateHomePage();
        let html = "<p>Welcome to the AI Webpage Generator!</p>";
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-Robots-Tag': 'noindex, nofollow', // Prevent indexing of this page
            }
        });
    }

    else {
        // Handle HTML generation for other routes
        let description = pathname.replace(/^\//, ''); // Remove leading slash
        let html = await GenerateHtml(description);
        if (!html) {
            return new Response('Page not found', { status: 404 });
        }
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-Robots-Tag': 'noindex, nofollow', // Prevent indexing of this page
            }
        });
    }



}