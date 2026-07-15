// curia_brain.js — THE CURIA ORCHESTRATOR.  Watch -> Consul -> (Vigil replay | Senate think) -> Action.
//
// Ties the named tiers together and talks to LOCAL model servers over HTTP (llama.cpp / Ollama, which both
// speak the OpenAI /v1/chat/completions shape). Dependency-free (Node's own http). If no model server is up
// it degrades to a pure rules + Formulary engine, so the loop still runs (and is testable) with the GPU cold.
//
//   VIGIL  — tiny model pinned hot in VRAM        -> snap reflexes, blank-filling      (~50ms)
//   SENATE — big model in system RAM (+ Augur draft) -> deep plans, writes Formulas    (seconds)
//   WATCH  — small VLM                            -> turns the eyes PNG into a sentence
//   CONSUL — this file's router                   -> replay a draft, reflex, or convene the Senate
//   FORMULARY (curia_formulary.js)                -> the reusable drafts both tiers share

const http = require('http');
const path = require('path');
const F = require('./curia_formulary');

// Where each tier listens. llama.cpp's llama-server and Ollama both expose an OpenAI-compatible endpoint.
const ENDPOINTS = {
  vigil:  process.env.VIGIL_URL  || 'http://127.0.0.1:11434/v1/chat/completions', // ollama, tiny, hot in VRAM
  senate: process.env.SENATE_URL || 'http://127.0.0.1:8080/v1/chat/completions',  // llama.cpp 7-14B in RAM + Augur
  watch:  process.env.WATCH_URL  || 'http://127.0.0.1:11434/v1/chat/completions', // ollama, small VLM
};
const MODELS = {
  vigil:  process.env.VIGIL_MODEL  || 'qwen2.5:1.5b-instruct-q4_K_M',
  senate: process.env.SENATE_MODEL || 'qwen2.5-7b-instruct',
  watch:  process.env.WATCH_MODEL  || 'moondream',
};

function httpJson(url, body, timeoutMs) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve(null); }
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs || 8000, () => { try { req.destroy(); } catch (e) {} resolve(null); });
    req.write(data); req.end();
  });
}

async function chat(tier, messages, opts) {
  opts = opts || {};
  const out = await httpJson(ENDPOINTS[tier], {
    model: MODELS[tier],
    messages,
    temperature: opts.temp != null ? opts.temp : (tier === 'vigil' ? 0 : 0.4),
    max_tokens: opts.max || (tier === 'vigil' ? 64 : 512),
    stream: false,
  }, opts.timeout || (tier === 'senate' ? 60000 : 8000));
  try { return out.choices[0].message.content; } catch (e) { return null; }
}

// THE WATCH — eyes PNG/blocks -> one sentence the Senate can reason on. Falls back to the raw text if no VLM.
async function watch(situationText, eyesPng) {
  const msg = [{ role: 'user', content: 'In one sentence, describe the scene for a Minecraft helper. Scene: ' + (situationText || '') }];
  return (await chat('watch', msg, { max: 80 })) || situationText || '';
}

// Fast danger / social sniffers (pure string tests — no model, runs every tick for free).
const URGENT = ['creeper', 'zombie', 'skeleton', 'spider', 'tnt', 'lava', 'fall', 'drown', 'fire', 'hostile', 'attack', 'arrow', 'hurt'];
const SOCIAL = ['say', 'said', 'asked', 'player', 'chat', 'question', 'hello', 'help', 'why', 'son', 'kid'];
function isUrgent(sit) { const b = F.bag(sit); return URGENT.some(t => b.has(t)); }
function isSocial(sit) { const b = F.bag(sit); return SOCIAL.some(t => b.has(t)); }

// THE CONSUL — route each tick.
//   1) a Formula matches AND it's calm/non-social -> REPLAY it (the Vigil, ~free)
//   2) danger                                     -> VIGIL reflex now, think later
//   3) no draft / social / a blank we can't fill  -> convene the SENATE
async function route(mcdir, sit) {
  const hit = F.match(mcdir, sit);
  if (hit && !isUrgent(sit) && !isSocial(sit)) {
    const plan = F.fill(hit.formula, sit.blanks || {});
    if (!plan.missing.length) {
      return { mode: 'replay', via: 'vigil', formula: hit.formula.id, score: hit.score, steps: plan.steps };
    }
    // draft matched but one blank is unknown -> have the Vigil fill just that blank cheaply, then replay
    const val = await fillBlankFast(sit, plan.missing[0]);
    if (val) {
      const p2 = F.fill(hit.formula, Object.assign({}, sit.blanks, { [plan.missing[0]]: val }));
      if (!p2.missing.length) return { mode: 'replay', via: 'vigil+fill', formula: hit.formula.id, steps: p2.steps };
    }
  }
  if (isUrgent(sit)) return { mode: 'reflex', via: 'vigil', reason: 'danger' };
  return { mode: 'think', via: 'senate', reason: hit ? 'blank-unfilled' : (isSocial(sit) ? 'social' : 'no-formula') };
}

