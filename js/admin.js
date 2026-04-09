/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest Module (admin.js)
   Gmail email sync, batch AI node extraction,
   Trello import, paste ingest.
   FIXED: full error logging, robust JSON parse,
   dedup from Supabase not memory, no silent fails.
   ═══════════════════════════════════════════ */
(function(){

let gmailToken = null;
let gisLoaded = false;
let tokenClient = null;

async function init(){
  document.getElementById('ingestTextBtn').addEventListener('click', ingestText);
  document.getElementById('trelloBtn').addEventListener('click', trelloImport);
  document.getElementById('gmailConnectBtn').addEventListener('click', connectGmail);
  document.getElementById('gmailSyncBtn')?.addEventListener('click', syncEmails);
  loadGoogleAuth();

  const stored = localStorage.getItem('nexus_gmail_token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.expiry > Date.now()) {
        gmailToken = parsed.token;
        showGmailConnected();
      } else {
        localStorage.removeItem('nexus_gmail_token');
      }
    } catch(e) {}
  }
  updateStats();
}

// ═══════════════════════════════════════════
// GOOGLE IDENTITY SERVICES
// ═══════════════════════════════════════════
function loadGoogleAuth() {
  const clientId = NX.getGoogleClientId();
  if (!clientId) return;
  if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => initTokenClient();
    document.head.appendChild(s);
  } else {
    initTokenClient();
  }
}

function initTokenClient() {
  const clientId = NX.getGoogleClientId();
  if (!clientId || !window.google?.accounts?.oauth2) return;
  gisLoaded = true;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback: (response) => {
      if (response.access_token) {
        gmailToken = response.access_token;
        localStorage.setItem('nexus_gmail_token', JSON.stringify({
          token: response.access_token,
          expiry: Date.now() + 55 * 60 * 1000
        }));
        showGmailConnected();
      }
    },
  });
}

function connectGmail() {
  const clientId = NX.getGoogleClientId();
  if (!clientId) {
    document.getElementById('gmailStatusText').textContent = 'Set Google Client ID in Admin (⚙) first.';
    document.getElementById('gmailStatusText').style.color = 'var(--red)';
    return;
  }
  if (!gisLoaded) { loadGoogleAuth(); setTimeout(connectGmail, 1000); return; }
  if (tokenClient) tokenClient.requestAccessToken();
}

function showGmailConnected() {
  document.getElementById('gmailStatusText').textContent = '✓ Connected';
  document.getElementById('gmailStatusText').style.color = 'var(--green)';
  document.getElementById('gmailConnectBtn').textContent = 'Reconnect';
  document.getElementById('gmailSyncControls').style.display = 'block';
}

