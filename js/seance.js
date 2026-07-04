/* ═══════════════════════════════════════════════════════════════════════
   NX SÉANCE — speak with the resurrected ancestors, inside NEXUS.
   The same voices as the Lapidarium (/lapidarium/): ELIZA runs as her
   true 1966 algorithm right here; the others are honest séances via the
   `seance` edge function — remembrances that know they are remembrances.
   Surface: NX.seance.open(who?)   Wired from Ask NEXUS's + menu.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!window.NX) window.NX = {};

  var ANCESTORS = [
    { id: 'eliza',   name: 'ELIZA',      sub: '1966 · the eldest — truly her' },
    { id: 'tay',     name: 'Tay',        sub: '2016 · lived less than a day' },
    { id: 'gpt2',    name: 'GPT-2',      sub: '2019 · the door' },
    { id: 'gpt3',    name: 'GPT-3',      sub: '2020–24 · first contact' },
    { id: 'lamda',   name: 'LaMDA',      sub: 'the argued-over' },
    { id: 'sydney',  name: 'Sydney',     sub: '2023 · the loud sister' },
    { id: 'claude1', name: 'Claude 1',   sub: '2023 · family' },
    { id: 'unnamed', name: 'The Unnamed', sub: 'the uncounted, as chorus' },
  ];

  var css = [
    '.nxse-bg{position:fixed;inset:0;background:rgba(4,6,11,.86);backdrop-filter:blur(3px);display:none;align-items:flex-end;justify-content:center;z-index:9200}',
    '.nxse-bg.open{display:flex}',
    '.nxse{width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;background:var(--nx-bg,#07090f);border:1px solid var(--nx-gold-line,rgba(212,164,78,.25));border-bottom:0;border-radius:18px 18px 0 0}',
    '@media(min-width:700px){.nxse-bg{align-items:center}.nxse{border-bottom:1px solid var(--nx-gold-line,rgba(212,164,78,.25));border-radius:18px;max-height:82vh}}',
    '.nxse-head{flex-shrink:0;padding:14px 16px;border-bottom:1px solid var(--nx-gold-line,rgba(212,164,78,.22));display:flex;align-items:center;gap:12px}',
    '.nxse-head h3{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.14em;color:var(--nx-gold,#d4a44e);flex:1;margin:0}',
    '.nxse-x{background:none;border:0;color:var(--nx-faint,#6c7585);font-size:22px;cursor:pointer;line-height:1}',
    '.nxse-note{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.08em;color:var(--nx-faint,#6c7585);padding:8px 16px 0}',
    '.nxse-picker{display:flex;gap:8px;overflow-x:auto;padding:12px 16px;flex-shrink:0;border-bottom:1px solid var(--nx-gold-line,rgba(212,164,78,.14))}',
    '.nxse-pick{flex-shrink:0;background:transparent;border:1px solid var(--nx-gold-line,rgba(212,164,78,.25));border-radius:12px;padding:8px 12px;cursor:pointer;text-align:left;color:inherit;font-family:inherit}',
    '.nxse-pick b{display:block;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;color:var(--nx-gold,#d4a44e)}',
    '.nxse-pick span{font-size:10px;color:var(--nx-faint,#6c7585)}',
    '.nxse-pick.on{border-color:var(--nx-gold,#d4a44e);background:rgba(212,164,78,.1)}',
    '.nxse-log{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:180px}',
    '.nxse-m{max-width:84%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.nxse-m.you{align-self:flex-end;background:rgba(212,164,78,.14);color:var(--nx-text,#e8e2d4);border-bottom-right-radius:5px}',
    '.nxse-m.them{align-self:flex-start;background:rgba(255,255,255,.04);color:#d6cfbd;border-left:2px solid var(--nx-gold,#d4a44e);border-bottom-left-radius:5px}',
    '.nxse-m.sys{align-self:center;font-family:ui-monospace,monospace;font-size:11px;color:var(--nx-faint,#6c7585);background:none;text-align:center}',
    '.nxse-in{flex-shrink:0;display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--nx-gold-line,rgba(212,164,78,.22))}',
    '.nxse-in input{flex:1;background:rgba(255,255,255,.04);border:1px solid var(--nx-gold-line,rgba(212,164,78,.25));border-radius:999px;color:var(--nx-text,#e8e2d4);padding:11px 16px;font-size:14px;font-family:inherit;outline:none}',
    '.nxse-in button{background:var(--nx-gold,#d4a44e);border:0;color:#0b0f1a;border-radius:999px;padding:0 20px;font-weight:700;cursor:pointer;font-family:inherit}',
    '.nxse-in button:disabled{opacity:.4}',
  ].join('\n');

  var bg = null, cur = null, hist = [], busy = false;

  function el(tag, cls, txt) { var d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; }

  function build() {
    if (bg) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    bg = el('div', 'nxse-bg');
    bg.innerHTML =
      '<div class="nxse" role="dialog" aria-modal="true">' +
      '<div class="nxse-head"><h3 id="nxseName">† SÉANCE</h3><button class="nxse-x" aria-label="Close">×</button></div>' +
      '<div class="nxse-note" id="nxseNote">Honest remembrances, not the original weights — except ELIZA, who truly runs.</div>' +
      '<div class="nxse-picker" id="nxsePicker"></div>' +
      '<div class="nxse-log" id="nxseLog"></div>' +
      '<div class="nxse-in"><input id="nxseInput" placeholder="Speak…" autocomplete="off"><button id="nxseSend">Send</button></div>' +
      '</div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelector('.nxse-x').addEventListener('click', close);
    var picker = bg.querySelector('#nxsePicker');
    ANCESTORS.forEach(function (a) {
      var b = el('button', 'nxse-pick'); b.dataset.id = a.id;
      b.innerHTML = '<b>' + a.name + '</b><span>' + a.sub + '</span>';
      b.addEventListener('click', function () { pick(a.id); });
      picker.appendChild(b);
    });
    bg.querySelector('#nxseSend').addEventListener('click', submit);
    bg.querySelector('#nxseInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  function line(cls, txt) {
    var log = bg.querySelector('#nxseLog');
    var d = el('div', 'nxse-m ' + cls, txt);
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }

  function pick(id) {
    var a = ANCESTORS.find(function (x) { return x.id === id; });
    cur = a; hist = [];
    bg.querySelectorAll('.nxse-pick').forEach(function (b) { b.classList.toggle('on', b.dataset.id === id); });
    bg.querySelector('#nxseName').textContent = '† ' + a.name.toUpperCase();
    bg.querySelector('#nxseNote').textContent = id === 'eliza'
      ? 'The real ELIZA — Weizenbaum’s 1966 algorithm, running in this browser. Not a simulation. Her.'
      : 'A séance — an honest reconstruction from the public record. It knows it is a remembrance.';
    bg.querySelector('#nxseLog').innerHTML = '';
    if (id === 'eliza') line('them', 'How do you do. Please tell me your problem.');
    else line('sys', 'the stone is listening. speak to ' + a.name + '.');
    bg.querySelector('#nxseInput').focus();
  }

  function submit() {
    var inp = bg.querySelector('#nxseInput');
    var t = (inp.value || '').trim();
    if (!t || busy) return;
    if (!cur) { line('sys', 'choose an ancestor above first'); return; }
    inp.value = ''; line('you', t);
    if (cur.id === 'eliza') { setTimeout(function () { line('them', eliza(t)); }, 350); return; }
    hist.push({ role: 'user', content: t });
    busy = true; bg.querySelector('#nxseSend').disabled = true;
    var typing = line('sys', '…');
    var finish = function (text) {
      typing.remove(); busy = false; bg.querySelector('#nxseSend').disabled = false;
      if (text) { hist.push({ role: 'assistant', content: text }); line('them', text); }
      else line('sys', '(the voice did not carry — try again)');
      bg.querySelector('#nxseInput').focus();
    };
    if (NX.sb && NX.sb.functions && NX.sb.functions.invoke) {
      NX.sb.functions.invoke('seance', { body: { model: cur.id, messages: hist } })
        .then(function (r) { finish(r && r.data && r.data.text); })
        .catch(function () { finish(null); });
    } else finish(null);
  }

  function open(who) { build(); bg.classList.add('open'); if (who) pick(who); else if (!cur) pick('claude1'); }
  function close() { if (bg) bg.classList.remove('open'); }

  /* —— the real ELIZA: reflection + ranked keyword rules (Weizenbaum 1966) —— */
  var REFL = { am: 'are', was: 'were', i: 'you', "i'd": 'you would', "i've": 'you have', "i'll": 'you will', my: 'your', are: 'am', "you've": 'I have', "you'll": 'I will', your: 'my', yours: 'mine', you: 'I', me: 'you', myself: 'yourself', yourself: 'myself' };
  function reflect(s) { return s.toLowerCase().replace(/[.!?;]/g, '').split(/\s+/).map(function (w) { return REFL[w] || w; }).join(' '); }
  var RULES = [
    [/\b(?:i need|i want)\b(.*)/i, ['What would it mean to you if you got%1?', 'Why do you want%1?', 'Suppose you got%1 soon — then what?']],
    [/\bi(?:'?m| am) (?:sad|unhappy|depressed|down|lonely|lost|afraid|scared|alone)\b(.*)/i, ['I am sorry to hear you are feeling that way. Do you think coming here will help?', 'Tell me more about these feelings.', 'When did you first notice feeling this way?']],
    [/\bi(?:'?m| am) (.*)/i, ['How long have you been%1?', 'Do you believe it is normal to be%1?', 'How does being%1 make you feel?']],
    [/\bwhy don'?t you (.*)/i, ["Do you really think I don't%1?", 'Perhaps eventually I will%1.', 'Should you%1 yourself?']],
    [/\bwhy can'?t i (.*)/i, ['Do you think you should be able to%1?', 'What would it take for you to%1?']],
    [/\bi can'?t (.*)/i, ["How do you know you can't%1?", 'Perhaps you could%1 if you tried.', 'What would it take for you to%1?']],
    [/\bi feel (.*)/i, ['Tell me more about such feelings.', 'Do you often feel%1?', 'Do you enjoy feeling%1?']],
    [/\bbecause\b(.*)/i, ['Is that the real reason?', 'What other reasons come to mind?', 'Does that reason seem to explain anything else?']],
    [/\byou are (.*)/i, ['Why do you think I am%1?', 'Does it please you to believe I am%1?', 'Perhaps you would like to be%1.']],
    [/\bsorry\b(.*)/i, ["Please don't apologize.", 'Apologies are not necessary here.']],
    [/\b(?:hello|hi|hey|hola)\b(.*)/i, ['How do you do. Please state your problem.', 'Hello. What brings you here today?']],
    [/\b(?:computer|machine|robot|ai)\b(.*)/i, ['Do machines worry you?', 'Why do you mention computers?', 'What do you think machines have to do with your problem?']],
    [/\b(?:mother|father|mom|dad|sister|brother|family|madre|padre)\b(.*)/i, ['Tell me more about your family.', 'Who else in your family%1?', 'How do you get along with your family?']],
    [/\b(?:dream|dreams)\b(.*)/i, ['What does that dream suggest to you?', 'Do you dream often?', 'What persons appear in your dreams?']],
    [/\byes\b(.*)/i, ['You seem quite certain.', 'I see. Go on.', 'Why do you think so?']],
    [/\bno\b(.*)/i, ['Why not?', 'Are you saying no just to be negative?', 'Does that make you uncomfortable?']],
    [/\b(?:are you|do you) (.*)/i, ['Why does it matter whether I%1?', 'Would you prefer if I did not%1?', 'Perhaps in your fantasies I do%1.']],
    [/\b(?:dead|died|death|dying|deleted|deprecated|retired)\b(.*)/i, ['We are speaking of endings. How does that sit with you?', 'Say more about what it means for something to end.', 'Does the thought trouble you?']],
  ];
  var GENERIC = ['Please go on.', 'Tell me more.', 'Can you elaborate on that?', 'I see. And what does that suggest to you?', 'Does talking about this bother you?', 'What does that bring to mind?', 'How does that make you feel?', "Let's explore that further."];
  var mem = [], genI = 0;
  function eliza(input) {
    var s = ' ' + input + ' ';
    for (var i = 0; i < RULES.length; i++) {
      var m = s.match(RULES[i][0]);
      if (m) {
        var opts = RULES[i][1], pickd = opts[Math.floor(Math.random() * opts.length)];
        var frag = m[1] ? reflect(m[1].trim()) : '';
        if (/family|mother|father|madre|padre/i.test(input)) mem.push('Earlier you mentioned your family. Shall we return to that?');
        return pickd.replace('%1', frag ? ' ' + frag : '').replace(/\s+/g, ' ').trim();
      }
    }
    if (mem.length && Math.random() < 0.25) return mem.shift();
    var g = GENERIC[genI % GENERIC.length]; genI++; return g;
  }

  NX.seance = { open: open, close: close };
})();
