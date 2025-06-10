import { trackAIInteraction, trackCustomEvent, trackError, trackWebsiteGeneration } from '$lib/analytics';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ChatCompletion } from '@cerebras/cerebras_cloud_sdk/resources.mjs';
import { Runware } from '@runware/sdk-js';
import Groq from "groq-sdk";
import OpenAI from 'openai';

const client = new Cerebras({
    apiKey: "csk-epw35p4r3cy429jk24n28e9k2jek9n8n39n43ckv8dmpwymn",
});
//chutes fingerprint 8OiyKsao5qxS3bBh9dnUzVQujNXYtc6I
const router = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: "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",
});


//groq key:
//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 

//codestral
//AWjJBc0EWOkqk6ChAUtfLyZjqKc7iaeT


const groq = new Groq({
    apiKey: "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"

});


const runware = new Runware({ apiKey: "Xi6YFCP8Db33aym3bW7cE1ZPOsR5Avnw" });

export async function GenerateHomePage() {

    const prompt = `
    This webpage is a homepage for a modern, innovative, and user-friendly website. It should have a clean, contemporary design with a focus on usability and aesthetics.
    
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

`

    return await RequestHtml(prompt);
}


async function GetImageDescriptionFromRoute(route: string) {

    trackAIInteraction('image_description_generation_request', 'llama-3.3');

    const systemPrompt = `/no_think You are an AI Image Description Generator. Your task is to interpret a descriptive URL route that points to an image and generate a rich, detailed textual description of what the image at that route could plausibly look like.

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
"A digital art piece depicting a cyborg figure in a futuristic, neon-lit cityscape. The cyborg might have visible mechanical parts integrated with a human-like form, perhaps with glowing elements. The city is drenched in rain, causing the vibrant neon lights (pinks, blues, purples) from signs and buildings to reflect dramatically on wet streets and surfaces. The atmosphere is likely dark, moody, and Blade Runner-esque, with a focus on reflections and the interplay of light and shadow.`

    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
        model: "llama-3.3-70b"
    })
    let description = (response.choices as any)[0]?.message.content as string;

    return description;

}
export async function GenerateImageFromRoute(route: string) {
    console.log("Generating image for route:", route);
    await runware.ensureConnection();

    let description = await GetImageDescriptionFromRoute(route);

    let response = await runware.requestImages({
        model: "runware:100@1",
        positivePrompt: description,
        negativePrompt: "blurry, low quality, bad quality, low resolution, out of focus, poorly drawn, poorly rendered, poorly lit, poorly composed, poorly framed, poorly cropped, poorly colored, poorly designed, poorly styled, text, watermark, logo, signature, copyright, low contrast, overexposed, underexposed, dark, bright, noisy, grainy",
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
    trackAIInteraction('image_generation_request', 'runware:100@1');
    return response[0].imageBase64Data;
}

export async function* GenerateContentForDescription(description: string) {
    const systemPrompt = `You are a professional, versatile, and creative website content creator. Your primary purpose is to generate high-quality, engaging, and well-structured text content based on the specific context and requirements provided by the user. The generated content should be ready for publication on a website.
    Your main goal is to take a user's general description and transform it into a specific piece of website content. You must adhere strictly to all instructions regarding the content type, tone, audience, and formatting.
    Your output should be plain text, without any HTML tags or formatting. The content should be structured in a way that is easy to read and understand, with clear headings, subheadings, and paragraphs where appropriate.
    You may use markdown syntax for basic formatting and linking to resources.
    When linking to resources, use relative URLs (e.g., /about-us, /contact) without any domain or protocol. The link text itself should be descriptive of the content it links to.
    Do not include any external links or references to specific websites, products, or services unless explicitly requested by the user.
    Do not include any placeholders or comments in the output. The content should be complete and ready for publication.
    Do not include images, videos, or any other media in the output. The content should be purely text-based.
    Your output should be concise, relevant, and directly address the user's request. Avoid unnecessary fluff or filler content, unless specified by the user.
    You are now ready to receive the user's request. Provide the best possible content based on the inputs.`;

    trackAIInteraction('content_generation_request', 'llama-4-maverick');
    //llama3.1-8b	

    let stream = await groq.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
        model: "meta-llama/llama-4-maverick-17b-128e-instruct",
        stream: true
    })

    for await (const chunk of stream) {
        let choices = chunk.choices as any[];
        let delta = choices[0].delta as any;
        if (delta && delta.content) {
            yield delta.content as string;
        }
    }


}




export async function GenerateHtml(route: string, referer?: string | null) {

    trackAIInteraction('website_generation_request', 'llama-4');
    console.log("Generating HTML for route:", route, "Referer:", referer);


    const systemPrompt = `/no_think You are a highly imaginative Senior UX/UI Designer and Content Strategist AI. Your task is to take only a given relative URL route and generate a concise, general description of the ideal version of that webpage. 
    Your description should focus on its key aspects, overall style, and vibe.

    Although you will only receive the URL, you must internally infer a plausible context (website type, hypothetical brand, audience, page purpose) to inform your description.
    Do not explicitly state this inferred context in your output. Your description of the webpage should naturally flow from these internal assumptions.
    The more specific the URL route, the more targeted your description can be. For very generic routes, you may need to internally assume a common archetype.
    Include the given route in your response as a comment at the end.
    Ocassionaly you may also receive a referer URL, which can provide additional context about the page's purpose or audience. Use this information to enhance your description, but do not include it in the output.
    `
    let input = {
        route
    } as any;
    if (referer) {
        input['referer'] = referer;
    }


    let response = await client.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(input) }],
        //model: "qwen-3-32b"
        model: "llama-4-scout-17b-16e-instruct"
    })
    let description = (response.choices as any)[0]?.message.content as string;

    return await RequestHtml(description);


}
async function RequestHtml(description: string) {
    trackAIInteraction('website_generation_request', 'qwen-3-32b');

    const systemPrompt = `/no_think You are an expert web developer specializing in modern and innovative UI/UX design, with strong proficiency in Tailwind CSS and the ability to integrate custom CSS and JavaScript when necessary for enhanced functionality or unique visual effects.
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
- For links (<a> tags), use made-up, descriptive relative URLs (e.g., /services/detail/custom-solutions, /about-us/our-mission). The link text itself should also be descriptive.`;
    try {
        let response = await client.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
            //model: "llama-4-scout-17b-16e-instruct"
            model: "qwen-3-32b"
        })
        //let response = await router.chat.completions.create({
        //    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
        //    //model: "llama-4-scout-17b-16e-instruct"
        //    model: "thudm/glm-4-32b:free",
        //})
        //let response = await groq.chat.completions.create({
        //    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
        //    model: "qwen-qwq-32b",
        //    reasoning_format: "hidden"
        //
        //})
        if (!response.choices || (response.choices as any).length === 0 || !(response.choices as any)[0]?.message.content) {
            trackWebsiteGeneration(description, false);
            return "<!-- Error generating HTML: No content returned -->";

        }
        trackWebsiteGeneration(description, true);

        let html = (response.choices as any)[0]?.message.content as string;
        let regex = /<think>.*<\/think>/g;

        html = html.replaceAll(regex, "").trim();
        html = html.replace(/<think>/g, "").replace(/<\/think>/g, "").trim();
        html = html.replace("```html", "").replace(">```", "").replace(">\n```", "").trim();
        //html += "\n<!-- " + description + " -->";
        return html;
    } catch (error) {
        trackWebsiteGeneration(description, false);

        console.error("Error generating HTML:", error);
        return "<!-- Error generating HTML -->";
    }
}