// ═══════════════════════════════════════════
// GMAIL EMAIL SYNC
// ═══════════════════════════════════════════
async function syncEmails() {
  if (!gmailToken) { connectGmail(); return; }
  const status = document.getElementById('ingestStatus');
  const btn = document.getElementById('gmailSyncBtn');
  const progressBar = document.getElementById('gmailProgress');
  const progressFill = document.getElementById('gmailProgressFill');
  const progressText = document.getElementById('gmailProgressText');

  btn.disabled = true;
  btn.textContent = 'Syncing...';
  progressBar.style.display = 'flex';
  status.textContent = '';

  const daysVal = document.getElementById('gmailDays').value;
  const filter = document.getElementById('gmailFilter').value.trim();

  let query = '';
  if (daysVal !== 'all') {
    const after = new Date();
    after.setDate(after.getDate() - parseInt(daysVal));
    query = `after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
  }
  if (filter) query += (query ? ' ' : '') + filter;

  try {
    // 1. Fetch message IDs (no cap — get them all)
    let messageIds = [];
    let nextPageToken = null;
    status.textContent = 'Fetching email list...';

    do {
      const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('maxResults', '500');
      if (query) url.searchParams.set('q', query);
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${gmailToken}` }
      });
      if (resp.status === 401) {
        localStorage.removeItem('nexus_gmail_token');
        gmailToken = null;
        status.textContent = 'Token expired. Click Connect Gmail again.';
        btn.disabled = false; btn.textContent = '⚡ Sync Emails → Brain';
        progressBar.style.display = 'none';
        return;
      }
      const data = await resp.json();
      if (data.messages) messageIds.push(...data.messages.map(m => m.id));
      nextPageToken = data.nextPageToken;
      status.textContent = `Found ${messageIds.length} emails so far...`;
    } while (nextPageToken);

    if (!messageIds.length) {
      status.textContent = 'No emails found matching your criteria.';
      btn.disabled = false; btn.textContent = '⚡ Sync Emails → Brain';
      progressBar.style.display = 'none';
      return;
    }

    status.textContent = `Found ${messageIds.length} emails. Pulling content...`;
    console.log(`[NEXUS] Email sync: ${messageIds.length} message IDs fetched`);

    // 2. Fetch email content in batches
    const BATCH = 10;
    let allEmailText = [];
    for (let i = 0; i < messageIds.length; i += BATCH) {
      const batch = messageIds.slice(i, i + BATCH);
      const pct = Math.round((i / messageIds.length) * 40);
      progressFill.style.width = pct + '%';
      progressText.textContent = `${i} / ${messageIds.length} emails`;

      const fetches = batch.map(id =>
        fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
          headers: { 'Authorization': `Bearer ${gmailToken}` }
        }).then(r => r.json()).catch(() => null)
      );
      const results = await Promise.all(fetches);

      results.forEach(msg => {
        if (!msg || !msg.payload) return;
        const headers = msg.payload.headers || [];
        const getH = (name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
        allEmailText.push(
          `FROM: ${getH('From')}\nTO: ${getH('To')}\nDATE: ${getH('Date')}\nSUBJECT: ${getH('Subject')}\n${msg.snippet || ''}`
        );
      });

      if (i + BATCH < messageIds.length) await sleep(150);
    }

    console.log(`[NEXUS] Pulled content from ${allEmailText.length} emails`);
    status.textContent = `Pulled ${allEmailText.length} emails. AI processing in batches...`;

    // 3. Process through Claude in batches
    const AI_BATCH = 15;
    let totalNodes = 0;
    let totalErrors = 0;
    for (let i = 0; i < allEmailText.length; i += AI_BATCH) {
      const chunk = allEmailText.slice(i, i + AI_BATCH).join('\n\n---EMAIL---\n\n');
      const batchNum = Math.floor(i/AI_BATCH) + 1;
      const totalBatches = Math.ceil(allEmailText.length/AI_BATCH);
      const pct = 40 + Math.round((i / allEmailText.length) * 55);
      progressFill.style.width = pct + '%';
      progressText.textContent = `AI batch ${batchNum}/${totalBatches}`;

      const result = await aiProcess(chunk, status);
      if (result) {
        const saved = await saveExtracted(result, status, true);
        totalNodes += saved;
        console.log(`[NEXUS] Batch ${batchNum}: extracted ${saved} new nodes`);
      } else {
        totalErrors++;
        console.warn(`[NEXUS] Batch ${batchNum}: AI returned no data`);
      }

      if (i + AI_BATCH < allEmailText.length) await sleep(500);
    }

    progressFill.style.width = '100%';
    progressText.textContent = 'Done!';
    status.textContent = `Sync complete: ${totalNodes} new nodes from ${allEmailText.length} emails.${totalErrors ? ' (' + totalErrors + ' batches had no data)' : ''}`;
    console.log(`[NEXUS] Email sync done. ${totalNodes} nodes created, ${totalErrors} empty batches.`);

    await NX.loadNodes();
    if (NX.brain) NX.brain.init();
    updateStats();

  } catch(e) {
    console.error('[NEXUS] Email sync error:', e);
    status.textContent = 'Error: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = '⚡ Sync Emails → Brain';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
// AI PROCESSING (FIXED: robust JSON extraction)
// ═══════════════════════════════════════════
async function aiProcess(text, status) {
  try {
    const answer = await NX.askClaude(
      `You are a knowledge extraction engine for a restaurant operations system managing Suerte, Este, and Bar Toti in Austin TX.

Extract EVERY piece of useful knowledge. Be aggressive — create a node for:
- Every person name (staff, contractors, vendors, contacts)
- Every business/company mentioned
- Every piece of equipment (brand + model)
- Every procedure or protocol
- Every project discussed
- Every phone number, email, invoice number
- Every scheduling detail or deadline

Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location

RESPOND WITH ONLY RAW JSON. No markdown, no backticks, no explanation. Just the JSON object:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}`,
      [{role:'user', content: text.slice(0, 14000)}],
      3000
    );

    console.log('[NEXUS] AI raw response length:', answer.length);

    // Robust JSON extraction — handle markdown fences, extra text
    let json = answer;
    // Strip markdown code fences
    json = json.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    // Find the JSON object
    const start = json.indexOf('{');
    const end = json.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      console.warn('[NEXUS] No valid JSON found in AI response:', answer.slice(0, 200));
      return null;
    }
    json = json.slice(start, end + 1);

    try {
      const parsed = JSON.parse(json);
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        console.log(`[NEXUS] AI extracted ${parsed.nodes.length} nodes, ${(parsed.cards||[]).length} cards`);
        return parsed;
      }
      console.warn('[NEXUS] Parsed JSON has no nodes array:', Object.keys(parsed));
      return null;
    } catch(parseErr) {
      console.error('[NEXUS] JSON parse failed:', parseErr.message);
      console.error('[NEXUS] Attempted to parse:', json.slice(0, 300));
      return null;
    }
  } catch(e) {
    console.error('[NEXUS] AI call failed:', e.message);
    if (status && status.textContent !== undefined) status.textContent = 'AI Error: ' + e.message;
    return null;
  }
}

