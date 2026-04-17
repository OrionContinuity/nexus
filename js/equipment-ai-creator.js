/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Equipment AI Creator v1
   Three AI-powered ways to create equipment and link everything:
   1. Natural language description → structured equipment
   2. Photo of equipment → identified and added
   3. Photo of kitchen/room → bulk-identify multiple pieces
   
   Plus smart auto-linking to existing nodes (contractors, parts, locations)
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

if (!NX.modules || !NX.modules.equipment) {
  console.warn('[EquipAI-Creator] Base not loaded, retrying…');
  return setTimeout(arguments.callee, 500);
}

const EQ = NX.modules.equipment;

/* ═══════════════════════════════════════════════════════════════════════
   UNIFIED AI CREATE DIALOG — user picks their method
   ═══════════════════════════════════════════════════════════════════════ */

function openAICreator() {
  const modal = document.getElementById('eqAICreatorModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqAICreatorModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqAICreatorModal').classList.remove('active')">✕</button>
        <h2>✨ AI Create Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">
          Let AI handle the data entry. Pick your method:
        </div>

        <div class="eq-ai-methods">
          <button class="eq-ai-method" data-method="describe">
            <div class="eq-ai-method-icon">💬</div>
            <div class="eq-ai-method-title">Describe It</div>
            <div class="eq-ai-method-desc">Type or paste details in natural language. AI extracts everything and auto-links contractors, parts, locations.</div>
          </button>

          <button class="eq-ai-method" data-method="photo">
            <div class="eq-ai-method-icon">📸</div>
            <div class="eq-ai-method-title">Photo of Unit</div>
            <div class="eq-ai-method-desc">Take a picture of the equipment. AI identifies make/model from visible details.</div>
          </button>

          <button class="eq-ai-method" data-method="bulk">
            <div class="eq-ai-method-icon">🏢</div>
            <div class="eq-ai-method-title">Scan Whole Room</div>
            <div class="eq-ai-method-desc">Take a photo of your kitchen or bar. AI identifies every piece it sees and adds all of them at once.</div>
          </button>

          <button class="eq-ai-method" data-method="dataplate">
            <div class="eq-ai-method-icon">🔖</div>
            <div class="eq-ai-method-title">Scan Data Plate</div>
            <div class="eq-ai-method-desc">Photograph the metal/plastic data plate. AI extracts exact model/serial/specs.</div>
          </button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  modal.querySelectorAll('.eq-ai-method').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.dataset.method;
      modal.classList.remove('active');
      if (method === 'describe') openDescribeDialog();
      else if (method === 'photo') photoIdentify();
      else if (method === 'bulk') bulkIdentify();
      else if (method === 'dataplate') EQ.scanDataPlate && EQ.scanDataPlate(null);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   METHOD 1: DESCRIBE IT
   User types natural language, AI extracts + auto-links
   ═══════════════════════════════════════════════════════════════════════ */

function openDescribeDialog() {
  const modal = document.getElementById('eqDescribeModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqDescribeModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqDescribeModal').classList.remove('active')"></div>
    <div class="eq-detail eq-edit">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">✕</button>
        <h2>💬 Describe Equipment</h2>
      </div>
      <div class="eq-detail-body">
        <div class="eq-ai-intro">
          Describe the equipment in your own words. AI extracts everything, auto-links contractors and parts from your existing data.
        </div>

        <div class="eq-ai-examples">
          <div class="eq-ai-examples-title">Examples:</div>
          <div class="eq-ai-example" data-fill="Hoshizaki KM-320MAH ice machine at Suerte kitchen, installed March 2023, serial 240317001, Tyler from Austin Air & Ice services it quarterly">📝 Single equipment with contractor</div>
          <div class="eq-ai-example" data-fill="Walk-in cooler at Este, True Manufacturing T-49, bought 2022, warranty until 2027, uses condenser fan 800-5016 and evaporator coil 800-1402. Last serviced by Juan in January">📝 Equipment with parts and history</div>
          <div class="eq-ai-example" data-fill="Vulcan 6-burner range at Bar Toti, gas, natural gas hookup, bought used in 2021. Has pilot issues every few months">📝 Minimal info with issues</div>
        </div>

        <div class="eq-form-group">
          <label>Description (as much or little as you want)</label>
          <textarea id="eqDescribeInput" rows="6" placeholder="e.g. Hoshizaki ice machine at Suerte, installed last year, Tyler services it..."></textarea>
        </div>

        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqDescribeModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqDescribeGo">✨ Create with AI</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Click examples to fill
  modal.querySelectorAll('.eq-ai-example').forEach(ex => {
    ex.addEventListener('click', () => {
      document.getElementById('eqDescribeInput').value = ex.dataset.fill;
      document.getElementById('eqDescribeInput').focus();
    });
  });

  document.getElementById('eqDescribeGo').addEventListener('click', async () => {
    const text = document.getElementById('eqDescribeInput').value.trim();
    if (!text) return;
    const btn = document.getElementById('eqDescribeGo');
    btn.disabled = true;
    btn.textContent = '✨ Thinking…';

    try {
      await createFromDescription(text);
      modal.classList.remove('active');
    } catch (err) {
      console.error('[AI-Create] Describe failed:', err);
      NX.toast && NX.toast('Creation failed: ' + err.message, 'error', 6000);
      btn.disabled = false;
      btn.textContent = '✨ Create with AI';
    }
  });
}

async function createFromDescription(text) {
  // Load existing context for linking
  const context = await loadExistingContext();

  const system = `You are creating equipment records for a restaurant management system.
Given a natural language description, extract structured data AND identify any references
to existing people, contractors, parts, or locations from this list:

EXISTING CONTRACTORS: ${context.contractors.map(c => c.name).join(', ') || 'none'}
EXISTING PEOPLE: ${context.people.map(p => p.name).join(', ') || 'none'}
EXISTING PARTS: ${context.parts.slice(0, 30).map(p => p.name).join(', ') || 'none'}
LOCATIONS: Suerte, Este, Bar Toti

Extract and return raw JSON (no markdown), can include multiple equipment if described:
{
  "equipment": [
    {
      "name": "descriptive name",
      "location": "Suerte" | "Este" | "Bar Toti",
      "area": "Kitchen" | "Bar" | "Dining" etc or null,
      "category": "refrigeration" | "cooking" | "ice" | "hvac" | "dish" | "bev" | "smallware" | "other",
      "manufacturer": "...",
      "model": "...",
      "serial_number": "...",
      "install_date": "YYYY-MM-DD" or null,
      "warranty_until": "YYYY-MM-DD" or null,
      "status": "operational" | "needs_service" | "down",
      "notes": "any other details like issues, quirks, etc",
      "linked_contractors": ["exact name from EXISTING CONTRACTORS list"],
      "linked_people": ["exact name from EXISTING PEOPLE list"],
      "linked_parts": ["exact name from EXISTING PARTS list"],
      "mentioned_parts_new": [
        {"name": "Condenser Fan", "oem_part_number": "800-5016"}
      ],
      "mentioned_issues": ["pilot issues", "runs warm"] // for creating a note/ticket
    }
  ],
  "interpretation_notes": "brief note about what you understood or assumed"
}

If a contractor or person is mentioned but not in the existing list, include their name in linked_contractors anyway — we'll auto-create them.
If the text mentions parts with part numbers, add them to mentioned_parts_new.
Infer reasonable defaults only when obvious (e.g. "walk-in cooler" = refrigeration/walk_in).
Return null for fields where info isn't provided. DON'T HALLUCINATE data.`;

  const answer = await NX.askClaude(system, [{ role: 'user', content: text }], 3000);

  const jsonStart = answer.indexOf('{');
  const jsonEnd = answer.lastIndexOf('}');
  if (jsonStart === -1) throw new Error('No JSON in AI response');
  const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

  if (!parsed.equipment || !parsed.equipment.length) {
    throw new Error('No equipment could be extracted');
  }

  // Show confirmation with all the AI's interpretations + links
  showCreationConfirmation(parsed, context);
}

/* ═══════════════════════════════════════════════════════════════════════
   METHOD 2: PHOTO OF SINGLE UNIT
   ═══════════════════════════════════════════════════════════════════════ */

async function photoIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    NX.toast && NX.toast('AI identifying equipment…', 'info', 10000);

    try {
      const base64 = await fileToBase64(file);

      const prompt = `You are looking at a photo of commercial restaurant/kitchen equipment.
Identify it as best you can. Return raw JSON (no markdown):

{
  "equipment": [{
    "name": "descriptive name — be specific about what you see",
    "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
    "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | etc",
    "manufacturer": "... (only if visible/identifiable from badges/design)" or null,
    "model": "... (only if readable)" or null,
    "approximate_size": "small | medium | large",
    "condition": "new | good | fair | needs_attention",
    "visible_details": ["any notable features you see"],
    "confidence": "high | medium | low",
    "notes": "what you observed"
  }],
  "scene_description": "brief description of what's in the photo"
}

If you can't identify it clearly, still return a best-guess entry with low confidence.
If there are multiple pieces visible, only return the most prominent one (for bulk use Scan Whole Room).`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);

      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      // Upload photo
      const photoUrl = await uploadPhoto(file, parsed.equipment[0]);
      if (photoUrl) parsed.equipment[0].photo_url = photoUrl;

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'photo');
    } catch (err) {
      console.error('[AI-Create] Photo failed:', err);
      NX.toast && NX.toast('Identification failed: ' + err.message, 'error', 6000);
    }
  });

  input.click();
}

