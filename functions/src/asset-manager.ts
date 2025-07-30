
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';


interface HdriAsset {
    name: string;
    type: number;
    date_published: number;
    download_count: number;
    files_hash: string;
    authors: Record<string, string>;
    categories: string[];
    tags: string[];
    max_resolution: [number, number];
    dimensions: [number, number];
    thumbnail_url: string;
    hdriUrl?: string; // Optional, will be added later
}


interface HdriResponse {
    [key: string]: HdriAsset;
}


interface HdriFile {
    url: string;
    md5: string;
    size: number;
}
interface HdriFiles {
    hdri: Record<string, Record<string, HdriFile>>;
    backplates: Record<string, HdriFile>;
    colorchart: HdriFile;
    tonemapped: HdriFile;
}


export async function LoadHdris() {
    //https://api.polyhaven.com/assets?t=hdris
    const response = await axios.get<HdriResponse>('https://api.polyhaven.com/assets?t=hdris');
    const assets = response.data;
    // add the lowest resolution hdri url to each asset
    const hdriUrls: Record<string, string> = {};
    for (const key in assets) {
        const filesResponse = await axios.get<HdriFiles>(`https://api.polyhaven.com/files/${key}`);
        const files = filesResponse.data;

        // try 1k and if not available try 2k, 4k, 8k, 16k
        const prefferedResolutions = ['1k', '2k', '4k', '8k', '16k'];
        for (const res of prefferedResolutions) {
            if (files.hdri[res]) {
                hdriUrls[key] = files.hdri[res].hdr.url;
                break;
            }
        }
        // If no hdri url was found, ignore this asset
        if (hdriUrls[key]) {
            assets[key].hdriUrl = hdriUrls[key];
        }

    }
    // load into firestore
    const db = getFirestore();
    const batch = db.batch();
    for (const key in assets) {
        const asset = assets[key];
        const docRef = db.collection('hdris').doc(key);
        batch.set(docRef, asset);
    }
    await batch.commit();
    console.log('HDRIs loaded into Firestore');
    return assets;

}



