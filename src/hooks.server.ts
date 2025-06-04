import { GenerateImageFromRoute } from '$lib/AI/PageGenerator';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    let pathname = event.url.pathname;
    if (pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.gif') || pathname.endsWith('.webp') || pathname.endsWith('.avif')) {
        // Not favicon
        if (pathname === '/favicon.png' || pathname === '/favicon.ico') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Cache-Control': 'public, max-age=31536000, immutable'
                }
            });
        }
        let imageBase64 = await GenerateImageFromRoute(pathname);
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        console.log("Image buffer size:", imageBuffer.length);
        return new Response(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=31536000, immutable'
            }
        });
    }

    const response = await resolve(event);
    return response;
};