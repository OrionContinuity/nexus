/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest Module (admin.js)
   LIVE ACTIVITY LOG — every pipeline step
   visible on screen. No more blind ingests.
   ═══════════════════════════════════════════ */
(function(){

let gmailToken = null;
let gisLoaded = false;
let tokenClient = null;

// ─── LIVE LOG (visible on screen) ───
function log(msg, type) {
  const el = document.getElementById('ingestLog');
  if (!el) return;
  const line = document.createElement('div');
  line.className = 'log-line log-' + (type || 'info');
  const ts = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="log-ts">${ts}</span> ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  // Also mirror to console
  if (type === 'error') console.error('[NEXUS]', msg);
  else if (type === 'warn') console.warn('[NEXUS]', msg);
  else console.log('[NEXUS]', msg);
}

function clearLog() {
  const el = document.getElementById('ingestLog');
  if (el) el.innerHTML = '';
}

async function init(){
  document.getElementById('ingestTextBtn').addEventListener('click', ingestText);
  document.getElementById('trelloBtn').addEventListener('click', trelloImport);
  document.getElementById('gmailConnectBtn').addEventListener('click', connectGmail);
  document.getElementById('gmailSyncBtn')?.addEventListener('click', syncEmails);
  document.getElementById('clearLogBtn')?.addEventListener('click', clearLog);
  loadGoogleAuth();

  const stored = localStorage.getItem('nexus_gmail_token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.expiry > Date.now()) {
        gmailToken = parsed.token;
        showGmailConnected();
      } else { localStorage.removeItem('nexus_gmail_token'); }
    } catch(e) {}
  }
  updateStats();
}

// ═══ GOOGLE AUTH ═══
function loadGoogleAuth() {
  const clientId = NX.getGoogleClientId();
  if (!clientId) return;
  if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => initTokenClient();
    document.head.appendChild(s);
  } else { initTokenClient(); }
}

function initTokenClient() {
  const clientId = NX.getGoogleClientId();
  if (!clientId || !window.google?.accounts?.oauth2) return;
  gisLoaded = true;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback: (resp) => {
      if (resp.access_token) {
        gmailToken = resp.access_token;
        localStorage.setItem('nexus_gmail_token', JSON.stringify({ token: resp.access_token, expiry: Date.now() + 55*60*1000 }));
        showGmailConnected();
        log('Gmail connected ✓', 'success');
      }
    },
  });
}

function connectGmail() {
  const clientId = NX.getGoogleClientId();
  if (!clientId) { log('No Google Client ID set. Open Admin ⚙ first.', 'error'); return; }
  if (!gisLoaded) { loadGoogleAuth(); setTimeout(connectGmail, 1000); return; }
  if (tokenClient) tokenClient.requestAccessToken();
}

function showGmailConnected() {
  document.getElementById('gmailStatusText').textContent = '✓ Connected';
  document.getElementById('gmailStatusText').style.color = 'var(--green)';
  document.getElementById('gmailConnectBtn').textContent = 'Reconnect';
  document.getElementById('gmailSyncControls').style.display = 'block';
}

