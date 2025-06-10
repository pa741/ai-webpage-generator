import { GenerateContentForDescription, GenerateImageFromRoute } from '$lib/AI/PageGenerator';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    let isGet = event.request.method === 'GET';
    if (!isGet) {
        // Only handle GET requests
        return new Response(null, {
            status: 405, // Method Not Allowed
            headers: {
                'Allow': 'GET',
                'Content-Type': 'text/plain'
            }
        });
    }
    let isEventSource = event.request.headers.get('accept')?.includes('text/event-stream');
    console.log("isEventSource:", isEventSource);
    if (isEventSource) {
        // Handle EventSource requests
        let encodeddescription = event.request.headers.get('description');
        if (!encodeddescription) {
            return new Response('Missing description header', {
                status: 400, // Bad Request
                headers: {
                    'Content-Type': 'text/plain'
                }
            });
        }
        const description = decodeURIComponent(encodeddescription);
        console.log("Received description:", description);
        let generator = await GenerateContentForDescription(description);
        let readStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of generator) {
                        // Format as Server-Sent Events
                        //const formattedChunk = `data: ${JSON.stringify(chunk)}\n\n`;
                        const formattedChunk = `${chunk}`;
                        controller.enqueue(new TextEncoder().encode(formattedChunk));
                    }
                    controller.close();
                } catch (error) {
                    console.error('Stream error:', error);
                    controller.error(error);
                }
            }
        });
        return new Response(readStream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    let pathname = event.url.pathname;
    if (pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.gif') || pathname.endsWith('.webp') || pathname.endsWith('.avif')) {
        // Not favicon
        if (pathname === '/favicon.png' || pathname === '/favicon.ico') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Cache-Control': 'public, max-age=3600, immutable'
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
                'Cache-Control': 'public, max-age=3600, immutable'
            }
        });
    }

    const response = await resolve(event);
    response.headers.set('Cache-Control', 'public, max-age=3600, immutable');
    return response;
};