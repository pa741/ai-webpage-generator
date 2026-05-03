import type { DomainToolkit } from "./types";
import { dictionaryToolkit } from "./dictionary";
import { demoToolkit } from "./demo";

// To swap the site's domain (e.g. dictionary -> ecommerce), import a different
// toolkit module here and assign it to `activeToolkit`. Everything else —
// MCP tool registration, the page designer's domain context, client-side
// allowlisting — flows from this single export.
//
// Set TOOLKIT_ID=demo in functions/.env to enable the domain-agnostic demo
// toolkit used by the benchmark suite.
export const activeToolkit: DomainToolkit =
    process.env.TOOLKIT_ID === "demo" ? demoToolkit : dictionaryToolkit;