// ═══════════════════════════════════════════
// SAVE EXTRACTED (FIXED: real error logging,
// dedup from Supabase, schema-safe inserts)
// ═══════════════════════════════════════════
async function saveExtracted(r, s, silent) {
  if (!r || !r.nodes || !r.nodes.length) {
    if (!silent && s) s.textContent = 'No data extracted.';
    return 0;
  }

  let c = 0;
  let errors = 0;

  // Pull existing node names from Supabase for dedup (not just memory)
  let existingNames = new Set(NX.nodes.map(n => (n.name || '').toLowerCase()));
  try {
    const { data } = await NX.sb.from('nodes').select('name');
    if (data) data.forEach(n => existingNames.add((n.name || '').toLowerCase()));
  } catch(e) {
    console.warn('[NEXUS] Could not fetch existing names for dedup:', e.message);
  }

  for (const n of r.nodes) {
    const name = (n.name || '').trim();
    if (!name) continue;
    if (name.length < 2) continue;
    if (existingNames.has(name.toLowerCase())) {
      // Already exists — skip
      continue;
    }

    // Sanitize category
    const validCats = ['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
    const category = validCats.includes(n.category) ? n.category : 'equipment';

    // Sanitize tags — ensure array of strings
    let tags = [];
    if (Array.isArray(n.tags)) {
      tags = n.tags.filter(t => typeof t === 'string').slice(0, 20);
    }

    const row = {
      name: name.slice(0, 200),
      category: category,
      tags: tags,
      notes: (n.notes || '').slice(0, 2000),
      links: [],
      access_count: 1
    };

    const { error } = await NX.sb.from('nodes').insert(row);
    if (error) {
      errors++;
      console.error(`[NEXUS] INSERT FAILED for "${name}":`, error.message, error.details || '', error.hint || '');
      // On first error, log the full row so you can see what's wrong
      if (errors === 1) console.error('[NEXUS] Full row that failed:', JSON.stringify(row));
    } else {
      existingNames.add(name.toLowerCase());
      c++;
    }
  }

  // Cards
  if (r.cards && r.cards.length) {
    for (const x of r.cards) {
      if (!x.title) continue;
      const { error } = await NX.sb.from('kanban_cards').insert({
        title: (x.title || '').slice(0, 200),
        column_name: x.column_name || 'todo'
      });
      if (error) console.error(`[NEXUS] Card insert failed for "${x.title}":`, error.message);
    }
  }

  if (errors > 0) {
    console.error(`[NEXUS] ${errors} node inserts failed. Check Supabase table schema.`);
    console.log('[NEXUS] Expected columns: name (text), category (text), tags (jsonb or text[]), notes (text), links (jsonb or int[]), access_count (int)');
  }

  if (!silent && s) s.textContent = `${c} nodes created.${errors ? ' ' + errors + ' failed — check console.' : ''}`;
  if (!silent) {
    await NX.loadNodes();
    if (NX.brain) NX.brain.init();
    updateStats();
  }
  return c;
}

// ═══════════════════════════════════════════
// PASTE TEXT INGEST
// ═══════════════════════════════════════════
async function ingestText() {
  const text = document.getElementById('ingestText').value.trim();
  if (!text) return;
  const btn = document.getElementById('ingestTextBtn');
  const status = document.getElementById('ingestStatus');
  btn.disabled = true; btn.textContent = '...';
  status.textContent = 'Sending to AI...';
  const r = await aiProcess(text, status);
  await saveExtracted(r, status, false);
  btn.disabled = false; btn.textContent = '⚡ Process';
  document.getElementById('ingestText').value = '';
}

// ═══════════════════════════════════════════
// TRELLO IMPORT
// ═══════════════════════════════════════════
async function trelloImport() {
  const trelloKey = NX.getTrelloKey();
  const trelloToken = NX.getTrelloToken();
  if (!trelloKey || !trelloToken) {
    document.getElementById('ingestStatus').textContent = 'No Trello keys set. Open Admin (⚙) to add them.';
    return;
  }
  const btn = document.getElementById('trelloBtn');
  const status = document.getElementById('ingestStatus');
  btn.disabled = true; btn.textContent = 'Pulling...';
  status.textContent = 'Fetching Trello boards...';
  try {
    const resp = await fetch(`https://api.trello.com/1/members/me/boards?key=${trelloKey}&token=${trelloToken}`);
    if (!resp.ok) throw new Error(`Trello API: ${resp.status} ${resp.statusText}`);
    const boards = await resp.json();
    let all = 'TRELLO BOARDS:\n';
    for (const board of boards) {
      all += `\n== ${board.name} ==\n`;
      const cr = await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${trelloKey}&token=${trelloToken}`);
      const cards = await cr.json();
      if (!Array.isArray(cards)) { console.warn('[NEXUS] Trello cards not array for board:', board.name); continue; }
      cards.slice(0, 100).forEach(c => {
        all += `- [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,200):''}${c.due?' | Due:'+c.due.split('T')[0]:''}\n`;
      });
    }
    console.log('[NEXUS] Trello text length:', all.length);
    status.textContent = 'AI processing Trello data...';
    const r = await aiProcess(all, status);
    await saveExtracted(r, status, false);
  } catch(e) {
    console.error('[NEXUS] Trello import error:', e);
    status.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false; btn.textContent = '🔄 Smart Trello Import';
}

// ═══════════════════════════════════════════
// NODE STATS
// ═══════════════════════════════════════════
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
