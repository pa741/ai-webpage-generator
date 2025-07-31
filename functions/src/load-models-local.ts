import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';
import { LoadModels } from './asset-manager';

// Initialize Firebase Admin with your service account
//import * as serviceAccount from '../../credential.json'; // Adjust the path as necessary

admin.initializeApp({
    credential: admin.credential.cert("../../credential.json"),
    storageBucket: 'generativewebpage.appspot.com'
});

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0" });

async function runLoadModels() {
    try {
        console.log('Starting to load models locally...');
        console.log('This may take a while as it processes thousands of models.');
        
        const startTime = Date.now();
        await LoadModels(ai);
        const endTime = Date.now();
        
        console.log(`\nCompleted successfully in ${(endTime - startTime) / 1000} seconds`);
        process.exit(0);
    } catch (error) {
        console.error('Error loading models:', error);
        process.exit(1);
    }
}

// Run the function
runLoadModels();
