
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { getFirestore } from 'firebase-admin/firestore';

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

async function createEmbedding(input: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY || "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";
    const embeddingResponse = await axios.post<{ data: Array<{ embedding: number[] }> }>(
        "https://api.openai.com/v1/embeddings",
        {
            model: "text-embedding-3-small",
            input,
        },
        {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        }
    );

    const embedding = embeddingResponse.data.data[0]?.embedding;
    if (!embedding) {
        throw new Error('Failed to generate embedding for the search query.');
    }

    return embedding;
}

export async function GetModel(search: string, ai: GoogleGenAI): Promise<string> {
    const db = getFirestore();

    // Generate embedding for the search query
    const searchEmbedding = await createEmbedding(search);

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