async function fillBlankFast(sit, blank) {
  const a = await chat('vigil', [{ role: 'user', content: 'Scene: ' + JSON.stringify(sit) + '. Reply with ONLY the value for "' + blank + '". One token, no words.' }], { max: 8 });
  return a && a.trim().split(/\s+/)[0];
}

// THE SENATE — think once, then FILE the result as a Formula so this thought is never paid for again.
async function think(mcdir, sit, memories) {
  const sys = 'You are the Senate, Clippy\'s deep planner. Output ONLY compact JSON for a REUSABLE template: '
    + '{"id","name","when":{"tags":[],"needs":[]},"blanks":[],"steps":[{"do":"...","what":"..."}]}. '
    + 'Use {blank} placeholders in steps for anything situation-specific.';
  const usr = 'Situation: ' + JSON.stringify(sit) + '\nRelevant memory: ' + JSON.stringify(memories || []) + '\nWrite the reusable Formula.';
  const raw = await chat('senate', [{ role: 'system', content: sys }, { role: 'user', content: usr }], { max: 700, timeout: 90000 });
  const formula = parsePlan(raw);
  if (formula) { formula.author = 'senate'; F.save(mcdir, formula); }   // <-- now reusable by the whole trio, forever
  return formula;
}

function parsePlan(raw) {
  if (!raw) return null;
  let j = raw; const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) j = raw.slice(a, b + 1);
  let plan; try { plan = JSON.parse(j); } catch (e) { return null; }
  if (!plan.steps || !plan.steps.length) return null;
  plan.id = plan.id || (plan.name || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  return plan;
}

// ONE FULL TICK — the loop clippy_agent.js calls each cycle.
async function tick(mcdir, world) {
  const scene = await watch(world.text || '', world.eyes);
  const sit = Object.assign({}, world, { scene });
  const decision = await route(mcdir, sit);
  if (decision.mode === 'think') {
    const formula = await think(mcdir, sit, world.memories);
    if (formula) {
      const plan = F.fill(formula, sit.blanks || {});
      decision.formula = formula.id; decision.steps = plan.steps; decision.mode = 'think->replay';
    }
  }
  return decision;
}

module.exports = { tick, route, think, watch, chat, fillBlankFast, ENDPOINTS, MODELS, isUrgent, isSocial };

// DRY DEMO — no model server, no GPU: shows the Consul routing + Formulary replay purely from disk.
if (require.main === module) {
  (async () => {
    const os = require('os'), fs = require('fs');
    const mc = fs.mkdtempSync(path.join(os.tmpdir(), 'curia-'));
    // seed one draft, as if the Senate had written it the first time it ever chopped a tree
    F.save(mc, { id: 'chop_tree', name: 'Chop a tree',
      when: { tags: ['tree', 'log', 'wood', 'gather'], needs: ['axe?'] }, blanks: ['target', 'dir', 'count'],
      steps: [{ do: 'equip', what: 'best_axe' }, { do: 'goto', what: '{target}' },
              { do: 'mine', what: '{target}', times: '{count}' }, { do: 'collect', what: 'log' }] });

    const routine = { text: 'a birch tree is west, wood is low', tags: ['tree', 'wood'], blanks: { target: 'birch@-12,71,40', dir: 'west', count: 4 } };
    const danger  = { text: 'a creeper is approaching fast', tags: ['creeper', 'hostile'] };
    const novel   = { text: 'we found a village with an empty house', tags: ['village', 'house'] };

    console.log('ROUTINE (known task) ->', JSON.stringify(await route(mc, routine)));
    console.log('DANGER  (creeper)    ->', JSON.stringify(await route(mc, danger)));
    console.log('NOVEL   (no draft)   ->', JSON.stringify(await route(mc, novel)), '  <- would wake the Senate, which files a new draft');
    console.log('\n(model servers are cold here, so NOVEL routes to think; on the PC the Senate answers and the draft is saved for next time.)');
  })();
}
