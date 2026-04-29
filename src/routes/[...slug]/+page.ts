import { browser } from '$app/environment';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, parent }) => {
    if (data && data.html) {
        return {
            html: data.html,
            css: data.css,
            prompt: data.prompt,
            componentScripts: data.componentScripts
        }
    }
    if (!browser) {
        return;
    }
    let { token } = await parent();
    if (!token) {
        return;
    }
    let response = await fetch(window.location.href, {
        headers: {
            'x-__session': token,
        },
        method: 'POST'
    });
    if (response.ok) {
        // reload the page
        window.location.reload();
    }

    return;
};