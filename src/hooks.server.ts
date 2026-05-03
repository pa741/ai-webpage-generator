// src/app.d.ts
declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            validationCookie: string | undefined;
            requestId: string;
            userId?: string;
            idToken?: string;
        }
        // interface PageData {}
        // interface Platform {}
    }
}

import { GenerateImageFromRoute, HandleAction } from '$lib/AI/PageGenerator';
import { logServerSideEvent } from '$lib/server_analytics';
import { db, collection, addDoc, serverTimestamp } from './lib/firebase';
import { generateRequestId, logger, withRequestContext } from '$lib/logger';
import { withPageMetrics } from '$lib/metrics';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { getAuth } from 'firebase-admin/auth';
import './lib/firebase_admin';

const log = logger.child('hooks');

const AUTH_COOKIE_NAME = 'authToken';
const SESSION_AUTH_PATH = '/__session-auth';

async function handleImageRequest(event: RequestEvent, pathname: string): Promise<Response> {
    const imgLog = log.child('image', { route: pathname });
    let imageKey = pathname;
    if (imageKey.startsWith('/')) imageKey = imageKey.substring(1);
    imageKey = imageKey.replace(/\//g, '-');
    const lastDotIndex = imageKey.lastIndexOf('.');
    if (lastDotIndex > 0) imageKey = imageKey.substring(0, lastDotIndex);

    const requestHeaders: Record<string, string> = {};
    event.request.headers.forEach((value, key) => { requestHeaders[key] = value; });

    try {
        await addDoc(collection(db, 'imageAccessLog'), {
            timestamp: serverTimestamp(),
            method: event.request.method,
            url: event.request.url,
            pathname: event.url.pathname,
            headers: requestHeaders,
            imageKey
        });
    } catch (error) {
        imgLog.warn('access_log_write_failed', { error });
    }

    const userAgent = event.request.headers.get('user-agent') || 'unknown';
    const referer = event.request.headers.get('referer') || 'unknown';
    logServerSideEvent('image_viewed', {
        event_category: 'engagement',
        event_label: pathname,
        custom_parameter: 'image_request',
        user_agent: userAgent,
        page_referrer: referer
    });

    const stop = imgLog.time('generate', { imageKey });
    const imageBase64 = await GenerateImageFromRoute(event.request, pathname);
    stop({ ok: imageBase64.length > 0, bytes: imageBase64.length });

    if (!imageBase64) {
        return new Response('Image generation failed', { status: 502 });
    }

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    return new Response(imageBuffer, {
        status: 200,
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600, immutable',
            'X-Robots-Tag': 'noindex, nofollow'
        }
    });
}

async function resolveAuth(event: RequestEvent): Promise<{ userId?: string; idToken?: string }> {
    const idToken = event.cookies.get(AUTH_COOKIE_NAME);
    if (!idToken) return {};
    try {
        const decoded = await getAuth().verifyIdToken(idToken);
        return { userId: decoded.uid, idToken };
    } catch (error) {
        log.warn('auth_cookie_invalid', { error });
        event.cookies.delete(AUTH_COOKIE_NAME, { path: '/' });
        return {};
    }
}

export const handle: Handle = async ({ event, resolve }) => {
    const requestId = event.request.headers.get('x-request-id') ?? generateRequestId();

    return withRequestContext(
        requestId,
        {
            method: event.request.method,
            path: event.url.pathname
        },
        async () => {
            const validationCookie = event.cookies.get('__session');
            const auth = await resolveAuth(event);
            event.locals = {
                validationCookie: validationCookie || undefined,
                requestId,
                userId: auth.userId,
                idToken: auth.idToken
            };

            const userAgent = event.request.headers.get('user-agent') || '';
            if (!userAgent) {
                log.warn('blocked_no_user_agent');
                logServerSideEvent('blocked_access', { event_category: 'security', event_label: 'no_user_agent', user_agent: 'empty' });
                return new Response('User-Agent header is required', {
                    status: 403,
                    headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' }
                });
            }

            const isBot = /bot|crawl|spider|slurp|mediapartners/i.test(userAgent);
            const isDiscordBot = /Discordbot/i.test(userAgent);
            if (isBot && !isDiscordBot) {
                log.info('bot_blocked', { user_agent: userAgent });
                logServerSideEvent('bot_access', { event_category: 'engagement', event_label: event.url.pathname, user_agent: userAgent });
                return new Response(null, {
                    status: 204,
                    headers: { 'Cache-Control': 'private, no-cache', 'X-Robots-Tag': 'noindex, nofollow' }
                });
            }

            const stop = log.time('request', { user_agent: userAgent, authenticated: Boolean(auth.userId) });
            try {
                const pathname = event.url.pathname;
                if (/\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(pathname)) {
                    if (/favicon\.(png|ico)$/i.test(pathname)) {
                        return new Response(null, {
                            status: 204,
                            headers: { 'Cache-Control': 'public, max-age=3600, immutable', 'X-Robots-Tag': 'noindex, nofollow' }
                        });
                    }
                    const response = await handleImageRequest(event, pathname);
                    stop({ status: response.status, kind: 'image' });
                    return response;
                }

                const method = event.request.method;
                const isAppCheckPost = Boolean(
                    event.request.headers.get('x-__session') || event.request.headers.get('__session')
                );
                const isSessionAuth = pathname === SESSION_AUTH_PATH;
                if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !isAppCheckPost && !isSessionAuth) {
                    const response = await HandleAction(event.request, auth.idToken, auth.userId);
                    stop({ status: response.status, kind: 'action', method });
                    return response;
                }

                const response = await withPageMetrics(requestId, pathname, () => Promise.resolve(resolve(event)));
                response.headers.set('Cache-Control', 'private, no-cache');
                response.headers.set('vary', 'Cookie, Accept');
                response.headers.set('X-Robots-Tag', 'noindex, nofollow');
                stop({ status: response.status, kind: 'page' });
                return response;
            } catch (error) {
                stop({ status: 500, error });
                log.error('request_failed', { error });
                throw error;
            }
        }
    );
};
