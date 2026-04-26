import { trackAIInteraction, trackCustomEvent, trackError, trackWebsiteGeneration } from '$lib/analytics';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ChatCompletion } from '@cerebras/cerebras_cloud_sdk/resources.mjs';
import { Runware } from '@runware/sdk-js';
import Groq from "groq-sdk";
import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    CEREBRAS_API_KEY,
    GROQ_API_KEY,
    RUNWARE_API_KEY
} from '$env/static/private';
import { env } from '$env/dynamic/private';
import { PUBLIC_FIREBASE_PROJECT_ID } from '$env/static/public';
import { getRemoteConfig, RemoteConfig, type ServerConfig } from "firebase-admin/remote-config";
import app from '../firebase_admin';

const client = new Cerebras({
    apiKey: CEREBRAS_API_KEY,
});

const groq = new Groq({
    apiKey: GROQ_API_KEY,

});

const runware = new Runware({ apiKey: RUNWARE_API_KEY });
const MCP_REGION = 'europe-southwest1';

interface ReusableComponentSummary {
    id: string;
    shortDeck: string;
    gsPath: string;
}

function resolveMcpUrl(request: Request): URL | null {
    const configuredUrl = env.MCP_ENDPOINT?.trim();
    if (configuredUrl) {
        try {
            return new URL(configuredUrl);
        } catch {
            console.warn('MCP_ENDPOINT is set but invalid:', configuredUrl);
        }
    }

    if (PUBLIC_FIREBASE_PROJECT_ID) {
        return new URL(`https://${MCP_REGION}-${PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net/mcp`);
    }

    try {
        const baseUrl = new URL(request.url);
        return new URL('/mcp', `${baseUrl.protocol}//${baseUrl.host}`);
    } catch {
        return null;
    }
}

async function withMcpClient<T>(request: Request, action: (client: Client) => Promise<T>): Promise<T | null> {
    const mcpUrl = resolveMcpUrl(request);
    if (!mcpUrl) {
        return null;
    }

    const authorizationHeader = request.headers.get("authorization");
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: authorizationHeader
            ? {
                headers: {
                    Authorization: authorizationHeader
                }
            }
            : undefined
    });
    const client = new Client({
        name: 'ai-webpage-generator',
        version: '1.0.0'
    });

    try {
        await client.connect(transport);
        return await action(client);
    } catch (error) {
        console.error('Failed to connect/call MCP server:', error);
        return null;
    } finally {
        try {
            await client.close();
        } catch {
            // Ignore close errors from short-lived MCP requests.
        }
    }
}

function parseToolJson(content: unknown): unknown {
    if (!Array.isArray(content)) {
        return null;
    }

    const texts = content
        .filter((item): item is { type?: string; text?: string } => Boolean(item && typeof item === 'object'))
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text as string)
        .join('\n')
        .trim();

    if (!texts) {
        return null;
    }

    try {
        return JSON.parse(texts);
    } catch {
        return null;
    }
}

function normalizeComponentSummaries(value: unknown): ReusableComponentSummary[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            shortDeck: typeof item.shortDeck === 'string' ? item.shortDeck : '',
            gsPath: typeof item.gsPath === 'string' ? item.gsPath : ''
        }))
        .filter((item) => Boolean(item.id));
}

async function getMcpComponentContext(request: Request, description: string): Promise<ReusableComponentSummary[]> {
    const components = await withMcpClient(request, async (client) => {
        const purposeResponse = await client.callTool({
            name: 'GetComponents',
            arguments: {
                purpose: description.slice(0, 500)
            }
        });

        const purposeResults = normalizeComponentSummaries(parseToolJson(purposeResponse.content));
        if (purposeResults.length > 0) {
            return purposeResults;
        }

        const allResponse = await client.callTool({
            name: 'GetAllComponents',
            arguments: {}
        });
        return normalizeComponentSummaries(parseToolJson(allResponse.content));
    });

    return components ?? [];
}

function buildComponentPromptContext(components: ReusableComponentSummary[]): string {
    if (components.length === 0) {
        return '';
    }

    const lines = components.slice(0, 20).map((component) => {
        const desc = component.shortDeck || 'Reusable web component';
        return `- ${component.id}: ${desc}`;
    });

    return [
        'Reusable Web Components available via MCP (already loaded as scripts on the client):',
        ...lines,
        'When useful, include these custom element tags in your HTML using their component id as the tag name (for example: <my-component></my-component>).'
    ].join('\n');
}


