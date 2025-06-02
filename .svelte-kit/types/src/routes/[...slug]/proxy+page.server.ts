// @ts-nocheck

// If 'PageServerLoad' is not exported, try the following instead:
// import type { PageLoad } from './$types';
// or use 'any' as a temporary workaround:
// type PageServerLoad = any;

import { GenerateHtml } from "$lib/AI/PageGenerator";

export const load = async ({url}:any) => {

    const html = await GenerateHtml(url.pathname);
	console.log("Generated HTML:", html);
	return {
		html: html,
	};
};;null as any as any;