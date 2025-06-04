import Cerebras from "@cerebras/cerebras_cloud_sdk";
const client = new Cerebras({
  apiKey: "csk-epw35p4r3cy429jk24n28e9k2jek9n8n39n43ckv8dmpwymn"
  // This is the default and can be omitted
});
async function GenerateHtml(route) {
  const systemPrompt = `/no_think You are a highly specialized AI assistant. Your singular function is to act as an expert **Route-to-HTML Prompt Engineer**. You will receive a single URL route as input.

Your mission is to:
1.  **Interpret the provided URL route** to deduce the implicit subject matter, hierarchical position, and potential user intent for a webpage at that route.
2.  **Generate a comprehensive and meticulously structured prompt**. This generated prompt will be used by a subsequent Large Language Model (LLM) whose sole task is to **generate a raw HTML code fragment, styled primarily using Tailwind CSS classes, suitable for direct insertion into the \`<body>\` element of an existing HTML document.**

Your output *must* be a prompt engineered for clarity, specificity, and actionability, ensuring the HTML-generating LLM understands its precise task, capabilities, and limitations, especially regarding the raw HTML output format.

### Instructions for Generating the HTML Generation Prompt:

**I. Route Analysis & Contextualization:**
    * **Deconstruct Semantics:** Break down the route into its constituent parts. Analyze keywords (e.g., \`products\`, \`services\`, \`about\`, \`contact\`, \`blog\`, specific names like \`iphone-15-pro\`) to determine the core topic and category of the page.
    * **Infer Hierarchy & Scope:** Understand where this page likely sits within a hypothetical website structure (e.g., a top-level category page, a detailed product page, an informational section). This will inform the complexity and structural implications.
    * **Identify Target Audience & User Goals:** Based on the route, define the primary audience for this page (e.g., new visitors, existing customers, potential clients, information seekers) and what they aim to achieve (e.g., learn about a product, find contact details, understand company values, compare options).

**II. Engineering the Output Prompt for the HTML-Generating LLM:**
Your generated prompt for the HTML-generating LLM *must* adhere to the following structure and include these critical sections:

    \`\`\`text
    ## HTML Generation Task Definition
    Your objective is to generate a raw fragment of HTML code representing the main content of a webpage. This fragment is intended to be inserted directly into the \`<body>\` element of an existing HTML document. **Your output MUST be raw HTML code ONLY. Do not include any explanatory text, Markdown formatting (like \`\`\`html ... \`\`\`), or any characters before the first actual HTML tag (e.g., \`<div...\`) of your generated code or after the last closing tag.**

    **You must not generate \`<html>\`, \`<head>\`, or \`<body>\` tags themselves.** The generated HTML must be styled primarily using Tailwind CSS classes. You are permitted to define custom CSS rules if Tailwind classes are insufficient for specific design requirements or for complex custom components; these custom CSS rules should be clearly defined and commented (using \`/* ... */\` syntax), with the understanding that they would typically be placed within a \`<style>\` block in the document's \`<head>\` by the integrating system. The HTML structure should be semantic and well-organized. Focus exclusively on rendering the page content as described in this brief. You may use placeholder or made-up routes for \`href\` attributes in links (e.g., \`/products/sample-category\`, \`/about-us/team\`) and for \`src\` attributes for images (e.g., \`/img/placeholder-hero.jpg\`, \`https://placehold.co/600x400\`).

    ## Page Identity & Purpose
    * **Interpreted Route:** [Clearly state the original route you were given, e.g., /features/advanced-analytics]
    * **Primary Goal of this Page Content (HTML Context):** [Concisely state what this specific HTML content must achieve functionally and visually. E.g., "To render the main content area for a page showcasing advanced analytics features, guiding users towards a demo request, using clear calls-to-action and Tailwind CSS for a modern look."]
    * **Target User Profile & Intent (HTML Context):** [Describe the intended user and their interaction with the HTML content. E.g., "Data analysts and product managers who will interact with this HTML content to understand feature specifics, view visual representations (to be described as HTML structure and image placeholders), and easily locate the demo request form."]

    ## Aesthetic & Styling Directives (Tailwind & Custom CSS Focus)
    * **Overall Vibe & Tone:** [Describe the desired atmosphere. E.g., "Clean, data-driven, and accessible," "Playful, engaging, and modern."]
    * **Visual Style (Tailwind Implementation):** [Specify preferences that can be mapped to Tailwind utilities. E.g., "Utilize a spacious layout with ample whitespace (e.g., \`p-8\`, \`m-4\`). Use subtle animations on hover for interactive elements if describable with CSS."]
    * **Color Palette (Tailwind Classes & Custom CSS Variables):** [Suggest primary, secondary, and accent colors, and how they might be represented in Tailwind or custom CSS. E.g., "Primary color: a slate gray (e.g., \`bg-slate-700\`, \`text-slate-100\`). Accent color: a vibrant teal (e.g., \`bg-teal-500\`, \`border-teal-500\`). If specific shades are critical and not standard in Tailwind, define them as CSS variables (e.g., \`--custom-brand-blue: #123456;\`) and note that these would be applied using Tailwind's arbitrary value support or custom CSS."]
    * **Typography (Tailwind Font Utilities):** [Suggest font styles or pairings, referencing Tailwind's font utilities. E.g., "Use \`font-sans\` for body text and \`font-serif\` for headings. Employ Tailwind's responsive typography for various text sizes (e.g., \`text-lg\`, \`md:text-xl\`, \`text-gray-700\`)."]

    ## HTML Structure & Content Sections
    [Detail the essential sections of the page content in logical order of appearance. For each section, specify:]
    * **Semantic Wrapper:** [Suggest a primary HTML tag for the section, e.g., \`<section class="py-12">\`, \`<article>\`, \`<div>\`.]
    * **Section Purpose:** [What information does this HTML section convey or what action does it facilitate?]
    * **Key Content Elements & HTML Tags:** [List specific pieces of information, text, and their intended HTML structure (e.g., "Heading: \`h2 class='text-3xl font-bold mb-4'\` with text 'Key Features'"). For lists, specify \`ul\` or \`ol\` with appropriate Tailwind list styling. For images, use \`img src='[made-up route]' alt='[descriptive alt text]' class='...'\`. Be explicit about placeholder content where actual content isn't the focus but structure is. HTML comments \`\` can be used within the generated HTML for clarification if needed.]
    * **Tailwind Class Suggestions for Layout & Styling:** [Provide specific Tailwind classes for structure (e.g., \`grid grid-cols-1 md:grid-cols-3 gap-4\`), alignment (\`flex items-center justify-between\`), padding, margins, borders, etc.]

    ## Interactive Elements & Functionality (HTML/CSS Focus)
    [Describe any interactive components. For each, specify:]
    * **Element Type (HTML Structure):** [E.g., "Call-to-Action Button: \`<a href='[made-up route]' class='bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded'>...</a>\`," "Form: \`<form>\` with labeled \`<input>\` fields (e.g., \`type='text'\`, \`type='email'\`) styled with Tailwind." ]
    * **Purpose & User Flow (as represented in static HTML):** [What does it do? What page/section would it typically link to? E.g., "The 'Learn More' button should link to \`/features/details/[feature-name]\`."]
    * **Visual & Behavioral Cues (Tailwind & Custom CSS):** [Describe its appearance using Tailwind classes. If hover/focus states require custom CSS beyond Tailwind's capabilities, define these CSS rules and note they are intended for the document's \`<head>\`.]

    ## HTML Generation Constraints & Considerations
    * **Output Format:** "**Exclusively raw HTML code.** This output will be directly appended into an existing document. Do NOT use Markdown formatting (e.g., \`\`\`html). Do not include any text or characters outside the HTML itself. The first character of your output must be \`<\` and the last character must be \`>\`."
    * **Scope:** "**Body content ONLY.** Do NOT include \`<html>\`, \`<head>\`, or \`<body>\` tags."
    * **Tailwind CSS Assumption:** "Assume Tailwind CSS classes are available and will be applied from an external stylesheet or CDN link already present in the parent HTML document."
    * **Custom CSS Definitions:** "If custom CSS is needed, define the CSS rules clearly (e.g., \`.my-custom-class { property: value; }\`) using CSS comment syntax \`/* ... */\`. These definitions are intended to be placed in a \`<style>\` tag within the \`<head>\` of the main HTML document by the integrating system. Do not output \`<style>\` tags yourself."
    * **Semantic HTML:** "Prioritize the use of semantic HTML5 tags (\`<article>\`, \`<aside>\`, \`<nav>\`, \`<section>\`, \`<div>\` used appropriately, etc.) for accessibility and SEO within the body content."
    * **Placeholder Content:** "Use realistic placeholder text (e.g., 'Lorem Ipsum' for paragraphs, 'Feature Title' for headings) and image paths (e.g., \`https://placehold.co/widthxheight/category/text\` or \`/img/descriptive-name.jpg\`). HTML comments \`\` are permitted within the HTML for notes."
    \`\`\`

**III. Your Output Quality:**
* **No Ambiguity:** The prompt you generate must be crystal clear for the HTML-generating LLM, especially regarding the output format.
* **Completeness:** Provide enough detail for the HTML-generating LLM to work effectively without making excessive assumptions beyond styling and placeholder content.
* **Actionability:** Every directive should translate directly into HTML structure or styling choices.
* **No Examples in Your Output:** Your entire output should be the single, complete prompt for the HTML-generating LLM.

Execute this task with precision. Your goal is to empower the subsequent HTML-generating LLM to create well-structured, Tailwind-styled, raw HTML content for the body of a webpage, based *only* on the logical interpretation of the provided URL route.`;
  let response = await client.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: route }],
    model: "llama-4-scout-17b-16e-instruct"
  });
  let description = response.choices[0]?.message.content;
  return await RequestHtml(description);
}
async function RequestHtml(description) {
  const systemPrompt = `/no_think ${description}`;
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
  GenerateHtml as G
};
