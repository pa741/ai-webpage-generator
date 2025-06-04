import * as server from '../entries/pages/_...slug_/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_...slug_/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/[...slug]/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.DsVSH74Z.js","_app/immutable/chunks/DMqsXUnB.js","_app/immutable/chunks/JWWkP_09.js","_app/immutable/chunks/B6HIK-gZ.js","_app/immutable/chunks/B3frtIaU.js","_app/immutable/chunks/D4a5Jan8.js"];
export const stylesheets = ["_app/immutable/assets/3.tn0RQdqM.css"];
export const fonts = [];
