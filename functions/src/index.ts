/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
// gemini api key -> AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0

import { onCall, Request } from "firebase-functions/https";
import { GoogleGenAI } from "@google/genai";
import { getRemoteConfig, type ServerConfig } from "firebase-admin/remote-config";
import { initializeApp } from "firebase-admin/app";

const ai = new GoogleGenAI({ apiKey: "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0" });

const app = initializeApp();

async function GetConfig(headers: Request): Promise<ServerConfig> {
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
        platform: headers.get('Sec-CH-UA-Platform') || 'unknown',
        userAgent: headers.get('User-Agent') || 'unknown',
        acceptLanguage: headers.get('Accept-Language') || 'en-US',
        referer: headers.get('Referer') || '',
    });

    return config;
}





export const generateContent = onCall({
    region: "europe-southwest1"
    //, cors:[/groots.es$/]
}, async (request, response) => {
    const { description } = request.data;
    if (!description) {
        throw new Error("Prompt is required");
    }
    const config = await GetConfig(request.rawRequest);
    const prompt = config.getString("content_writter_prompt");
    const model = config.getString("content_writter_model");

    let aiResponse = await ai.models.generateContentStream({
        model: model,
        config: {

            systemInstruction: prompt
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


export const createScene = onCall({
    region: "europe-southwest1"
    //, cors:[/groots.es$/]
}, async (request, response) => {
    const { description } = request.data as { description: string };
    if (!description) {
        throw new Error("Prompt is required");
    }
    const config = await GetConfig(request.rawRequest);
    const prompt = config.getString("three_generator_prompt");
    const model = config.getString("three_generator_model");

    let aiResponse = await ai.models.generateContent({
        model: model,

        config: {

            systemInstruction: prompt
        },
        contents: [
            { role: "user", parts: [{ text: description }] },
            {
                role: "assistant", parts: [{
                    text: `import * as THREE from "three";
const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({antialias: true, canvas});
document.body.appendChild(renderer.domElement);
        `}]
            }

        ]
    });

    return { script: aiResponse.text };

})

