import { browser } from '$app/environment';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, parent }) => {
    if (!browser) {
        return;
    }

    let token = (await parent()).token;
    if (!token) {
        return;
    }
    let html = await fetch(window.location.href, {
        headers: {
            'x-app-check-token': token,
        },
        method: 'POST'
    });
    return {
        html: await html.text()
    };
};