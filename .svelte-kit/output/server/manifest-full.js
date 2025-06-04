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
		client: {start:"_app/immutable/entry/start.CbPTQlsp.js",app:"_app/immutable/entry/app.CGDu547Z.js",imports:["_app/immutable/entry/start.CbPTQlsp.js","_app/immutable/chunks/CGtW6dGd.js","_app/immutable/chunks/ViAfpRsZ.js","_app/immutable/chunks/DzhXq6El.js","_app/immutable/entry/app.CGDu547Z.js","_app/immutable/chunks/ViAfpRsZ.js","_app/immutable/chunks/DbvivjGh.js","_app/immutable/chunks/BXyX0xXu.js","_app/immutable/chunks/DzhXq6El.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
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
