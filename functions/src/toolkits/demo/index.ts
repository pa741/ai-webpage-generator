import type { DomainToolkit } from "../types";

export const demoToolkit: DomainToolkit = {
    id: "demo",
    description: [
        "This site is a general-purpose web application generator.",
        "Interpret the URL route as the type of application or page to build —",
        "it could be a dashboard, a game, a data tool, a form, a map, a reporting tool, or anything else.",
        "Generate visually rich, structurally appropriate pages that match the implied application type.",
        "Use placeholder or mock data where a live backend would normally be required.",
        "The component library is your primary building material; create new components freely to realise the page.",
        "Sample routes: /analytics-dashboard, /stock-report, /neighborhood-map, /sports-analytics, /poker-game."
    ].join(" "),
    tools: []
};
