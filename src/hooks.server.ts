

// src/app.d.ts
declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            validationCookie: string | undefined;
        }
        // interface PageData {}
        // interface Platform {}
    }
}

import { GenerateImageFromRoute } from '$lib/AI/PageGenerator';
import { PRIVATE_TURNSTILE_SECRET_KEY } from '$env/static/private';
import { logServerSideEvent } from '$lib/server_analytics';
import { db, collection, addDoc, serverTimestamp } from './lib/firebase';
import type { Handle, RequestEvent } from '@sveltejs/kit'; // Ensure this type import is present or add it
import './lib/firebase_admin';


async function handleImageRequest(event: RequestEvent, pathname: string): Promise<Response> {
    let imageKey = pathname;

    // Remove leading slash if present
    if (imageKey.startsWith('/')) {
        imageKey = imageKey.substring(1);
    }

    // Replace remaining slashes with hyphens
    imageKey = imageKey.replace(/\//g, '-');

    // Remove file extension
    const lastDotIndex = imageKey.lastIndexOf('.');
    if (lastDotIndex > 0) { // Ensure dot is not the first character and is present
        imageKey = imageKey.substring(0, lastDotIndex);
    }

    const requestHeaders: { [key: string]: string } = {};
    event.request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
    });

    const firestoreData = {
        timestamp: serverTimestamp(), // Will be converted to server timestamp by Firestore
        method: event.request.method,
        url: event.request.url, // Full URL
        pathname: event.url.pathname, // Just the path. Note: this uses event.url.pathname, while the function takes `pathname`. They should be identical in this context.
        headers: requestHeaders,
        // Add any other specific event.request properties if deemed necessary later
    };

    const dataToSave = {
        imageKey: imageKey,
        ...firestoreData
    };

    try {
        const docRef = await addDoc(collection(db, "imageAccessLog"), dataToSave);
    } catch (e) {
        console.error("Error adding document to Firestore: ", e);

    }
    

    const userAgent = event.request.headers.get('user-agent') || 'unknown';
    const referer = event.request.headers.get('referer') || 'unknown';
    logServerSideEvent('image_viewed', { event_category: 'engagement', event_label: pathname, custom_parameter: 'image_request', user_agent: userAgent, page_referrer: referer });
    let imageBase64 = await GenerateImageFromRoute(event.request,pathname);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    return new Response(imageBuffer, {
        status: 200,
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600, immutable',
            'X-Robots-Tag': 'noindex, nofollow',
        }
    });
}



export const handle: Handle = async ({ event, resolve }) => {

    let validationCookie = event.cookies.get('__session');
    console.log("Request Path:", event.url.pathname);


    event.locals =
    {
        validationCookie: validationCookie || undefined
    }
    const userAgent = event.request.headers.get('user-agent') || '';
    if (!userAgent) {
        // Block requests with no user-agent
        logServerSideEvent('blocked_access', { event_category: 'security', event_label: 'no_user_agent', user_agent: 'empty' });
        return new Response('User-Agent header is required', {
            status: 403, // Forbidden
            headers: {
                'Content-Type': 'text/plain',
                'X-Robots-Tag': 'noindex, nofollow',
            }
        });
    }



    const isBot = /bot|crawl|spider|slurp|mediapartners/i.test(userAgent);
    //allow DiscordBot
    const isDiscordBot = /Discordbot/i.test(userAgent);
    console.log("User-Agent:", userAgent);
    if (isBot && !isDiscordBot) {
        // Log bot access
        logServerSideEvent('bot_access', { event_category: 'engagement', event_label: event.url.pathname, user_agent: userAgent });
        return new Response(null, {
            status: 204, // No Content
            headers: {
                'Cache-Control': 'private, no-cache',
                'X-Robots-Tag': 'noindex, nofollow',
            }
        });
    }

    let pathname = event.url.pathname;
    if (pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.gif') || pathname.endsWith('.webp') || pathname.endsWith('.avif') || pathname.endsWith('.svg')) {
        // Not favicon
        if (pathname.endsWith('favicon.png') || pathname.endsWith('favicon.ico')) {
            return new Response(null, {
                status: 204,
                headers: {
                    'Cache-Control': 'public, max-age=3600, immutable',
                    "X-Robots-Tag": "noindex, nofollow",
                }
            });
        }
        return await handleImageRequest(event, pathname);
    }

    const response = await resolve(event);
    response.headers.set('Cache-Control', 'private, no-cache');
    response.headers.set("vary", "Cookie, Accept");
    response.headers.set('X-Robots-Tag', 'noindex, nofollow'); // Prevent indexing of this page
    return response;
};