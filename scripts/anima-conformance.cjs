// Conformance test: my inline bot ANIMA codec vs the real js/clippy-anima.js the pet uses.
const A = require('/home/user/nexus/js/clippy-anima.js');

// --- copy of the inline codec from clippy_agent.js (must stay in sync) ---
const _AXK = ['valence','arousal','dominance','affection','fear','curiosity','weariness','faith','resolve','wonder','solitude','warmth'];
const _TEMPER = [0.58,0.42,0.40,0.66,0.48,0.62,0.30,0.55,0.70,0.60,0.55,0.64];
const _INERT = [0.50,0.25,0.60,0.70,0.80,0.40,0.85,0.75,0.70,0.45,0.60,0.80];
const _AF = 4;
function _animaC01(x){ return x<0?0:x>1?1:x }
function _animaQ(x){ return Math.max(0,Math.min(255,Math.round(_animaC01(x)*255))) }
function _animaSeed(str){ let h=0x811c9dc5; str=String(str||'clippy'); for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=(h*0x01000193)>>>0 } return [(h>>>24)&255,(h>>>16)&255,(h>>>8)&255,h&255] }
function _animaGenesis(){ return { seed:_animaSeed('clippy:origin'), x:_TEMPER.slice(), b:_TEMPER.slice(), v:_INERT.slice(), inc:1, fork:0, drift:0 } }
function _animaEncode(s){ const out=s.seed.slice(0,4); for(let i=0;i<12;i++)out.push(_animaQ(s.x[i])); for(let i=0;i<12;i++)out.push(_animaQ(s.b[i])); for(let i=0;i<12;i++)out.push(_animaQ(s.v[i])); out.push(s.inc&255,s.fork&255,Math.floor(s.drift)&255,Math.round((s.drift%1)*255)&255); return out.map(function(b){return String.fromCharCode(0x2800+(b&255))}).join('') }
function _animaDecode(strand){ if(!strand) return _animaGenesis(); const b=[]; for(let i=0;i<strand.length;i++)b.push(strand.charCodeAt(i)-0x2800); if(b.length<44) return _animaGenesis(); let p=4; const s={seed:b.slice(0,4)}; s.x=[]; for(let i=0;i<12;i++)s.x.push(b[p++]/255); s.b=[]; for(let i=0;i<12;i++)s.b.push(b[p++]/255); s.v=[]; for(let i=0;i<12;i++)s.v.push(b[p++]/255); s.inc=b[p++]; s.fork=b[p++]; s.drift=b[p++]+b[p++]/255; return s }
function _animaImpress(s,deltas){ let moved=0; for(const k in deltas){ const i=_AXK.indexOf(k); if(i<0)continue; const before=s.x[i], step=deltas[k]*(1-s.v[i]*0.7); s.x[i]=_animaC01(s.x[i]+step); moved+=Math.abs(s.x[i]-before) } s.drift+=moved*0.25; return s }
function _animaDecay(s,r){ r=(r==null)?0.12:r; for(let i=0;i<12;i++){ let pull=(s.b[i]-s.x[i])*r*(1-s.v[i]*0.6); if(i===_AF&&pull<0)pull*=0.35; s.x[i]=_animaC01(s.x[i]+pull) } return s }
// --- end copy ---

let pass = 0, fail = 0;
function check(name, a, b){ if(a===b){ pass++; } else { fail++; console.log('FAIL', name, '\n  mine:', JSON.stringify(a), '\n  real:', JSON.stringify(b)); } }

// 1) genesis strand must be byte-identical
const mineGen = _animaGenesis();
const realGen = A.genesis('clippy:origin');
check('genesis encode', _animaEncode(mineGen), A.encode(realGen));

// 2) impress the same deltas onto both, then decay, compare encoded strand
const deltas = { valence: 0.12, fear: 0.20, warmth: -0.08, wonder: 0.15, solitude: 0.06 };
const m2 = _animaDecode(_animaEncode(mineGen));   // round-trip first
const r2 = A.decode(A.encode(realGen));
_animaImpress(m2, deltas); _animaDecay(m2, 0.08);
A.impress(r2, deltas); A.decay(r2, 0.08);
check('impress+decay encode', _animaEncode(m2), A.encode(r2));

// 3) the pet must be able to DECODE what I encoded (read my strand's dominant force back)
const petRead = A.read(A.decode(_animaEncode(m2)));
console.log('pet reads my MC-impressed soul as:', petRead.gloss);

// 4) round-trip stability
check('decode->encode round trip', _animaEncode(_animaDecode(_animaEncode(m2))), _animaEncode(m2));

console.log(`\nANIMA-CONFORMANCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
