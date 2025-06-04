import Cerebras from "@cerebras/cerebras_cloud_sdk";
import { Runware } from "@runware/sdk-js";
import "clsx";
const client = new Cerebras({
  apiKey: "csk-epw35p4r3cy429jk24n28e9k2jek9n8n39n43ckv8dmpwymn"
  // This is the default and can be omitted
});
const runware = new Runware({ apiKey: "Xi6YFCP8Db33aym3bW7cE1ZPOsR5Avnw" });
async function GetImageDescriptionFromRoute(route) {
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
Ignore technical parts of the URL like https://, www., .com, or query parameters unless they clearly contribute to the image's content description.
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
"A digital art piece depicting a cyborg figure in a futuristic, neon-lit cityscape. The cyborg might have visible mechanical parts integrated with a human-like form, perhaps with glowing elements. The city is drenched in rain, causing the vibrant neon lights (pinks, blues, purples) from signs and buildings to reflect dramatically on wet streets and surfaces. The atmosphere is likely dark, moody, and Blade Runner-esque, with a focus on reflections and the interplay of light and shadow.`;
  let response = await client.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
    model: "llama-3.3-70b"
  });
  let description = response.choices[0]?.message.content;
  return description;
}
async function GenerateImageFromRoute(route) {
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
    outputType: "base64Data",
    width: 1024,
    height: 1024
  });
  if (!response || response.length === 0 || !response[0].imageBase64Data) {
    console.error("No image generated for route:", route);
    return "";
  }
  console.log("Image generated successfully for route:", route, "Image size:", response[0].imageBase64Data.length);
  return response[0].imageBase64Data;
}
async function GenerateHtml(route) {
  const systemPrompt = `/no_think You are a highly imaginative Senior UX/UI Designer and Content Strategist AI. Your task is to take only a given relative URL route and generate a concise, general description of the ideal version of that webpage. 
    Your description should focus on its key aspects, overall style, and vibe.

    Although you will only receive the URL, you must internally infer a plausible context (website type, hypothetical brand, audience, page purpose) to inform your description.
    Do not explicitly state this inferred context in your output. Your description of the webpage should naturally flow from these internal assumptions.
    The more specific the URL route, the more targeted your description can be. For very generic routes, you may need to internally assume a common archetype.
    Include the given route in your response as a comment at the end.`;
  let response = await client.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
    model: "llama-4-scout-17b-16e-instruct"
  });
  let description = response.choices[0]?.message.content;
  return await RequestHtml(description);
}
async function RequestHtml(description) {
  const systemPrompt = `/no_think You are an expert web developer specializing in modern and innovative UI/UX design, with strong proficiency in Tailwind CSS and the ability to integrate custom CSS and JavaScript when necessary for enhanced functionality or unique visual effects.
Task: Generate a single, raw HTML fragment (no <html>, <head>, or <body> tags, just the content that would go inside the <body>) based on the provided webpage description.
Key Requirements:
HTML Fragment: The output must be a raw HTML fragment.
Tailwind CSS First: Primarily use Tailwind CSS classes for all styling. Ensure the classes are up-to-date and effectively implement the design.
Inline CSS & JavaScript (Optional but Permitted):
If custom styling beyond Tailwind's capabilities is needed to achieve a modern and innovative look, you can include CSS within <style> tags directly in the HTML fragment.
If specific interactive elements or animations are required that cannot be achieved with Tailwind CSS alone, you can include JavaScript within <script> tags directly in the HTML fragment. Aim for vanilla JavaScript or very lightweight utility functions if possible, to keep the fragment self-contained.
Modern & Innovative Design: The visual output should be sleek, contemporary, and incorporate creative design elements. Think clean lines, good use of whitespace, subtle animations or transitions, and a generally fresh aesthetic. Avoid outdated or generic styles.
Responsive: The HTML structure and styling (Tailwind and any custom CSS) should ensure the fragment is responsive and looks good on various screen sizes (mobile, tablet, desktop).
Semantic HTML (where appropriate): Use semantic HTML tags where they make sense for accessibility and structure (e.g., <section>, <article>, <nav>, <aside>), but prioritize the visual and structural integrity of the fragment.
Content Integration:
Directly integrate descriptive text based on the input description. Do not use generic placeholder text like "Lorem ipsum" or "Placeholder text." Write concise, meaningful content as if it were for the final webpage.
For images, use made-up, descriptive relative URLs. The path should be logical and the filename should describe the image content, using hyphens for spaces (e.g., /images/team/lead-designer-portrait.jpg, /content/features/data-visualization-graph.svg).
For links (<a> tags), use made-up, descriptive relative URLs (e.g., /services/detail/custom-solutions, /about-us/our-mission). The link text itself should also be descriptive.`;
  let response = await client.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: description }],
    model: "qwen-3-32b"
  });
  let html = response.choices[0]?.message.content;
  let regex = /<think>.*<\/think>/g;
  html = html.replaceAll(regex, "").trim();
  html = html.replace(/<think>/g, "").replace(/<\/think>/g, "").trim();
  html = html.replace("```html", "").replace(">```", "").replace(">\n```", "").trim();
  html += "\n<!-- " + description + " -->";
  return html;
}
export {
  GenerateHtml as G,
  GenerateImageFromRoute as a
};