/* ═══════════════════════════════════════════════════════════════════════
   METHOD 3: BULK — PHOTO OF WHOLE ROOM
   ═══════════════════════════════════════════════════════════════════════ */

async function bulkIdentify() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    // Ask which location this is for
    const location = await askLocation();
    if (!location) return;

    NX.toast && NX.toast('AI scanning the room…', 'info', 15000);

    try {
      const base64 = await fileToBase64(file);

      const prompt = `You are looking at a wide-angle photo of a commercial restaurant space (${location}).
Identify EVERY piece of equipment visible in the photo.

Return raw JSON (no markdown):
{
  "equipment": [
    {
      "name": "descriptive name",
      "category": "refrigeration | cooking | ice | hvac | dish | bev | smallware | other",
      "subcategory": "walk_in | reach_in | fryer | combi | range | hood | ice_machine | prep_table | etc",
      "manufacturer": "..." or null (only if visible),
      "model": "..." or null (only if readable),
      "approximate_size": "small | medium | large",
      "location_in_frame": "left | center | right | back | foreground",
      "condition": "new | good | fair | needs_attention",
      "confidence": "high | medium | low",
      "notes": "what you see"
    }
  ],
  "scene_description": "brief description"
}

List EVERY distinct piece of equipment. Even small items like microwaves, coffee makers, prep tables.
Skip: utensils, small hand tools, food, decor items.
Each equipment piece should be a separate entry.`;

      const answer = await NX.askClaudeVision(prompt, base64, file.type);

      const jsonStart = answer.indexOf('{');
      const jsonEnd = answer.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(answer.slice(jsonStart, jsonEnd + 1));

      // Set location on all items
      parsed.equipment.forEach(eq => eq.location = location);

      // Upload the photo once
      const photoUrl = await uploadPhoto(file, { name: 'bulk-scan' });
      // Attach scene photo to all (they can edit later)
      parsed.equipment.forEach(eq => eq.photo_url = photoUrl);

      const context = await loadExistingContext();
      showCreationConfirmation(parsed, context, 'bulk');
    } catch (err) {
      console.error('[AI-Create] Bulk failed:', err);
      NX.toast && NX.toast('Scan failed: ' + err.message, 'error', 6000);
    }
  });

  input.click();
}

