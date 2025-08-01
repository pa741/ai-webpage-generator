const { GoogleGenAI } = require('@google/genai');
const admin = require('firebase-admin');
const axios = require('axios');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const OpenAI = require("openai");
const client = new OpenAI({
    apiKey: "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"
});


// Initialize Firebase Admin with your service account
//const serviceAccount = require('../../credential.json');

admin.initializeApp({
    credential: admin.credential.cert("C:\\Users\\pablodegroot\\webgenerator-experiment\\ai-webpage-generator\\credential.json"),
    storageBucket: 'generativewebpage.firebasestorage.app'
});

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0" });

async function LoadModels(ai) {
    //https://api.poly.pizza/v1/user/Poly%20by%20Google
    const allAssets = [];
    let page = -1;
    let hasMorePages = true;

    console.log('Starting to fetch models from Poly Pizza API...');

    while (hasMorePages) {
        try {
            page++;
            console.log(`Fetching page ${page}...`);

            const response = await axios.get(`https://api.poly.pizza/v1/user/Poly%20by%20Google?page=${page}`, {
                headers: {
                    'x-auth-token': '3abc7eff92ea4a8eb4d2e4af396e1aa9' // poly.pizza api key
                }
            });

            if (response.status !== 200) {
                console.log(`Skipping page ${page} - status: ${response.status}`);
                continue;
            }
            const models = response.data.models;
            console.log(`Loaded ${models.length} models from page ${page}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit to avoid hitting API limits
            allAssets.push(...models);

            if (models.length < 32) {
                hasMorePages = false;
            }
        } catch (error) {
            console.error(`Error loading models from page ${page}:`, error.message);
            continue; // Skip this page and try the next one
        }
    }

    console.log(`\nTotal models fetched: ${allAssets.length}`);

    // filter out models with more than 10000 triangles
    const filteredAssets = allAssets.filter(asset => asset['Tri Count'] < 10000);
    console.log(`Models after filtering (< 10k triangles): ${filteredAssets.length}`);

    const storage = admin.storage();
    const bucket = storage.bucket();
    const db = getFirestore();

    let i = 0;
    const uploadPromises = [];

    console.log('\nStarting to process models...');

    const chunkSize = 100;
    for (let i = 0; i < filteredAssets.length; i += chunkSize) {
        const chunk = filteredAssets.slice(i, i + chunkSize);
        console.log(`Processing chunk ${i / chunkSize + 1} of ${Math.ceil(filteredAssets.length / chunkSize)}... (models ${i + 1} to ${i + chunk.length})`);

        // Handle file uploads for the chunk
        for (const asset of chunk) {
            const fileName = `models/${asset.ID}.glb`;
            const file = bucket.file(fileName);

            // Check if the file already exists
            const [exists] = await file.exists();
            if (!exists) {
                const downloadAndUploadPromise = (async () => {
                    try {
                        // Download the model
                        const modelResponse = await axios.get(asset.Download, { responseType: 'arraybuffer' });
                        // Upload the model
                        await file.save(modelResponse.data, {
                            contentType: 'model/gltf-binary',
                        });
                        // Make the file public
                        await file.makePublic();
                        console.log(`✓ Uploaded model ${asset.Title} to Firebase Storage`);
                    } catch (error) {
                        console.error(`✗ Failed to download or upload model ${asset.Title}:`, error.message);
                    }
                })();
                uploadPromises.push(downloadAndUploadPromise);
            } else {
                console.log(`- Model ${asset.Title} already exists in Firebase Storage`);
            }
        }

        // Generate embeddings for the chunk in a single batch call with retry logic for rate limits
        let embeddingResult;
        let success = false;
        let retries = 0;
        const maxRetries = 5;
        let delay = 30000; // Start with 30 seconds

        const titles = chunk.map(asset => asset.Title + ' ' + asset.Tags.join(', '));

        while (!success && retries < maxRetries) {
            try {


                let response = await client.embeddings.create({
                    model: "text-embedding-3-small",
                    input: titles
                });
                embeddingResult = response.data.map(item => item.embedding);
                success = true;
            } catch (error) {
                if (error.message && error.message.includes('429')) { // Check for rate limit error
                    retries++;
                    console.warn(`Rate limit hit for embeddings. Retrying in ${delay / 1000}s... (Attempt ${retries}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                } else {
                    console.error(`✗ Error generating embeddings for chunk:`, error.message);
                    embeddingResult = null; // Ensure embeddingResult is null on non-retryable error
                    break; // Exit retry loop for other errors
                }
            }
        }

        if (!success) {
            console.error(`✗ Failed to generate embeddings for chunk after ${maxRetries} retries.`);
        }

        const embeddings = embeddingResult || [];
        const batch = db.batch();

        // Add asset metadata to Firestore batch
        chunk.forEach((asset, index) => {
            const docRef = db.collection('models').doc(asset.ID);
            const file = bucket.file(`models/${asset.ID}.glb`);
            const embedding = embeddings[index];

            const assetWithUrl = {
                ...asset,
                storageUrl: file.publicUrl(),
            };

            if (embedding) {
                assetWithUrl.embedding = FieldValue.vector(embedding);
            } else {
                console.warn(`- No embedding generated for model ${asset.Title}`);
            }
            batch.set(docRef, assetWithUrl);
        });

        if (success) {
            console.log(`✓ Prepared metadata for chunk.`);
        }
        await batch.commit();


    }

    console.log('\nWaiting for all uploads to complete...');
    // Wait for all file uploads to complete
    await Promise.all(uploadPromises);
    console.log('All model uploads are complete.');

    console.log('Committing metadata to Firestore...');

    // Commit the batch to Firestore
    console.log(`${filteredAssets.length} models metadata saved to Firestore.`);
}

async function runLoadModels() {
    try {
        console.log('=== Starting to load models locally ===');
        console.log('This may take a while as it processes thousands of models.');
        console.log('You can safely interrupt with Ctrl+C if needed.\n');

        const startTime = Date.now();
        await LoadModels(ai);
        const endTime = Date.now();

        console.log(`\n=== Completed successfully in ${Math.round((endTime - startTime) / 1000)} seconds ===`);
        process.exit(0);
    } catch (error) {
        console.error('Error loading models:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Gracefully shutting down...');
    process.exit(0);
});

// Run the function
runLoadModels();
