export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.C-T1woiP.js",app:"_app/immutable/entry/app.fem7C81z.js",imports:["_app/immutable/entry/start.C-T1woiP.js","_app/immutable/chunks/D4a5Jan8.js","_app/immutable/chunks/JWWkP_09.js","_app/immutable/entry/app.fem7C81z.js","_app/immutable/chunks/JWWkP_09.js","_app/immutable/chunks/D3iXKO_p.js","_app/immutable/chunks/DMqsXUnB.js","_app/immutable/chunks/B6HIK-gZ.js","_app/immutable/chunks/DSh_Uhu6.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js'))
		],
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/[...slug]",
				pattern: /^(?:\/(.*))?\/?$/,
				params: [{"name":"slug","optional":false,"rest":true,"chained":true}],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
