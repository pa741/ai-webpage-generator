
import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";
import { event } from "firebase-functions/v1/analytics";
import type { PageServerLoad } from "./$types";
import { app } from "firebase-functions";

export const load: PageServerLoad = async (event) => {
	const request = event.request;
	const url = new URL(request.url);


	if (url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".gif")) {
		console.log("errroorrr")
	}

	

	let isHomepage = url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "";
	let html = "";
	if (isHomepage) {
		//html = await GenerateHomePage();

	} else {
		let referer = request.headers.get("referer");
		
		// delete hostname from referer
		if (referer) {
			let urlObj = new URL(referer);
			referer = urlObj.pathname + urlObj.search;
		}

		if(event.locals.appCheckValid) {
			html = "<p>dsadas</p>"//await GenerateHtml(url.pathname, referer);
		}
	}


	//console.log("Generated HTML:", html);
	return {
		html: html,
		appCheckValid: event.locals.appCheckValid // Pass the app check validation status
	};
}