function askLocation() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'eq-modal active';
    modal.innerHTML = `
      <div class="eq-detail-bg"></div>
      <div class="eq-detail eq-edit">
        <div class="eq-detail-head"><h2>Which location?</h2></div>
        <div class="eq-detail-body">
          <div class="eq-loc-picker">
            <button class="eq-loc-btn" data-loc="Suerte">🌴 Suerte</button>
            <button class="eq-loc-btn" data-loc="Este">🐟 Este</button>
            <button class="eq-loc-btn" data-loc="Bar Toti">🥃 Bar Toti</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('.eq-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        resolve(btn.dataset.loc);
        modal.remove();
      });
    });
    modal.querySelector('.eq-detail-bg').addEventListener('click', () => {
      resolve(null);
      modal.remove();
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   CONFIRMATION UI — review AI suggestions before committing
   ═══════════════════════════════════════════════════════════════════════ */

function showCreationConfirmation(parsed, context, source = 'describe') {
  const modal = document.getElementById('eqConfirmModal') || (() => {
    const m = document.createElement('div');
    m.id = 'eqConfirmModal';
    m.className = 'eq-modal';
    document.body.appendChild(m);
    return m;
  })();

  const equipList = parsed.equipment || [];
  const multi = equipList.length > 1;

  modal.innerHTML = `
    <div class="eq-detail-bg" onclick="document.getElementById('eqConfirmModal').classList.remove('active')"></div>
    <div class="eq-detail">
      <div class="eq-detail-head">
        <button class="eq-close" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">✕</button>
        <h2>✨ AI Found ${equipList.length} ${multi ? 'Pieces' : 'Piece'}</h2>
      </div>
      <div class="eq-detail-body">
        ${parsed.interpretation_notes || parsed.scene_description ? `
          <div class="eq-ai-interp">
            <b>AI's interpretation:</b> ${esc(parsed.interpretation_notes || parsed.scene_description)}
          </div>
        ` : ''}

        ${multi ? `
          <div class="eq-ai-bulk-actions">
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = true)">Select All</button>
            <button class="eq-btn eq-btn-tiny" onclick="document.querySelectorAll('[data-eq-confirm]').forEach(c => c.checked = false)">Deselect All</button>
          </div>
        ` : ''}

        <div class="eq-confirm-list">
          ${equipList.map((eq, i) => `
            <div class="eq-confirm-card">
              <label class="eq-confirm-head">
                <input type="checkbox" checked data-eq-confirm="${i}">
                <div class="eq-confirm-icon">${catIcon(eq.category)}</div>
                <div class="eq-confirm-title">
                  <div class="eq-confirm-name" contenteditable="true" data-eq-field="name" data-idx="${i}">${esc(eq.name || 'Unnamed')}</div>
                  <div class="eq-confirm-sub">
                    ${esc(eq.manufacturer || '')} ${esc(eq.model || '')}
                    ${eq.confidence ? `<span class="eq-conf eq-conf-${eq.confidence}">${eq.confidence}</span>` : ''}
                  </div>
                </div>
              </label>

              <div class="eq-confirm-details">
                <div class="eq-confirm-field">
                  <label>Location</label>
                  <select data-eq-field="location" data-idx="${i}">
                    <option ${eq.location==='Suerte'?'selected':''}>Suerte</option>
                    <option ${eq.location==='Este'?'selected':''}>Este</option>
                    <option ${eq.location==='Bar Toti'?'selected':''}>Bar Toti</option>
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Area</label>
                  <input data-eq-field="area" data-idx="${i}" value="${esc(eq.area || '')}">
                </div>
                <div class="eq-confirm-field">
                  <label>Category</label>
                  <select data-eq-field="category" data-idx="${i}">
                    ${['refrigeration','cooking','ice','hvac','dish','bev','smallware','other'].map(c =>
                      `<option value="${c}" ${eq.category===c?'selected':''}>${c}</option>`).join('')}
                  </select>
                </div>
                <div class="eq-confirm-field">
                  <label>Status</label>
                  <select data-eq-field="status" data-idx="${i}">
                    <option value="operational" ${eq.status==='operational'?'selected':''}>Operational</option>
                    <option value="needs_service" ${eq.status==='needs_service'?'selected':''}>Needs Service</option>
                    <option value="down" ${eq.status==='down'?'selected':''}>Down</option>
                  </select>
                </div>
              </div>

              ${eq.linked_contractors?.length || eq.linked_people?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">🔗 Will link to:</div>
                  ${(eq.linked_contractors || []).map(name => {
                    const existing = context.contractors.find(c => c.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? '✓' : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                  ${(eq.linked_people || []).map(name => {
                    const existing = context.people.find(p => p.name.toLowerCase() === name.toLowerCase());
                    return `<span class="eq-link-chip ${existing?'eq-link-existing':'eq-link-new'}">
                      ${existing ? '✓' : '+'} ${esc(name)} ${existing ? '' : '(new)'}
                    </span>`;
                  }).join('')}
                </div>
              ` : ''}

              ${eq.linked_parts?.length || eq.mentioned_parts_new?.length ? `
                <div class="eq-confirm-links">
                  <div class="eq-confirm-links-label">🔧 Parts:</div>
                  ${(eq.linked_parts || []).map(name => `
                    <span class="eq-link-chip eq-link-existing">✓ ${esc(name)}</span>
                  `).join('')}
                  ${(eq.mentioned_parts_new || []).map(p => `
                    <span class="eq-link-chip eq-link-new">+ ${esc(p.name)} ${p.oem_part_number ? '('+esc(p.oem_part_number)+')' : ''}</span>
                  `).join('')}
                </div>
              ` : ''}

              ${eq.notes ? `
                <div class="eq-confirm-notes">📝 ${esc(eq.notes)}</div>
              ` : ''}

              ${eq.mentioned_issues?.length ? `
                <div class="eq-confirm-issues">
                  ⚠ Issues mentioned — ticket will be created:
                  ${eq.mentioned_issues.map(i => `<div class="eq-issue">${esc(i)}</div>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>

        <div class="eq-form-actions">
          <button class="eq-btn eq-btn-secondary" onclick="document.getElementById('eqConfirmModal').classList.remove('active')">Cancel</button>
          <button class="eq-btn eq-btn-primary" id="eqConfirmCommit">✅ Create ${multi ? 'Selected' : ''}</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');

  // Store the parsed data on the modal for commit handler
  modal._parsed = parsed;
  modal._context = context;

  document.getElementById('eqConfirmCommit').addEventListener('click', async () => {
    const btn = document.getElementById('eqConfirmCommit');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      // Gather any edits from the UI
      modal.querySelectorAll('[data-eq-field]').forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        const val = el.tagName === 'DIV' ? el.textContent.trim() : el.value;
        if (parsed.equipment[idx]) parsed.equipment[idx][field] = val;
      });

      // Filter to only checked items
      const checked = [];
      modal.querySelectorAll('[data-eq-confirm]').forEach(c => {
        if (c.checked) checked.push(parsed.equipment[parseInt(c.dataset.eqConfirm)]);
      });

      if (!checked.length) {
        NX.toast && NX.toast('Nothing selected', 'info');
        btn.disabled = false;
        btn.textContent = '✅ Create';
        return;
      }

      await commitEquipment(checked, context);
      modal.classList.remove('active');
      NX.toast && NX.toast(`✓ Created ${checked.length} equipment ${checked.length > 1 ? 'pieces' : 'piece'}`, 'success', 5000);

      // Reload and show
      if (EQ.loadEquipment) await EQ.loadEquipment();
      if (EQ.show) EQ.show();
    } catch (err) {
      console.error('[AI-Create] Commit failed:', err);
      NX.toast && NX.toast('Create failed: ' + err.message, 'error', 8000);
      btn.disabled = false;
      btn.textContent = '✅ Create';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   COMMIT — actually create equipment + link nodes + create tickets
   ═══════════════════════════════════════════════════════════════════════ */

async function commitEquipment(equipList, context) {
  for (const eq of equipList) {
    // Clean the object — only pass fields that exist in the schema
    const allowed = ['name','location','area','category','subcategory','manufacturer','model',
                     'serial_number','status','install_date','warranty_until','purchase_price',
                     'specs','photo_url','notes','pm_interval_days','next_pm_date'];
    const clean = {};
    for (const f of allowed) {
      if (eq[f] != null && eq[f] !== '') clean[f] = eq[f];
    }

    // Build notes from extras
    let notes = eq.notes || '';
    if (eq.visible_details?.length) notes += (notes ? '\n' : '') + 'Observed: ' + eq.visible_details.join(', ');
    if (eq.confidence && eq.confidence !== 'high') notes += (notes ? '\n' : '') + `[AI confidence: ${eq.confidence}]`;
    if (notes) clean.notes = notes;

    // Insert equipment
    const { data: created, error } = await NX.sb.from('equipment').insert(clean).select().single();
    if (error) {
      console.error('Equipment insert error:', error);
      continue;
    }

    // Create equipment node in graph
    try {
      const { data: eqNode } = await NX.sb.from('nodes').insert({
        name: clean.name,
        category: 'equipment',
        tags: [clean.location, clean.category, clean.manufacturer].filter(Boolean),
        notes: `${clean.manufacturer || ''} ${clean.model || ''}${clean.serial_number ? '\nSN: ' + clean.serial_number : ''}`.trim(),
        links: [], access_count: 1, source_emails: []
      }).select().single();

      if (eqNode) {
        await NX.sb.from('equipment').update({ node_id: eqNode.id }).eq('id', created.id);

        // Link contractors (existing + new)
        for (const name of (eq.linked_contractors || [])) {
          await linkOrCreateNode(name, 'contractors', eqNode.id);
        }
        for (const name of (eq.linked_people || [])) {
          await linkOrCreateNode(name, 'people', eqNode.id);
        }

        // Link existing parts
        for (const name of (eq.linked_parts || [])) {
          const partNode = context.parts.find(p => p.name.toLowerCase() === name.toLowerCase());
          if (partNode) await linkNodes(eqNode.id, partNode.id);
        }
      }
    } catch(e) { console.warn('Graph link error:', e); }

    // Create equipment_parts entries for new parts
    if (eq.mentioned_parts_new?.length) {
      const partsData = eq.mentioned_parts_new.map(p => ({
        equipment_id: created.id,
        part_name: p.name,
        oem_part_number: p.oem_part_number || null,
        supplier: 'Parts Town',
        supplier_url: `https://www.partstown.com/search?searchterm=${encodeURIComponent(p.oem_part_number || p.name)}`
      }));
      await NX.sb.from('equipment_parts').insert(partsData);
    }

    // Create tickets for mentioned issues
    if (eq.mentioned_issues?.length) {
      for (const issue of eq.mentioned_issues) {
        await NX.sb.from('tickets').insert({
          title: `[${clean.name}] ${issue}`,
          notes: `Issue mentioned during AI equipment creation:\n${issue}\n\nEquipment: ${clean.name}`,
          priority: 'normal',
          location: clean.location,
          status: 'open',
          reported_by: 'AI Create'
        });
      }
    }

    // Syslog
    if (NX.syslog) NX.syslog('equipment_created_ai', clean.name);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   AUTO-LINKING HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

async function linkOrCreateNode(name, category, equipNodeId) {
  // Check if already exists (case insensitive)
  const { data: existing } = await NX.sb.from('nodes')
    .select('id')
    .ilike('name', name)
    .eq('category', category)
    .limit(1);

  let nodeId;
  if (existing?.length) {
    nodeId = existing[0].id;
  } else {
    // Create new
    const { data: newNode } = await NX.sb.from('nodes').insert({
      name,
      category,
      tags: ['auto-created-by-ai'],
      notes: `Auto-created from equipment AI`,
      links: [], access_count: 1, source_emails: []
    }).select().single();
    if (newNode) nodeId = newNode.id;
  }

  if (nodeId && equipNodeId) {
    await linkNodes(equipNodeId, nodeId);
  }
}

async function linkNodes(a, b) {
  // Add b to a.links and vice versa
  try {
    const [{ data: nodeA }, { data: nodeB }] = await Promise.all([
      NX.sb.from('nodes').select('links').eq('id', a).single(),
      NX.sb.from('nodes').select('links').eq('id', b).single()
    ]);

    const aLinks = Array.isArray(nodeA?.links) ? nodeA.links : [];
    const bLinks = Array.isArray(nodeB?.links) ? nodeB.links : [];

    if (!aLinks.includes(b)) aLinks.push(b);
    if (!bLinks.includes(a)) bLinks.push(a);

    await Promise.all([
      NX.sb.from('nodes').update({ links: aLinks }).eq('id', a),
      NX.sb.from('nodes').update({ links: bLinks }).eq('id', b)
    ]);
  } catch(e) { console.warn('Link nodes error:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   CONTEXT LOADING
   ═══════════════════════════════════════════════════════════════════════ */

async function loadExistingContext() {
  const [contractors, people, parts] = await Promise.all([
    NX.sb.from('nodes').select('id, name').eq('category', 'contractors').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'people').limit(100),
    NX.sb.from('nodes').select('id, name').eq('category', 'parts').limit(200)
  ]);
  return {
    contractors: contractors.data || [],
    people: people.data || [],
    parts: parts.data || []
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */

async function uploadPhoto(file, eq) {
  try {
    const fname = `${Date.now()}-${(eq.name || 'equip').slice(0, 20).replace(/[^a-z0-9]/gi, '_')}.${(file.type.split('/')[1] || 'jpg')}`;
    const { data } = await NX.sb.storage.from('equipment-photos').upload(fname, file, { upsert: false, contentType: file.type });
    if (data) {
      const { data: { publicUrl } } = NX.sb.storage.from('equipment-photos').getPublicUrl(fname);
      return publicUrl;
    }
  } catch(e) { console.warn('Photo upload:', e); }
  return null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function catIcon(c) {
  const icons = { refrigeration:'❄', cooking:'🔥', ice:'🧊', hvac:'💨', dish:'🧼', bev:'🥤', smallware:'🍴', furniture:'🪑', other:'⚙' };
  return icons[c] || '⚙';
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT + INJECT INTO UI
   ═══════════════════════════════════════════════════════════════════════ */

Object.assign(NX.modules.equipment, {
  openAICreator,
  openDescribeDialog,
  photoIdentify,
  bulkIdentify,
  createFromDescription
});

// Inject "✨ AI Create" button into the header as the PRIMARY action
function injectAIButton() {
  const actions = document.querySelector('.eq-actions');
  if (!actions || actions.querySelector('.eq-ai-create-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'eq-btn eq-btn-primary eq-ai-create-btn';
  btn.innerHTML = '✨ AI Create';
  btn.title = 'Let AI create equipment from description, photo, or room scan';
  btn.addEventListener('click', openAICreator);

  // Replace the old + Add Equipment or put before it
  const addBtn = actions.querySelector('#eqAddBtn');
  if (addBtn) {
    actions.insertBefore(btn, addBtn);
    addBtn.className = 'eq-btn eq-btn-secondary';
    addBtn.innerHTML = '+ Manual';
    addBtn.title = 'Manually add equipment without AI';
  } else {
    actions.appendChild(btn);
  }
}

setTimeout(injectAIButton, 300);
setTimeout(injectAIButton, 1500);
setTimeout(injectAIButton, 3000);

// Also watch for UI rebuilds
const _origBuildUI = EQ.buildUI;
if (_origBuildUI) {
  EQ.buildUI = function() {
    _origBuildUI.apply(this, arguments);
    setTimeout(injectAIButton, 100);
  };
}

console.log('[EquipAI-Creator] Loaded');

})();
