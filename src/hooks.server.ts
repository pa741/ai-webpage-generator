import { GenerateContentForDescription, GenerateImageFromRoute } from '$lib/AI/PageGenerator';
import { PRIVATE_TURNSTILE_SECRET_KEY } from '$env/static/private';
import { logServerSideEvent } from '$lib/server_analytics';
import { db, collection, addDoc, serverTimestamp } from './lib/firebase';
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
  logServerSideEvent('image_viewed', { event_category: 'engagement', event_label: pathname, custom_parameter: 'image_request', user_agent: userAgent, page_referrer: referer });
  let imageBase64 = await GenerateImageFromRoute(pathname);
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  console.log("Image buffer size:", imageBuffer.length);
  return new Response(imageBuffer, {
      status: 200,
      headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600, immutable',
          'X-Robots-Tag': 'noindex, nofollow',
      }
  });
}


const validTurnstileValidation = async (event: RequestEvent):Promise<boolean> => {
    // Check if the request has a valid Turnstile token
    const turnstileToken = event.request.headers.get('turnstile-token') || event.cookies.get('turnstile-token');
    const clearanceCookie = event.cookies.get('cf_clearance');
    if (clearanceCookie) {
        console.log('Clearance cookie found, skipping Turnstile validation');
        return true; // Skip validation if clearance cookie is present
    }


    if (!turnstileToken) {
        console.warn('Turnstile token is missing');
        return false;
    }
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: PRIVATE_TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    });
    if (!response.ok) {
        console.error('Turnstile verification failed:', response.statusText);
        return false;
    }
    const data = await response.json();

    if (!data.success) {
        console.warn('Turnstile verification failed:', data['error-codes']);
        return false;
    }
    console.log('Turnstile verification successful');

    event.cookies.delete('turnstile-token', { path: '/' }); // Delete the token cookie after successful verification

    return true;


}

export const handle: Handle = async ({ event, resolve }) => {

    // check for Turnstile validation
    const isTurnstileValid = await validTurnstileValidation(event);
    if (!isTurnstileValid) {
        logServerSideEvent('blocked_access', { event_category: 'security', event_label: 'invalid_turnstile', user_agent: event.request.headers.get('user-agent') || 'unknown' });
        return new Response('Invalid Turnstile token', {
            status: 403, // Forbidden
            headers: {
                'Content-Type': 'text/plain',
                'X-Robots-Tag': 'noindex, nofollow',
            }
        });
    }

    // check for bot in user-agent
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
    console.log("Is Bot:", isBot);
    if (isBot && !isDiscordBot) {
        // Log bot access
        logServerSideEvent('bot_access', { event_category: 'engagement', event_label: event.url.pathname, user_agent: userAgent });
        return new Response(null, {
            status: 204, // No Content
            headers: {
                'Cache-Control': 'public, max-age=3600, immutable',
                'X-Robots-Tag': 'noindex, nofollow',
            }
        });
    }




    let isGet = event.request.method === 'GET';
    if (!isGet) {
        // Only handle GET requests
        return new Response(null, {
            status: 405, // Method Not Allowed
            headers: {
                'Allow': 'GET',
                'Content-Type': 'text/plain',
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
                'Access-Control-Allow-Origin': '*',
                'X-Robots-Tag': 'noindex, nofollow', // Prevent indexing of this page
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
                    'Cache-Control': 'public, max-age=3600, immutable',
                    "X-Robots-Tag": "noindex, nofollow",
                }
            });
        }
        return await handleImageRequest(event, pathname);
    }

    const response = await resolve(event);
    response.headers.set('Cache-Control', 'public, max-age=60, immutable');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow'); // Prevent indexing of this page
    return response;
};