import { GenerateHomePage, GenerateHtml } from "$lib/AI/PageGenerator";
import { resolveComponentScripts } from "$lib/AI/component-loader";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
    const { token } = await event.parent();
    if (!token) {
        return;
    }

    const pathname = event.url.pathname;
    const generated = pathname === '/'
        ? await GenerateHomePage(event.request)
        : await GenerateHtml(event.request, pathname.replace(/^\//, ''));

    const componentScripts = await resolveComponentScripts(generated.usedComponentIds);

    return {
        html: generated.html,
        prompt: generated.prompt,
        token,
        css: undefined,
        componentScripts
    };
};
