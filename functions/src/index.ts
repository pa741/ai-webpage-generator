/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
// gemini api key -> AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0

import { onCall } from "firebase-functions/https";
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0" });

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

export const generateContent = onCall({region:"europe-southwest1"
   //, cors:[/groots.es$/]
},async (request, response) => {
    const { description } = request.data;
    if (!description) {
        throw new Error("Prompt is required");
    }
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
    let aiResponse = await ai.models.generateContentStream({
        model: "gemini-2.0-flash",
        config: {

            systemInstruction: systemPrompt
        },
        contents: description
    });
    const fullResponse = [];

    for await (const chunk of aiResponse) {
        if (request.acceptsStreaming) {
            response?.sendChunk({
                content: chunk.text,
            });
        }
        fullResponse.push(chunk.text);
    }
    return fullResponse;

})