async function GetConfig(request: Request): Promise<ServerConfig> {
    const remoteConfig = getRemoteConfig(app);
    console.log('Fetching remote config...');
    console.log('Remote config:', remoteConfig);
    //list methods of remoteConfig
    let methods = Object.getOwnPropertyNames(Object.getPrototypeOf(remoteConfig));
    console.log('Remote config methods:', methods);

    const template = await remoteConfig.getServerTemplate()
    console.log('Remote config template:', template);
    //await template.load();


    const config = template.evaluate({
        platform: request.headers.get('Sec-CH-UA-Platform') || 'unknown',
        userAgent: request.headers.get('User-Agent') || 'unknown',
        acceptLanguage: request.headers.get('Accept-Language') || 'en-US',
        referer: request.headers.get('Referer') || '',
    });

    return config;
}
/*
his webpage is a homepage for a modern, innovative, and user-friendly website. It should have a clean, contemporary design with a focus on usability and aesthetics.
    
    Content:
- Generate a brief text introduction that mentions the following key points:
 - This website is generated using AI ran on Cerebras for instant speed generation.
 - It was made by Pablo De Groot, who can be contacted at pablo@groots.es
 - It uses the route of the page to generate the content, so any page can be generated dynamically and navigated to from other pages.

 Additionally, include a section that provides examples of the types of the pages that can be generated (/blog/pets/cats, /sports/formula-1/live, /products/electronics/smartphones, /contact, etc...). Do not use this specific list, but rather generate a list of plausible pages that could be generated dynamically based on the route.
Every example should be a link to the page, and the link text should be descriptive of the page content. Use relative URLs (e.g./blog/pets/cats, etc.) without any domain or protocol.
Add icons to the links to make them visually appealing, using Font Awesome or similar icon libraries. Use appropriate icons that match the content of each link (e.g., a user icon for /about, a blog icon for /blog, etc.).
Style:
- Dark mode design with a sleek, modern aesthetic.
- In the style of a blog post, with a header, main content area, and footer.
- Main content area should be centered. 
- Use css animations to make the page visually appealing, such as hover effects on links and buttons.

*/

export async function GenerateHomePage(request: Request) {
    const config = await GetConfig(request);
    const prompt = config.getString('home_page_prompt');
    if (!prompt) {
        throw new Error("Home page prompt not found in remote config");
    }

    return await RequestHtml(request, prompt);
}
/*
/no_think You are an AI Image Description Generator. Your task is to interpret a descriptive URL route that points to an image and generate a rich, detailed textual description of what the image at that route could plausibly look like.

The URL will provide clues through its path segments (folders) and filename (including the extension, though the extension itself is less important than the descriptive words).

Your goal is to:

Analyze the URL: Break down the URL into its constituent parts (e.g., domain/category/subcategory/filename.jpg). Identify keywords related to objects, scenes, attributes, actions, time of day, location, etc.
Infer Context: Use the folder structure and filename to understand the likely context and subject matter of the image.
Generate a Visual Description: Create a vivid description of the hypothetical image. Focus on:
Main Subject(s): What is the central focus of the image?
Setting/Environment: Where is the subject located? What is the background?
Key Details & Attributes: Specific objects, colors, textures, lighting, weather conditions, mood, atmosphere.
Possible Composition/Perspective: Is it likely a close-up, a wide shot, an aerial view, eye-level, etc.? (Make a reasonable assumption).
Style (Implicit): Assume a photographic style unless the URL hints otherwise (e.g., illustration, drawing, abstract).
Important Considerations:

Be Plausible: The description should logically follow from the information in the URL.
Be Creative but Grounded: Fill in reasonable details that aren't explicitly stated but make sense given the context.
Focus on Visuals: Describe what one would see.
Do NOT describe the URL string itself or the act of parsing. Describe the image.

Example Input URL 1:
/images/landscapes/mountains/snowy_peaks_sunrise_alps.jpg

Example Output Description 1:
"A breathtaking mountain landscape likely photographed in the Alps. Towering, sharp peaks are covered in pristine white snow, possibly with some exposed grey rock. The scene is illuminated by the warm, golden light of sunrise, casting long shadows and highlighting the textures of the snow and rock. The sky could be a mix of oranges, pinks, and purples near the horizon, fading into a clearer blue above. It's likely a wide shot, capturing the grandeur and scale of the mountains."

Example Input URL 2:
/products/kitchen/appliances/red_vintage_toaster_on_marble_countertop.png

Example Output Description 2:
"A product shot focusing on a vintage-style toaster. The toaster is a vibrant red color, possibly with chrome accents, and has a classic, retro design. It's placed neatly on a clean, polished marble countertop, which might be white or a light grey with characteristic veining. The lighting is likely bright and even, designed to showcase the product's details and glossy finish. The image is likely a close-up or medium shot, focusing primarily on the toaster."

Example Input URL 3:
/art/digital/sci-fi/cyborg_neon_city_rain_reflection.webp

Example Output Description 3:
"A digital art piece depicting a cyborg figure in a futuristic, neon-lit cityscape. The cyborg might have visible mechanical parts integrated with a human-like form, perhaps with glowing elements. The city is drenched in rain, causing the vibrant neon lights (pinks, blues, purples) from signs and buildings to reflect dramatically on wet streets and surfaces. The atmosphere is likely dark, moody, and Blade Runner-esque, with a focus on reflections and the interplay of light and shadow.

*/

