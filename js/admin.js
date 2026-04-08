/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest Module (admin.js)
   Gmail email sync, batch AI node extraction,
   Trello import, paste ingest.
   All keys from localStorage.
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

  // Load Google Identity Services
  loadGoogleAuth();

  // Check if we have a stored gmail token
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
// GOOGLE IDENTITY SERVICES (OAuth)
// ═══════════════════════════════════════════
function loadGoogleAuth() {
  const clientId = NX.getGoogleClientId();
  if (!clientId) return;

  // Load GIS script if not already loaded
  if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => { initTokenClient(); };
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
        // Store with 55-min expiry
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

  if (!gisLoaded) {
    loadGoogleAuth();
    setTimeout(connectGmail, 1000);
    return;
  }

  if (tokenClient) {
    tokenClient.requestAccessToken();
  }
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

  // Build Gmail search query
  let query = '';
  if (daysVal !== 'all') {
    const after = new Date();
    after.setDate(after.getDate() - parseInt(daysVal));
    query = `after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
  }
  if (filter) query += (query ? ' ' : '') + filter;

  try {
    // 1. Fetch message IDs
    let messageIds = [];
    let nextPageToken = null;
    status.textContent = 'Fetching email list...';

    do {
      const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('maxResults', '100');
      if (query) url.searchParams.set('q', query);
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${gmailToken}` }
      });

      if (resp.status === 401) {
        // Token expired
        localStorage.removeItem('nexus_gmail_token');
        gmailToken = null;
        status.textContent = 'Token expired. Click Connect Gmail again.';
        btn.disabled = false;
        btn.textContent = '⚡ Sync Emails → Brain';
        progressBar.style.display = 'none';
        return;
      }

      const data = await resp.json();
      if (data.messages) messageIds.push(...data.messages.map(m => m.id));
      nextPageToken = data.nextPageToken;
    } while (nextPageToken && messageIds.length < 500); // Cap at 500

    if (!messageIds.length) {
      status.textContent = 'No emails found matching your criteria.';
      btn.disabled = false;
      btn.textContent = '⚡ Sync Emails → Brain';
      progressBar.style.display = 'none';
      return;
    }

    status.textContent = `Found ${messageIds.length} emails. Pulling content...`;

    // 2. Fetch email content in batches of 10
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
        const from = getH('From');
        const to = getH('To');
        const subject = getH('Subject');
        const date = getH('Date');
        const snippet = msg.snippet || '';

        allEmailText.push(`FROM: ${from}\nTO: ${to}\nDATE: ${date}\nSUBJECT: ${subject}\n${snippet}`);
      });

      // Brief pause to avoid rate limits
      if (i + BATCH < messageIds.length) await sleep(200);
    }

    status.textContent = `Pulled ${allEmailText.length} emails. AI processing in batches...`;

    // 3. Process through Claude in batches of 15 emails
    const AI_BATCH = 15;
    let totalNodes = 0;
    for (let i = 0; i < allEmailText.length; i += AI_BATCH) {
      const chunk = allEmailText.slice(i, i + AI_BATCH).join('\n\n---EMAIL---\n\n');
      const pct = 40 + Math.round((i / allEmailText.length) * 55);
      progressFill.style.width = pct + '%';
      progressText.textContent = `AI processing: batch ${Math.floor(i/AI_BATCH)+1}/${Math.ceil(allEmailText.length/AI_BATCH)}`;

      const result = await aiProcess(chunk, { textContent: '' });
      if (result) {
        const saved = await saveExtracted(result, { textContent: '' }, true);
        totalNodes += saved;
      }

      if (i + AI_BATCH < allEmailText.length) await sleep(500);
    }

    progressFill.style.width = '100%';
    progressText.textContent = `Done!`;
    status.textContent = `Email sync complete. ${totalNodes} new nodes extracted from ${allEmailText.length} emails.`;

    // Reload nodes into the brain
    await NX.loadNodes();
    if (NX.brain) NX.brain.init();
    updateStats();

  } catch(e) {
    console.error('Email sync error:', e);
    status.textContent = 'Error: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = '⚡ Sync Emails → Brain';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
// AI PROCESSING (shared)
// ═══════════════════════════════════════════
async function aiProcess(text, status){
  try {
    const answer = await NX.askClaude(
      `You are a knowledge extraction engine for a restaurant operations system managing Suerte, Este, and Bar Toti in Austin TX.

Extract EVERY piece of useful knowledge from the text. Be aggressive — capture:
- Contractor/vendor names, phone numbers, emails, specialties
- Equipment mentioned (brand, model, status, issues)
- Procedures, protocols, troubleshooting steps
- Projects planned or in progress
- Staff names and roles
- Pricing, invoices, order numbers
- Scheduling info, deadlines, service dates
- Location-specific details (Suerte, Este, Toti)

Return ONLY JSON:
{
  "nodes": [
    {"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"...", "links_to":["name of related node if any"]}
  ],
  "cards": [
    {"title":"...","column_name":"todo"}
  ]
}

Create a separate node for EACH distinct entity. More nodes = better. Include contact info in notes. If an email mentions a contractor visiting on a date, create both a contractor node AND a card.`,
      [{role:'user', content: text.slice(0, 14000)}],
      3000
    );
    const m = answer.match(/\{[\s\S]*"nodes"[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  } catch(e) {
    if (status) status.textContent = 'Error: ' + e.message;
    return null;
  }
}

async function saveExtracted(r, s, silent){
  if (!r) { if (!silent && s) s.textContent = 'No data extracted.'; return 0; }
  let c = 0;

  // Deduplicate against existing nodes
  const existingNames = new Set(NX.nodes.map(n => n.name.toLowerCase()));

  if (r.nodes) for (const n of r.nodes) {
    const name = (n.name || '').trim();
    if (!name || existingNames.has(name.toLowerCase())) continue;
    try {
      await NX.sb.from('nodes').insert({
        name: name,
        category: n.category || 'equipment',
        tags: n.tags || [],
        notes: n.notes || '',
        links: [],
        access_count: 1
      });
      existingNames.add(name.toLowerCase());
      c++;
    } catch(e) {}
  }

  if (r.cards) for (const x of r.cards) {
    try {
      await NX.sb.from('kanban_cards').insert({
        title: x.title,
        column_name: x.column_name || 'todo'
      });
    } catch(e) {}
  }

  if (!silent && s) s.textContent = `Done. ${c} nodes created.`;
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
async function ingestText(){
  const text = document.getElementById('ingestText').value.trim();
  if (!text) return;
  const btn = document.getElementById('ingestTextBtn');
  const status = document.getElementById('ingestStatus');
  btn.disabled = true; btn.textContent = '...';
  const r = await aiProcess(text, status);
  await saveExtracted(r, status, false);
  btn.disabled = false; btn.textContent = '⚡ Process';
  document.getElementById('ingestText').value = '';
}

// ═══════════════════════════════════════════
// TRELLO IMPORT
// ═══════════════════════════════════════════
async function trelloImport(){
  const trelloKey = NX.getTrelloKey();
  const trelloToken = NX.getTrelloToken();
  if (!trelloKey || !trelloToken) {
    document.getElementById('ingestStatus').textContent = 'No Trello keys set. Open Admin (⚙) to add them.';
    return;
  }
  const btn = document.getElementById('trelloBtn');
  const status = document.getElementById('ingestStatus');
  btn.disabled = true; btn.textContent = 'Pulling...';
  status.textContent = 'Fetching Trello...';
  try {
    const resp = await fetch(`https://api.trello.com/1/members/me/boards?key=${trelloKey}&token=${trelloToken}`);
    const boards = await resp.json();
    let all = 'TRELLO:\n';
    for (const board of boards) {
      all += `\n== ${board.name} ==\n`;
      const cr = await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${trelloKey}&token=${trelloToken}`);
      const cards = await cr.json();
      cards.slice(0, 50).forEach(c => {
        all += `- [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,120):''}${c.due?' | Due:'+c.due.split('T')[0]:''}\n`;
      });
    }
    status.textContent = 'AI processing...';
    const r = await aiProcess(all, status);
    await saveExtracted(r, status, false);
  } catch(e) { status.textContent = 'Error: ' + e.message; }
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
