import { GenerateHomePage, GenerateHtml, GenerateImageFromRoute } from "$lib/AI/PageGenerator";
import type { PageLoad, PageServerLoad } from "./$types";
import { compileAst, type Config } from 'tailwindcss';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import twconfig from '../../../tailwind.config.cjs';
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
    let html = undefined;
    if (homepage) {
        // Handle homepage generation
        //html = await GenerateHomePage();
        html = "<p class=\"text-2xl font-bold\">Welcome to the AI Webpage Generator!</p>";
    }

    else {
        // Handle HTML generation for other routes
        let description = pathname.replace(/^\//, ''); // Remove leading slash
        html = await GenerateHtml(description);
    }

    const inputCss = `
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
`;
    //https://github.com/tailwindlabs/tailwindcss/discussions/18467


    console.log("HTML:", html);

    let generatedCss: string | undefined = undefined;
    let tempHtmlFile = path.join(process.cwd(), 'temp.html');
    await fs.writeFile(tempHtmlFile, html);



    try {
        const result = await postcss([
            // Your configuration here remains the same
            tailwindcss({

            }),
        ]).process(inputCss, { from: undefined });
        generatedCss = result.css;
    } catch (error) {
        console.error('Tailwind CSS generation error:', error);
    }


    return {
        html: html,
        token: token,
        css: generatedCss,
    }
}