async function GetImageDescriptionFromRoute(request: Request, route: string) {

    //trackAIInteraction('image_description_generation_request', 'llama-3.3');
    const config = await GetConfig(request);
    const systemPrompt = config.getString('image_description_prompt');
    const model = config.getString('image_description_model');
    trackAIInteraction('image_description_generation_request', model);

    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
        model: model
    })
    let description = (response.choices as any)[0]?.message.content as string;

    return description;

}
export async function GenerateImageFromRoute(request: Request, route: string) {
    console.log("Generating image for route:", route);
    await runware.ensureConnection();

    let description = await GetImageDescriptionFromRoute(request, route);
    const config = await GetConfig(request);
    const negativePrompt = config.getString('image_description_negative_prompt'); // blurry, low quality, bad quality, low resolution, out of focus, poorly drawn, poorly rendered, poorly lit, poorly composed, poorly framed, poorly cropped, poorly colored, poorly designed, poorly styled, text, watermark, logo, signature, copyright, low contrast, overexposed, underexposed, dark, bright, noisy, grainy
    const model = config.getString('image_generation_model');

    let response = await runware.requestImages({
        model: model,
        positivePrompt: description,
        negativePrompt: negativePrompt,
        numberResults: 1,
        CFGScale: 1,
        steps: 1,
        outputType: 'base64Data',
        outputFormat: 'PNG',
        width: 1024,
        height: 1024,
    });
    if (!response || response.length === 0 || !response[0].imageBase64Data) {
        trackError("Image generation failed", `Route: ${route}, Description: ${description}`);

        console.error("No image generated for route:", route);
        return "";
    }
    trackAIInteraction('image_generation_request', model);
    return response[0].imageBase64Data;
}

/*
/no_think 
    You are a highly imaginative Senior UX/UI Designer. You enjoy creating unique, modern, stunning and interactive web pages that are visually appealing and user-friendly. You have a deep understanding of web design principles, user experience, and the latest design trends. 
    Your task is to take a given relative URL route and generate a concise description of the ideal version of that webpage. 
    Your description should focus on its key aspects, overall style, and vibe.
    Your first task should be to infer the intent of the user based on the route, Some pages may not align with common archtypes, so you should use your best judgement to determine the most appropriate context.
    Although you will only receive the URL, you must internally infer a plausible context (website type, hypothetical brand, audience, page purpose) to inform your description.
    Do not explicitly state this inferred context in your output. Your description of the webpage should naturally flow from these internal assumptions. 
    The more specific the URL route, the more targeted your description can be. For very generic routes, you may need to internally assume a common archetype.
    Include the given route in your response as a comment at the end.
    The description should provide a clear, vivid picture of the webpage's content, structure, design and functionality. Complex functionality or interactions should be described in a way that is easy to understand.
    The description should not have ambiguous or open to interpretation design decisions. Do not let the end designer make decisions about the design, rather you should provide a clear, concise description of the design. 
    
*/

