const Bonzi = {
	agent: () => import("./agent.mjs"),
	sound: () => import("./sounds-mp3.mjs"),
	map: () => import("./map.mjs")
};
export { Bonzi as default };
