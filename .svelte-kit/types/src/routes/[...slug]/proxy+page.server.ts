// @ts-nocheck

// If 'PageServerLoad' is not exported, try the following instead:
// import type { PageLoad } from './$types';
// or use 'any' as a temporary workaround:
// type PageServerLoad = any;

import { GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";

export const load = async ({url}:any) => {
	if(url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".gif")) {
		console.log("errroorrr")

	}
    const html = await GenerateHtml(url.pathname);
	//console.log("Generated HTML:", html);
	return {
		html: html,
	};
};;null as any as any;