// ═══ GMAIL SYNC ═══
async function syncEmails() {
  if (!gmailToken) { connectGmail(); return; }
  const btn = document.getElementById('gmailSyncBtn');
  const progressFill = document.getElementById('gmailProgressFill');
  const progressText = document.getElementById('gmailProgressText');
  document.getElementById('gmailProgress').style.display = 'flex';
  btn.disabled = true; btn.textContent = 'Syncing...';
  clearLog();
  log('Starting email sync...');

  const daysVal = document.getElementById('gmailDays').value;
  const filter = document.getElementById('gmailFilter').value.trim();
  let query = '';
  if (daysVal !== 'all') {
    const after = new Date(); after.setDate(after.getDate() - parseInt(daysVal));
    query = `after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
  }
  if (filter) query += (query ? ' ' : '') + filter;
  log(`Search query: "${query || '(all emails)'}"`);

  try {
    let messageIds = []; let nextPageToken = null;
    do {
      const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('maxResults', '500');
      if (query) url.searchParams.set('q', query);
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${gmailToken}` } });
      if (resp.status === 401) {
        localStorage.removeItem('nexus_gmail_token'); gmailToken = null;
        log('Token expired — click Connect Gmail again.', 'error');
        btn.disabled = false; btn.textContent = '⚡ Sync Emails → Brain'; return;
      }
      const data = await resp.json();
      if (data.messages) messageIds.push(...data.messages.map(m => m.id));
      nextPageToken = data.nextPageToken;
      log(`Fetched ${messageIds.length} email IDs...`);
    } while (nextPageToken);

    if (!messageIds.length) { log('No emails found.', 'warn'); btn.disabled = false; btn.textContent = '⚡ Sync Emails → Brain'; return; }
    log(`<b>${messageIds.length} emails found.</b> Pulling content...`, 'success');

    const BATCH = 10; let allEmailText = [];
    for (let i = 0; i < messageIds.length; i += BATCH) {
      const batch = messageIds.slice(i, i + BATCH);
      progressFill.style.width = Math.round((i / messageIds.length) * 40) + '%';
      progressText.textContent = `${i} / ${messageIds.length}`;
      const fetches = batch.map(id =>
        fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { 'Authorization': `Bearer ${gmailToken}` } }).then(r => r.json()).catch(() => null));
      const results = await Promise.all(fetches);
      results.forEach(msg => {
        if (!msg || !msg.payload) return;
        const headers = msg.payload.headers || [];
        const getH = (n) => (headers.find(h => h.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
        allEmailText.push(`FROM: ${getH('From')}\nTO: ${getH('To')}\nDATE: ${getH('Date')}\nSUBJECT: ${getH('Subject')}\n${msg.snippet || ''}`);
      });
      if (i + BATCH < messageIds.length) await sleep(150);
    }
    log(`Pulled content from <b>${allEmailText.length}</b> emails.`);

    const AI_BATCH = 15; let totalNodes = 0; let totalErrors = 0;
    const totalBatches = Math.ceil(allEmailText.length / AI_BATCH);
    for (let i = 0; i < allEmailText.length; i += AI_BATCH) {
      const chunk = allEmailText.slice(i, i + AI_BATCH).join('\n\n---EMAIL---\n\n');
      const batchNum = Math.floor(i / AI_BATCH) + 1;
      progressFill.style.width = (40 + Math.round((i / allEmailText.length) * 55)) + '%';
      progressText.textContent = `AI batch ${batchNum}/${totalBatches}`;
      log(`AI batch ${batchNum}/${totalBatches} — sending to Claude...`);
      const result = await aiProcess(chunk);
      if (result) {
        const saved = await saveExtracted(result);
        totalNodes += saved;
        log(`Batch ${batchNum}: <b>${saved} nodes</b> created (${result.nodes.length} extracted, ${result.nodes.length - saved} dupes)`, 'success');
      } else {
        totalErrors++;
        log(`Batch ${batchNum}: AI returned no usable data`, 'warn');
      }
      if (i + AI_BATCH < allEmailText.length) await sleep(500);
    }
    progressFill.style.width = '100%'; progressText.textContent = 'Done!';
    log(`<b>Sync complete: ${totalNodes} new nodes</b> from ${allEmailText.length} emails.${totalErrors ? ' ' + totalErrors + ' empty batches.' : ''}`, 'success');
    await NX.loadNodes(); if (NX.brain) NX.brain.init(); updateStats();
  } catch(e) {
    log('FATAL: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = '⚡ Sync Emails → Brain';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ AI PROCESSING ═══
async function aiProcess(text) {
  try {
    const answer = await NX.askClaude(
      `You are a knowledge extraction engine for a restaurant operations system (Suerte, Este, Bar Toti — Austin TX).

Extract EVERY distinct entity. Create a node for each person, business, equipment, procedure, project, phone number, invoice, or deadline.

Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location

RESPOND WITH ONLY RAW JSON. No markdown, no backticks, no explanation:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}`,
      [{role:'user', content: text.slice(0, 14000)}], 3000);

    let json = answer.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const start = json.indexOf('{'); const end = json.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) { log('AI response had no valid JSON', 'warn'); return null; }
    json = json.slice(start, end + 1);
    try {
      const parsed = JSON.parse(json);
      if (parsed.nodes && Array.isArray(parsed.nodes)) return parsed;
      log('Parsed JSON missing nodes array', 'warn'); return null;
    } catch(e) { log('JSON parse failed: ' + e.message, 'error'); return null; }
  } catch(e) { log('Claude API error: ' + e.message, 'error'); return null; }
}

// ═══ SAVE EXTRACTED ═══
async function saveExtracted(r) {
  if (!r || !r.nodes || !r.nodes.length) return 0;
  let c = 0, errors = 0;

  let existingNames = new Set(NX.nodes.map(n => (n.name || '').toLowerCase()));
  try {
    const { data } = await NX.sb.from('nodes').select('name');
    if (data) data.forEach(n => existingNames.add((n.name || '').toLowerCase()));
  } catch(e) { log('Dedup fetch warning: ' + e.message, 'warn'); }

  const validCats = ['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];

  for (const n of r.nodes) {
    const name = (n.name || '').trim();
    if (!name || name.length < 2) continue;
    if (existingNames.has(name.toLowerCase())) continue;

    const row = {
      name: name.slice(0, 200),
      category: validCats.includes(n.category) ? n.category : 'equipment',
      tags: Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string').slice(0, 20) : [],
      notes: (n.notes || '').slice(0, 2000),
      links: [],
      access_count: 1
    };

    const { error } = await NX.sb.from('nodes').insert(row);
    if (error) {
      errors++;
      if (errors <= 3) log(`Insert failed "${name}": ${error.message}`, 'error');
    } else {
      existingNames.add(name.toLowerCase());
      c++;
    }
  }

  if (r.cards) for (const x of r.cards) {
    if (!x.title) continue;
    const { error } = await NX.sb.from('kanban_cards').insert({ title: (x.title||'').slice(0,200), column_name: x.column_name || 'todo' });
    if (error) log(`Card insert failed: ${error.message}`, 'error');
  }

  if (errors > 0) log(`${errors} inserts failed — check Supabase table schema`, 'error');
  return c;
}

// ═══ PASTE TEXT INGEST ═══
async function ingestText() {
  const text = document.getElementById('ingestText').value.trim();
  if (!text) return;
  const btn = document.getElementById('ingestTextBtn');
  btn.disabled = true; btn.textContent = '...';
  clearLog();
  log('Processing pasted text (' + text.length + ' chars)...');
  const r = await aiProcess(text);
  if (r) {
    log(`AI extracted ${r.nodes.length} nodes, ${(r.cards||[]).length} cards`);
    const saved = await saveExtracted(r);
    log(`<b>${saved} new nodes created.</b>`, 'success');
    await NX.loadNodes(); if (NX.brain) NX.brain.init(); updateStats();
  } else {
    log('No data extracted from text.', 'warn');
  }
  btn.disabled = false; btn.textContent = '⚡ Process';
  document.getElementById('ingestText').value = '';
}

// ═══ TRELLO IMPORT ═══
async function trelloImport() {
  const trelloKey = NX.getTrelloKey();
  const trelloToken = NX.getTrelloToken();
  if (!trelloKey || !trelloToken) { log('No Trello keys set. Open Admin ⚙.', 'error'); return; }

  const btn = document.getElementById('trelloBtn');
  btn.disabled = true; btn.textContent = 'Pulling...';
  clearLog();
  log('Connecting to Trello...');

  try {
    const resp = await fetch(`https://api.trello.com/1/members/me/boards?key=${trelloKey}&token=${trelloToken}`);
    if (!resp.ok) { log(`Trello API returned ${resp.status} ${resp.statusText}`, 'error'); btn.disabled = false; btn.textContent = '🔄 Smart Trello Import'; return; }
    const boards = await resp.json();
    log(`Found <b>${boards.length} boards</b>`);

    let all = 'TRELLO BOARDS:\n'; let totalCards = 0;
    for (const board of boards) {
      log(`Pulling board: ${board.name}...`);
      all += `\n== ${board.name} ==\n`;
      const cr = await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${trelloKey}&token=${trelloToken}`);
      const cards = await cr.json();
      if (!Array.isArray(cards)) { log(`Board "${board.name}" returned no cards`, 'warn'); continue; }
      totalCards += cards.length;
      cards.slice(0, 100).forEach(c => {
        all += `- [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,200):''}${c.due?' | Due:'+c.due.split('T')[0]:''}\n`;
      });
    }
    log(`Pulled <b>${totalCards} cards</b> across ${boards.length} boards. Sending to AI...`, 'success');

    const r = await aiProcess(all);
    if (r) {
      log(`AI extracted ${r.nodes.length} nodes, ${(r.cards||[]).length} cards from Trello data`);
      const saved = await saveExtracted(r);
      log(`<b>${saved} new nodes created from Trello.</b>`, 'success');
      await NX.loadNodes(); if (NX.brain) NX.brain.init(); updateStats();
    } else {
      log('AI could not extract nodes from Trello data.', 'warn');
    }
  } catch(e) {
    log('Trello error: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = '🔄 Smart Trello Import';
}

// ═══ STATS ═══
function updateStats() {
  const el = document.getElementById('ingestStats');
  if (!el) return;
  const total = NX.nodes.length;
  const cats = {};
  NX.nodes.forEach(n => { cats[n.category] = (cats[n.category] || 0) + 1; });
  const breakdown = Object.entries(cats).sort((a,b) => b[1] - a[1])
    .map(([cat, count]) => `<span class="stat-chip">${cat} <b>${count}</b></span>`).join('');
  el.innerHTML = `<div class="stat-total">${total} total nodes in brain</div><div class="stat-chips">${breakdown}</div>`;
}

NX.modules.ingest = { init, show: () => { updateStats(); } };
})();
