import * as server from '../entries/pages/_...slug_/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_...slug_/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/[...slug]/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.CRrrxAl6.js","_app/immutable/chunks/BXyX0xXu.js","_app/immutable/chunks/ViAfpRsZ.js","_app/immutable/chunks/p-kEVcuO.js","_app/immutable/chunks/CGtW6dGd.js","_app/immutable/chunks/DzhXq6El.js"];
export const stylesheets = ["_app/immutable/assets/3.tn0RQdqM.css"];
export const fonts = [];
