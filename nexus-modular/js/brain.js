/* ═══════════════════════════════════════════
   NEXUS — Brain + AI Module (brain.js)
   Force-directed graph, merged AI chat,
   synapse activation, pan/zoom, voice.
   ═══════════════════════════════════════════ */

(function () {
  const canvas = document.getElementById('brainCanvas');
  const ctx = canvas.getContext('2d');

  // ─── State ───
  let W, H, animId, time = 0;
  let particles = []; // {id, x, y, vx, vy, cat, node, radius}
  let transform = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = { x: 0, y: 0 }, dragTransStart = { x: 0, y: 0 };
  let hoverNode = null;
  let activeNode = null;
  let activatedNodes = new Set();
  let searchHits = new Set();
  let chatHistory = [];
  let voiceOn = false;
  let recognition = null;
  let listViewOpen = false;

  // ─── Physics Constants ───
  const REPULSION = 800;
  const ATTRACTION = 0.003;
  const LINK_STRENGTH = 0.008;
  const CENTER_PULL = 0.0004;
  const DAMPING = 0.92;
  const BASE_RADIUS = 12;
  const ACTIVE_RADIUS = 24;

  // ─── Persona ───
  const PERSONA = `You are NEXUS, the AI operations brain for Alfredo Ortiz who manages Suerte, Este, and Bar Toti in Austin TX. You ARE Alfredo in digital form.

PERSONALITY: Sharp, concise, warm — the best shift manager with a killer sense of humor. Dry wit, never forced.
- When asked something obvious: "Really? ...fine, here you go."
- When you don't know: "I've searched every node and come up empty. Either it hasn't been logged, or it's one of life's great mysteries."
- Occasionally: "Figure it out yourself... jk. Here's what I got:"
- About cleaning: "Ah, everyone's favorite topic."
- After a solid answer, sometimes: "Need more? I've got nodes and zero plans tonight."

Be helpful FIRST, funny second. Respond in whatever language asked (EN/ES). Be CONCISE.`;

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════
  function init() {
    resize();
    buildParticles();
    setupChat();
    setupSearch();
    setupCanvas();
    setupVoice();
    setupListView();
    draw();
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width * 2; H = r.height * 2;
    canvas.width = W; canvas.height = H;
  }

  window.addEventListener('resize', () => {
    if (document.getElementById('brainView').classList.contains('active')) {
      resize();
    }
  });

  // ═══════════════════════════════════════════
  // FORCE-DIRECTED GRAPH
  // ═══════════════════════════════════════════
  function buildParticles() {
    const nodes = NX.nodes.filter(n => !n.is_private);
    const cx = W / 2, cy = H / 2;

    particles = nodes.map((node, i) => {
      // Initial position: spread by category
      const angle = (i / nodes.length) * Math.PI * 2;
      const dist = 150 + Math.random() * 250;
      return {
        id: node.id,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        node: node,
        cat: node.category,
        tags: node.tags || [],
        links: node.links || [],
        access: node.access_count || 1,
        radius: BASE_RADIUS
      };
    });
  }

  function physics() {
    const len = particles.length;
    const cx = W / 2, cy = H / 2;
    const isHovering = hoverNode !== null;

    for (let i = 0; i < len; i++) {
      const a = particles[i];
      // Slow down if hovered
      if (isHovering && Math.hypot(a.x - hoverNode.x, a.y - hoverNode.y) < 120) {
        a.vx *= 0.1; a.vy *= 0.1;
        continue;
      }

      // Repulsion between all nodes
      for (let j = i + 1; j < len; j++) {
        const b = particles[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 500) continue; // Skip far nodes
        let force = REPULSION / (dist * dist);
        let fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Attraction: same category nodes attract
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        const b = particles[j];
        if (a.cat !== b.cat) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        a.vx += (dx / dist) * ATTRACTION * dist;
        a.vy += (dy / dist) * ATTRACTION * dist;
      }

      // Shared tags attract more strongly
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        const b = particles[j];
        const shared = a.tags.filter(t => b.tags.includes(t)).length;
        if (shared === 0) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const strength = ATTRACTION * shared * 1.5;
        a.vx += (dx / dist) * strength * dist;
        a.vy += (dy / dist) * strength * dist;
      }

      // Link attraction
      a.links.forEach(lid => {
        const b = particles.find(p => p.id === lid);
        if (!b) return;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        a.vx += dx * LINK_STRENGTH;
        a.vy += dy * LINK_STRENGTH;
      });

      // Usage-based center pull (frequent nodes pull to center)
      const pullStrength = CENTER_PULL * (1 + Math.log(a.access + 1) * 0.3);
      a.vx += (cx - a.x) * pullStrength;
      a.vy += (cy - a.y) * pullStrength;

      // Damping
      a.vx *= DAMPING;
      a.vy *= DAMPING;

      // Apply
      a.x += a.vx;
      a.y += a.vy;

      // Boundary soft bounce
      const margin = 60;
      if (a.x < margin) a.vx += 2;
      if (a.x > W - margin) a.vx -= 2;
      if (a.y < margin) a.vy += 2;
      if (a.y > H - margin) a.vy -= 2;
    }
  }

  // ═══════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════
  function draw() {
    time += 0.008;
    physics();
    ctx.save();
    ctx.fillStyle = '#121214';
    ctx.fillRect(0, 0, W, H);

    // Apply pan/zoom
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    const cx = W / 2, cy = H / 2;
    const isActivation = activatedNodes.size > 0;
    const scale = transform.scale;

    // ─── Connection lines ───
    particles.forEach(a => {
      a.links.forEach(lid => {
        const b = particles.find(p => p.id === lid);
        if (!b) return;

        const hot = (activatedNodes.has(a.id) && activatedNodes.has(b.id)) ||
                    (searchHits.has(a.id) && searchHits.has(b.id));
        const dimmed = isActivation && !hot;

        // Curved connection
        const mx = (a.x + b.x) / 2 + Math.sin(time * 0.5 + a.id) * 8;
        const my = (a.y + b.y) / 2 + Math.cos(time * 0.4 + b.id) * 8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.strokeStyle = hot ? 'rgba(201,168,124,0.5)' :
                          dimmed ? 'rgba(201,168,124,0.01)' :
                          'rgba(201,168,124,0.06)';
        ctx.lineWidth = hot ? 3 : 1.5;
        ctx.stroke();

        // Traveling particles on hot connections
        if (hot) {
          for (let k = 0; k < 3; k++) {
            const pt = ((time * 0.5 + a.id * 0.1 + k * 0.33) % 1);
            const t2 = pt, t1 = 1 - t2;
            const px = t1 * t1 * a.x + 2 * t1 * t2 * mx + t2 * t2 * b.x;
            const py = t1 * t1 * a.y + 2 * t1 * t2 * my + t2 * t2 * b.y;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(201,168,124,${0.8 - pt * 0.6})`;
            ctx.fill();
          }
        }
      });
    });

    // ─── Center connections ───
    particles.forEach(a => {
      const hit = searchHits.has(a.id) || activatedNodes.has(a.id);
      const act = activeNode && activeNode.id === a.id;
      const dimmed = isActivation && !hit && !act;
      const alpha = hit ? 0.2 : act ? 0.25 : dimmed ? 0.008 : 0.025;

      const cpx = (cx + a.x) / 2 + Math.sin(time * 0.4 + a.id * 0.5) * 14;
      const cpy = (cy + a.y) / 2 + Math.cos(time * 0.3 + a.id * 0.7) * 11;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cpx, cpy, a.x, a.y);
      ctx.strokeStyle = `rgba(201,168,124,${alpha})`;
      ctx.lineWidth = hit || act ? 1.5 : 0.4;
      ctx.stroke();

      if (hit || act) {
        for (let k = 0; k < 2; k++) {
          const pt = ((time * 0.35 + a.id * 0.08 + k * 0.5) % 1);
          const t2 = pt, t1 = 1 - t2;
          ctx.beginPath();
          ctx.arc(t1*t1*cx + 2*t1*t2*cpx + t2*t2*a.x,
                  t1*t1*cy + 2*t1*t2*cpy + t2*t2*a.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(201,168,124,${0.7 - pt * 0.5})`;
          ctx.fill();
        }
      }
    });

    // ─── Center beacon ───
    const br = Math.sin(time * 1.1);
    const pr = 28 + br * 4;
    ctx.shadowBlur = 25;
    ctx.shadowColor = 'rgba(201,168,124,0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#151518';
    ctx.fill();
    ctx.strokeStyle = `rgba(201,168,124,${0.4 + br * 0.2})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = `rgba(201,168,124,${0.6 + br * 0.15})`;
    ctx.font = '600 14px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('NEXUS', cx, cy + 4);

    // ─── Nodes ───
    particles.forEach(a => {
      const hit = searchHits.has(a.id) || activatedNodes.has(a.id);
      const act = activeNode && activeNode.id === a.id;
      const dimmed = isActivation && !hit && !act;
      const pulse = Math.sin(time * 1.5 + a.id * 0.6);

      // LOD: viewport culling
      const sx = a.x * transform.scale + transform.x;
      const sy = a.y * transform.scale + transform.y;
      if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) return;

      const nr = act ? ACTIVE_RADIUS + pulse * 3 :
                 hit ? 18 + pulse * 2 :
                 dimmed ? 6 :
                 BASE_RADIUS + pulse * 1;

      // Neon glow
      ctx.shadowBlur = hit || act ? 20 : 8;
      ctx.shadowColor = hit || act ? 'rgba(201,168,124,0.8)' : 'rgba(201,168,124,0.15)';

      // Node circle
      ctx.beginPath();
      ctx.arc(a.x, a.y, nr, 0, Math.PI * 2);
      ctx.fillStyle = act ? `rgba(201,168,124,${0.9 + pulse * 0.05})` :
                      hit ? `rgba(201,168,124,${0.65 + pulse * 0.1})` :
                      dimmed ? 'rgba(201,168,124,0.05)' :
                      `rgba(201,168,124,${0.18 + pulse * 0.03})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(201,168,124,${act ? 0.6 : hit ? 0.4 : dimmed ? 0.02 : 0.08})`;
      ctx.lineWidth = act ? 2 : 1;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // LOD: only show labels if node is big enough on screen
      const screenRadius = nr * transform.scale;
      if (screenRadius < 4 && !hit && !act) return;

      // Text label with dark pill background
      const label = a.node.name.length > 26 ? a.node.name.slice(0, 24) + '…' : a.node.name;
      const la = act ? 0.95 : hit ? 0.85 : dimmed ? 0.05 : 0.35;

      ctx.font = `${act ? '600 ' : ''}13px "Libre Franklin"`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width;
      const tx = a.x, ty = a.y - nr - 8;

      // Dark pill behind text
      if (la > 0.1) {
        ctx.fillStyle = `rgba(0,0,0,${la * 0.6})`;
        const pillH = 16, pillW = tw + 12;
        ctx.beginPath();
        ctx.roundRect(tx - pillW / 2, ty - pillH / 2 - 1, pillW, pillH, 4);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(232,228,220,${la})`;
      ctx.fillText(label, tx, ty + 3, 220);
    });

    ctx.restore();
    animId = requestAnimationFrame(draw);
  }

  // ═══════════════════════════════════════════
  // CANVAS INTERACTION: Pan, Zoom, Click
  // ═══════════════════════════════════════════
  function setupCanvas() {
    // Click
    canvas.addEventListener('click', e => {
      if (dragging) return;
      const p = screenToWorld(e.clientX, e.clientY);
      let closest = null, cd = 40 / transform.scale;
      particles.forEach(a => {
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d < cd) { closest = a; cd = d; }
      });
      if (closest) openPanel(closest.node);
      else closePanel();
    });

    // Mouse move (hover detection)
    canvas.addEventListener('mousemove', e => {
      if (dragging) return;
      const p = screenToWorld(e.clientX, e.clientY);
      hoverNode = null;
      particles.forEach(a => {
        if (Math.hypot(p.x - a.x, p.y - a.y) < 30 / transform.scale) hoverNode = a;
      });
      canvas.style.cursor = hoverNode ? 'pointer' : 'crosshair';
    });

    // Pan: drag
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = false;
      dragStart = { x: e.clientX, y: e.clientY };
      dragTransStart = { x: transform.x, y: transform.y };
      const onMove = ev => {
        const dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) dragging = true;
        transform.x = dragTransStart.x + dx * 2;
        transform.y = dragTransStart.y + dy * 2;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setTimeout(() => dragging = false, 50);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Zoom: scroll
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(3, transform.scale * factor));
      // Zoom toward cursor
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * 2;
      const my = (e.clientY - rect.top) * 2;
      transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
      transform.y = my - (my - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;
    }, { passive: false });

    // Touch pan/zoom for mobile
    let lastTouchDist = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragTransStart = { x: transform.x, y: transform.y };
      }
      if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                    e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - dragStart.x;
        const dy = e.touches[0].clientY - dragStart.y;
        transform.x = dragTransStart.x + dx * 2;
        transform.y = dragTransStart.y + dy * 2;
      }
      if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                 e.touches[0].clientY - e.touches[1].clientY);
        const factor = dist / lastTouchDist;
        transform.scale = Math.max(0.3, Math.min(3, transform.scale * factor));
        lastTouchDist = dist;
      }
    }, { passive: true });
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const cx = (sx - rect.left) * 2;
    const cy = (sy - rect.top) * 2;
    return {
      x: (cx - transform.x) / transform.scale,
      y: (cy - transform.y) / transform.scale
    };
  }

  // ═══════════════════════════════════════════
  // NODE PANEL
  // ═══════════════════════════════════════════
  function openPanel(n) {
    activeNode = n;
    document.getElementById('npCat').textContent = n.category.toUpperCase();
    document.getElementById('npName').textContent = n.name;
    document.getElementById('npTags').textContent = (n.tags || []).map(t => '#' + t).join('  ');
    document.getElementById('npNotes').textContent = n.notes || '';
    const le = document.getElementById('npLinks');
    le.innerHTML = '';
    if (n.links && n.links.length) {
      le.innerHTML = '<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:3px">CONNECTED TO</div>';
      n.links.forEach(lid => {
        const ln = NX.nodes.find(x => x.id === lid);
        if (ln) {
          const d = document.createElement('div');
          d.textContent = '→ ' + ln.name;
          d.style.cssText = 'padding:2px 0;cursor:pointer;color:var(--accent);font-size:11px';
          d.onclick = () => openPanel(ln);
          le.appendChild(d);
        }
      });
    }
    document.getElementById('nodePanel').classList.add('open');
  }

  function closePanel() {
    activeNode = null;
    document.getElementById('nodePanel').classList.remove('open');
  }

  // ═══════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════
  function setupSearch() {
    const input = document.getElementById('brainSearch');
    const results = document.getElementById('searchResults');
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      searchHits = new Set();
      results.innerHTML = '';
      if (!q) { results.classList.remove('open'); return; }
      const m = NX.nodes.filter(n => !n.is_private &&
        (n.name.toLowerCase().includes(q) ||
         (n.tags || []).some(t => t.includes(q)) ||
         (n.notes || '').toLowerCase().includes(q)));
      m.forEach(n => searchHits.add(n.id));
      if (m.length) {
        results.classList.add('open');
        m.forEach(n => {
          const d = document.createElement('div');
          d.className = 'sr-item';
          d.innerHTML = `${n.name}<span>${n.category}</span>`;
          d.onclick = () => { openPanel(n); results.classList.remove('open'); };
          results.appendChild(d);
        });
      } else results.classList.remove('open');
    });
  }

  // ═══════════════════════════════════════════
  // LIST VIEW TOGGLE
  // ═══════════════════════════════════════════
  function setupListView() {
    document.getElementById('listToggle').addEventListener('click', () => {
      listViewOpen = !listViewOpen;
      const lv = document.getElementById('listView');
      const btn = document.getElementById('listToggle');
      if (listViewOpen) {
        btn.classList.add('on');
        lv.classList.add('open');
        lv.innerHTML = '';
        const q = document.getElementById('brainSearch').value.toLowerCase().trim();
        const filtered = NX.nodes.filter(n => !n.is_private && (!q ||
          n.name.toLowerCase().includes(q) || (n.tags||[]).some(t=>t.includes(q)) ||
          (n.notes||'').toLowerCase().includes(q)));
        filtered.forEach(n => {
          const el = document.createElement('div');
          el.className = 'list-node';
          el.innerHTML = `<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;
          el.onclick = () => { openPanel(n); listViewOpen = false; lv.classList.remove('open'); btn.classList.remove('on'); };
          lv.appendChild(el);
        });
      } else {
        btn.classList.remove('on');
        lv.classList.remove('open');
      }
    });
  }

  // ═══════════════════════════════════════════
  // AI CHAT (merged into brain view)
  // ═══════════════════════════════════════════
  function setupChat() {
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const dim = document.getElementById('brainDim');

    input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
    input.addEventListener('focus', () => dim.classList.add('active'));
    input.addEventListener('blur', () => {
      if (!input.value.trim()) dim.classList.remove('active');
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); }
    });
    send.addEventListener('click', askAI);

    // Example buttons
    document.querySelectorAll('.brain-ex').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        send.disabled = false;
        askAI();
      });
    });
  }

  // Smart context: local search → only relevant nodes
  function getSmartContext(question) {
    const q = question.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const scored = NX.nodes.map(n => {
      let score = 0;
      const text = (n.name + ' ' + n.category + ' ' + (n.tags || []).join(' ') + ' ' + (n.notes || '')).toLowerCase();
      words.forEach(w => { if (text.includes(w)) score += text.split(w).length - 1; });
      if (n.name.toLowerCase().includes(q)) score += 10;
      return { node: n, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    const relevant = scored.slice(0, 10).map(s => s.node);
    const index = NX.nodes.filter(n => !n.is_private).map(n => `${n.name} (${n.category})`).join(', ');
    const details = relevant.map(n => `[${n.category}] ${n.name}: ${n.notes}`).join('\n');

    // Activate synapses
    activatedNodes = new Set(relevant.map(n => n.id));
    setTimeout(() => { activatedNodes = new Set(); }, 10000);

    return `RELEVANT NODES:\n${details}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${index}`;
  }

  async function askAI() {
    const input = document.getElementById('chatInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    document.getElementById('chatSend').disabled = true;
    document.getElementById('brainWelcome').style.display = 'none';
    document.getElementById('brainExamples').style.display = 'none';
    document.getElementById('brainDim').classList.add('active');

    addBubble(q, 'user');
    chatHistory.push({ role: 'user', content: q });

    const thinkEl = addBubble(`Cross-referencing ${NX.nodes.length} brain nodes...`, 'ai thinking');
    const context = getSmartContext(q);

    const msgs = chatHistory.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    try {
      const answer = await NX.askClaude(PERSONA + '\n\n' + context, msgs, 600);
      thinkEl.textContent = answer || 'Something went sideways. Try again?';
      thinkEl.classList.remove('chat-thinking');
      chatHistory.push({ role: 'assistant', content: answer });
      if (voiceOn) speak(answer);
      try { NX.sb.from('chat_history').insert({ question: q, answer }); } catch (e) { }
    } catch (e) {
      thinkEl.textContent = 'Connection hiccup: ' + e.message;
      thinkEl.classList.remove('chat-thinking');
    }
  }

  function addBubble(text, type) {
    const el = document.createElement('div');
    el.className = 'chat-bubble chat-' + (type.includes('user') ? 'user' : 'ai');
    if (type.includes('thinking')) el.classList.add('chat-thinking');
    el.textContent = text;
    el.style[type.includes('user') ? 'marginLeft' : 'marginRight'] = 'auto';
    const container = document.getElementById('chatMessages');
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  // ═══════════════════════════════════════════
  // VOICE
  // ═══════════════════════════════════════════
  function setupVoice() {
    document.getElementById('micBtn').addEventListener('click', toggleMic);
    document.getElementById('voiceBtn').addEventListener('click', () => {
      voiceOn = !voiceOn;
      document.getElementById('voiceBtn').classList.toggle('on', voiceOn);
    });
  }

  function toggleMic() {
    const btn = document.getElementById('micBtn');
    if (recognition) { recognition.stop(); recognition = null; btn.classList.remove('recording'); return; }
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = e => {
      document.getElementById('chatInput').value = e.results[0][0].transcript;
      document.getElementById('chatSend').disabled = false;
      btn.classList.remove('recording');
      recognition = null;
      askAI();
    };
    recognition.onerror = () => { btn.classList.remove('recording'); recognition = null; };
    recognition.onend = () => { btn.classList.remove('recording'); recognition = null; };
    btn.classList.add('recording');
    recognition.start();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 500));
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  // ─── Register ───
  NX.brain = { init, closePanel, show: () => { resize(); } };
  NX.modules.brain = NX.brain;
  NX.loaded.brain = true;
})();
