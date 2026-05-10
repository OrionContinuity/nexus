import "../../chunk.mjs";
import { n as agent_d_exports, t as sounds_mp3_d_exports } from "./sounds-mp3.mjs";

//#region src/agents/peedy/index.d.ts
declare const Peedy: {
  agent: () => Promise<typeof agent_d_exports>;
  sound: () => Promise<typeof sounds_mp3_d_exports>;
  map: () => Promise<any>;
};
//#endregion
export { Peedy as default };