interface PolyPizzaAsset {
    ID: string;
    Title: string;
    Description?: string;
    Attribution: string;
    Thumbnail: string;
    Download: string;
    'Tri Count': number;
    Creator: {
        Username: string;
        DPURL: string;
    };
    Category: string;
    Tags: string[];
    Licence: string;
    Animated: boolean;
}
export async function LoadModels(ai: GoogleGenAI) {
    //https://api.poly.pizza/v1/user/Poly%20by%20Google
    const allAssets: PolyPizzaAsset[] = [];
    let page = -1;
    let hasMorePages = true;

    while (hasMorePages) {
        try {
            page++;

            const response = await axios.get<{ models: PolyPizzaAsset[] }>(`https://api.poly.pizza/v1/user/Poly%20by%20Google?page=${page}`, {
                headers: {
                    'x-auth-token': '3abc7eff92ea4a8eb4d2e4af396e1aa9' // poly.pizza api key
                }
            });

            if (response.status !== 200) {
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
            console.error(`Error loading models from page ${page}:`, error);
            continue; // Skip this page and try the next one
        }
    }

    // filter out models with more than 10000 triangles
    const filteredAssets = allAssets.filter(asset => asset['Tri Count'] < 10000);


    const storage = admin.storage();
    const bucket = storage.bucket();
    const db = getFirestore();
    const batch = db.batch();

    let i = 0;
    const uploadPromises: Promise<void>[] = [];
    for (const asset of filteredAssets) {
        i++;
        if (i % 10 === 0) {
            console.log(`Processing model ${i} of ${filteredAssets.length}...`);
        }
        const fileName = `models/${asset.ID}.glb`;
        const file = bucket.file(fileName);
        const docRef = db.collection('models').doc(asset.ID);

        // Check if the file already exists
        const [exists] = await file.exists();
        if (!exists) {
            try {
                // Download the model
                const modelResponse = await axios.get(asset.Download, { responseType: 'arraybuffer' });
                // Start the upload but don't wait for it to finish yet
                const uploadPromise = file.save(modelResponse.data, {
                    contentType: 'model/gltf-binary',
                }).then(async () => {
                    await file.makePublic(); // Make the file publicly accessible after upload
                    console.log(`Uploaded model ${asset.Title} to Firebase Storage`);
                });
                uploadPromises.push(uploadPromise);
            } catch (error) {
                console.error(`Failed to download or start upload for model ${asset.Title}:`, error);
                continue; // Skip this asset if download fails
            }
        } else {
            console.log(`Model ${asset.Title} already exists in Firebase Storage`);
        }

        // Generate embeddings for title and tags
        const embeddingResult = await ai.models.embedContent({ model: "gemini-embedding-001", contents: [asset.Title] });
        const embedding = embeddingResult.embeddings?.[0]?.values || [];


        // Add asset metadata to Firestore batch
        const assetWithUrl = {
            ...asset,
            storageUrl: file.publicUrl(), // Get the public URL
            embedding: FieldValue.vector(embedding), // Add the embedding
        };
        batch.set(docRef, assetWithUrl);
    }

    // Wait for all file uploads to complete
    await Promise.all(uploadPromises);
    console.log('All model uploads are complete.');

    // Commit the batch to Firestore
    await batch.commit();
    console.log(`${filteredAssets.length} models metadata saved to Firestore.`);

}


export async function GetModel(search: string, ai: GoogleGenAI): Promise<string> {
    const db = getFirestore();

    // Generate embedding for the search query
    const embeddingResult = await ai.models.embedContent({ model: "gemini-embedding-001", contents: [search] });
    const searchEmbedding = embeddingResult.embeddings?.[0]?.values;

    if (!searchEmbedding) {
        throw new Error('Failed to generate embedding for the search query.');
    }

    // Find the nearest model using vector search
    const snapshot = await db.collection('models').findNearest({
        distanceMeasure: 'COSINE',
        vectorField: 'embedding',
        queryVector: searchEmbedding,
        limit: 1,
    }).get();

    if (snapshot.empty) {
        throw new Error(`No model found for search term: "${search}"`);
    }

    const model = snapshot.docs[0].data() as PolyPizzaAsset & { storageUrl: string };
    if (!model.storageUrl) {
        throw new Error(`Model found for "${search}", but it has no storage URL.`);
    }
    return model.storageUrl;
}
export async function GetHdri(tags: string[]): Promise<string> {
    const db = getFirestore();
    const searchTags = tags.map(t => t.toLowerCase()).filter(Boolean);

    if (searchTags.length === 0) {
        throw new Error('No tags provided for HDRI search.');
    }

    // Firestore 'array-contains-any' can take up to 10 elements.
    // If more are provided, we'll just use the first 10.
    const queryTags = searchTags.slice(0, 10);

    const snapshot = await db.collection('hdris')
        .where('tags', 'array-contains-any', queryTags)
        .limit(1)
        .get();

    if (snapshot.empty) {
        // If no results with any of the tags, try finding one with just the first tag as a fallback.
        const fallbackSnapshot = await db.collection('hdris')
            .where('tags', 'array-contains', queryTags[0])
            .limit(1)
            .get();

        if (fallbackSnapshot.empty) {
            throw new Error(`No HDRI found for tags: "${tags.join(', ')}"`);
        }

        const asset = fallbackSnapshot.docs[0].data() as HdriAsset;
        if (!asset.hdriUrl) {
            throw new Error('HDRI found, but it has no download URL.');
        }
        return asset.hdriUrl;
    }

    // Return the first asset url
    const asset = snapshot.docs[0].data() as HdriAsset;
    if (!asset.hdriUrl) {
        throw new Error('HDRI found, but it has no download URL.');
    }
    return asset.hdriUrl;
}