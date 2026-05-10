const Peedy = {
	agent: () => import("./agent.mjs"),
	sound: () => import("./sounds-mp3.mjs"),
	map: () => import("./map.mjs")
};
export { Peedy as default };
