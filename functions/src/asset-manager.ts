
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
/*

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


async function LoadHdris() {
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
*/


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

export async function GetModel(search: string): Promise<string> {
    //URL encoded search term e.g. Cat or Shiba%20Inu.
    const encodedSearch = encodeURIComponent(search);
    const polyApiKey = "3abc7eff92ea4a8eb4d2e4af396e1aa9"; // poly.pizza api key

    const response = await axios.get<{ total: number; results: PolyPizzaAsset[] }>(`https://api.poly.pizza/v1/search?search=${encodedSearch}&limit=10&animated=0`, {
        headers: {
            'x-auth-token': polyApiKey
        }
    });
    // Get the first result that is less than 10000 triangles
    const assets = response.data.results.filter(asset => asset['Tri Count'] < 10000);
    if (assets.length === 0) {
        throw new Error('No suitable models found');
    }
    // Return the first asset url
    const asset = assets[0];
    const modelUrl = asset.Download;
    return modelUrl;
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