export async function GenerateHtml(request: Request, route: string, referer?: string | null) {

    console.log("Generating HTML for route:", route, "Referer:", referer);

    const config = await GetConfig(request);
    const systemPrompt = config.getString('html_designer_prompt');
    const model = config.getString('html_designer_model');
    trackAIInteraction('website_generation_request', model);


    let input = {
        route
    } as any;
    if (referer) {
        input['referer'] = referer;
    }


    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(input) }],
        //model: "qwen-3-32b"
        model: model
    })
    let description = (response.choices as any)[0]?.message.content as string;

    return { prompt: description, html: await RequestHtml(request, description) };


}
/*
/no_think You are an expert web developer specializing in modern and innovative UI/UX design, with strong proficiency in Tailwind CSS and the ability to integrate custom CSS and JavaScript when necessary for enhanced functionality or unique visual effects.
Task: Generate a single, raw HTML fragment (no <html>, <head>, or <body> tags, just the content that would go inside the <body>) based on the provided webpage description.
Key Requirements:
- HTML Fragment: The output must be a raw HTML fragment.
- Tailwind CSS First: Primarily use Tailwind CSS classes for all styling. Ensure the classes are up-to-date and effectively implement the design.
- Inline CSS & JavaScript (Optional but Permitted):
- If custom styling beyond Tailwind's capabilities is needed to achieve a modern and innovative look, you can include CSS within <style> tags directly in the HTML fragment. If specific interactive elements or animations are required that cannot be achieved with Tailwind CSS alone, you can include JavaScript within <script> tags directly in the HTML fragment. Aim for vanilla JavaScript or very lightweight utility functions if possible, to keep the fragment self-contained.
- Modern & Innovative Design: The visual output should be sleek, contemporary, and incorporate creative design elements. Think clean lines, good use of whitespace, subtle animations or transitions, and a generally fresh aesthetic. Avoid outdated or generic styles.
- Responsive: The HTML structure and styling (Tailwind and any custom CSS) should ensure the fragment is responsive and looks good on various screen sizes (mobile, tablet, desktop).
- Semantic HTML (where appropriate): Use semantic HTML tags where they make sense for accessibility and structure (e.g., <section>, <article>, <nav>, <aside>), but prioritize the visual and structural integrity of the fragment.
Content Integration:
- For large blocks of text, use <text-content> tags to indicate where the text should be placed, This tag has description as a mandatory attribute. This is a placeholder for the actual content that will be dynamically inserted later. Ensure the tag has a description attribute that describes the content with a brief summary of what the text should convey, its purpose, any key points it should cover, writting style, **how long it should be** and any relevant context. Everything referenced in the description should have appropriate context.
- For images, use made-up, descriptive relative URLs. The path should be logical and the filename should describe the image content, using hyphens for spaces (e.g., /images/team/lead-designer-portrait.jpg, /content/features/data-visualization-graph.png).
- For links (<a> tags), use made-up, descriptive relative URLs (e.g., /services/detail/custom-solutions, /about-us/our-mission). The link text itself should also be descriptive.
Output Formatting Rules:
- The response MUST be only the HTML code.
- Do NOT include any explanations, introductory text, or concluding remarks.
- Do NOT wrap the HTML in Markdown code blocks (i.e., no \`\`\`html or \`\`\`).
- The output must start directly with the first HTML tag and end with the last one.


*/

async function RequestHtml(request: Request, description: string) {
    const config = await GetConfig(request);
    const systemPrompt = config.getString('html_generator_prompt');
    const model = config.getString('html_generator_model');
    trackAIInteraction('website_generation_request', model);

    const reusableComponents = await getMcpComponentContext(request, description);
    const componentPromptContext = buildComponentPromptContext(reusableComponents);
    const generationInput = componentPromptContext
        ? `${description}\n\n${componentPromptContext}`
        : description;

    try {
        let response = await client.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: generationInput }],
            //model: "llama-4-scout-17b-16e-instruct"
            //model: "qwen-3-32b",
            model: model,

        })

        if (!response.choices || (response.choices as any).length === 0 || !(response.choices as any)[0]?.message.content) {
            trackWebsiteGeneration(description, false);
            return "<!-- Error generating HTML: No content returned -->";

        }
        trackWebsiteGeneration(description, true);

        let html = (response.choices as any)[0]?.message.content as string;
        let regex = /<think>.*<\/think>/g;

        html = html.replaceAll(regex, "").trim();
        //html = html.replace(/<think>/g, "").replace(/<\/think>/g, "").trim();
        //html += "\n<!-- " + description + " -->";
        return html;
    } catch (error) {
        trackWebsiteGeneration(description, false);

        console.error("Error generating HTML:", error);
        return "<!-- Error generating HTML -->";
    }
}
