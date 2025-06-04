
// If 'PageServerLoad' is not exported, try the following instead:
// import type { PageLoad } from './$types';
// or use 'any' as a temporary workaround:
// type PageServerLoad = any;

import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";

export const load: any = async ({ url }: any) => {
	if (url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".gif")) {
		console.log("errroorrr")

	}
	let isHomepage = url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "";
	let html;
	if (isHomepage) {
		html = await GenerateHomePage();

	} else {
		html = await GenerateHtml(url.pathname);

	}


	//console.log("Generated HTML:", html);
	return {
		html: html,
	};
};