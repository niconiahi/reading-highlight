export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["abou-ben-adhem.json","abou-ben-adhem.txt","favicon.svg","icons.svg","sw.js"]),
	mimeTypes: {".json":"application/json",".txt":"text/plain",".svg":"image/svg+xml",".js":"text/javascript"},
	_: {
		client: {start:"_app/immutable/entry/start.BWrHCQPM.js",app:"_app/immutable/entry/app.BTY5ybi4.js",imports:["_app/immutable/entry/start.BWrHCQPM.js","_app/immutable/chunks/CBMRs5zH.js","_app/immutable/chunks/n7yxS55I.js","_app/immutable/entry/app.BTY5ybi4.js","_app/immutable/chunks/n7yxS55I.js","_app/immutable/chunks/kNaey6uv.js","_app/immutable/chunks/xihTtKlq.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
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
