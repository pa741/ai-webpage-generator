import type { DomainToolkit } from "./types";
import { dictionaryToolkit } from "./dictionary";

// To swap the site's domain (e.g. dictionary -> ecommerce), import a different
// toolkit module here and assign it to `activeToolkit`. Everything else —
// MCP tool registration, the page designer's domain context, client-side
// allowlisting — flows from this single export.
export const activeToolkit: DomainToolkit = dictionaryToolkit;
