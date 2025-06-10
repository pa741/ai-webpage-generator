
import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";

export const load: any = async ({ url,request }: any) => {
	if (url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".gif")) {
		console.log("errroorrr")
	}
	let isHomepage = url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "";
	let html;
	if (isHomepage) {
		html = await GenerateHomePage();

	} else {
		let referer = request.headers.get("referer");
		
		// delete hostname from referer
		if (referer) {
			let urlObj = new URL(referer);
			referer = urlObj.pathname + urlObj.search;
		}


		html = await GenerateHtml(url.pathname, referer);

	}


	//console.log("Generated HTML:", html);
	return {
		html: html,
	};
};