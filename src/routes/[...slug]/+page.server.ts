import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";
import type { PageLoad, PageServerLoad } from "./$types";
import { compileAst, type Config } from 'tailwindcss';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import twconfig from '../../../tailwind.config.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import console from "node:console";

let tailwindConfig: Config;
async function getTailwindConfig() {
    if (!tailwindConfig) {
        // Assuming your tailwind.config.cjs is in the project root
        tailwindConfig = twconfig;
    }
    return tailwindConfig; // Handle ES module vs CommonJS export
}
export const load: PageServerLoad = async (event) => {
    let { token } = await event.parent();
    if (!token) {
        return;
    }
    let pathname = event.url.pathname;
    let homepage = pathname === '/';
    let htmlRes = undefined;
    let promptRes = undefined;
    if (homepage) {
        // Handle homepage generation
        htmlRes = await GenerateHomePage(event.request);
        //html = "<p class=\"text-2xl font-bold\">Welcome to the AI Webpage Generator!</p>";
    }

    else {
        // Handle HTML generation for other routes
        let description = pathname.replace(/^\//, ''); // Remove leading slash
        let { prompt, html } = await GenerateHtml(event.request, description);
        promptRes = prompt;
        htmlRes = html;
    }

    const inputCss = `
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
`;
    //https://github.com/tailwindlabs/tailwindcss/discussions/18467




    return {
        html: htmlRes,
        prompt: promptRes,
        token: token,
        css: undefined,
    }
}