import { browser } from '$app/environment';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, parent }) => {
    if (data && data.html) {
        return {
            html: data.html,
            css: data.css,
        }
    }
    if (!browser) {
        return;
    }
    let { token } = await parent();
    if (!token) {
        return;
    }
    let html = await fetch(window.location.href, {
        headers: {
            'x-__session': token,
        },
        method: 'POST'
    });
    return {
        html: await html.text()
    };
};