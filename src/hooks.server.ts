import { GenerateContentForDescription, GenerateImageFromRoute } from '$lib/AI/PageGenerator';
import { trackCustomEvent } from '../lib/analytics';
import { db, collection, addDoc, serverTimestamp } from '../lib/firebase';
import type { Handle, RequestEvent } from '@sveltejs/kit'; // Ensure this type import is present or add it

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
    console.log("Image access logged to Firestore with ID: ", docRef.id);
  } catch (e) {
    console.error("Error adding document to Firestore: ", e);
    // Decide if you want to fail the request or just log. For now, just log.
  }

  const userAgent = event.request.headers.get('user-agent') || 'unknown';
  const referer = event.request.headers.get('referer') || 'unknown';
  trackCustomEvent('image_viewed', { event_category: 'engagement', event_label: pathname, custom_parameter: 'image_request', user_agent: userAgent, referer: referer });
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
    if (pathname.endsWith('.png') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') || pathname.endsWith('.gif') || pathname.endsWith('.webp') || pathname.endsWith('.avif') || pathname.endsWith('.svg')) {
        // Not favicon
        if (pathname === '/favicon.png' || pathname === '/favicon.ico') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Cache-Control': 'public, max-age=3600, immutable'
                }
            });
        }
        return await handleImageRequest(event, pathname);
    }

    const response = await resolve(event);
    response.headers.set('Cache-Control', 'public, max-age=60, immutable');
    return response;
};