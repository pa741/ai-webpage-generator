import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { DomainToolkit } from "../types";

const BASE_DESCRIPTION = [
    "This site is a general-purpose web application generator.",
    "Interpret the URL route as the type of application or page to build —",
    "it could be a dashboard, a game, a data tool, a form, a map, a reporting tool, or anything else.",
    "Generate visually rich, structurally appropriate pages that match the implied application type.",
    "Use placeholder or mock data where a live backend would normally be required.",
    "The component library is your primary building material; create new components freely to realise the page.",
    "Sample routes: /analytics-dashboard, /stock-report, /neighborhood-map, /sports-analytics, /poker-game."
].join(" ");

async function getDescription(): Promise<string> {
    if (getApps().length === 0) initializeApp();
    try {
        const snap = await getFirestore().doc("benchmark/context").get();
        const instruction = snap.exists ? (snap.data()?.instruction as string | undefined) : undefined;
        if (instruction) {
            return `${BASE_DESCRIPTION}\n\nCurrent task instruction: ${instruction}`;
        }
    } catch {
        // Fall back to base description if Firestore is unavailable
    }
    return BASE_DESCRIPTION;
}

export const demoToolkit: DomainToolkit = {
    id: "demo",
    description: BASE_DESCRIPTION,
    getDescription,
    tools: []
};
