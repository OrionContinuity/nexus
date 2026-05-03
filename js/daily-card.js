/* ════════════════════════════════════════════════════════════════════
   NEXUS · Daily Card · Roman Library Phase 1
   --------------------------------------------------------------------
   Renders a daily Roman reading at the top of the Home view. One card
   per day, generated on first Home view load when no row exists in
   public.daily_cards for today.

   Generation pipeline:
     1. mount() called by home.js after the view renders
     2. Check Supabase for today's card (get_today_card RPC)
     3. If found: render
     4. If not: pick today's topic kind (weekday rotation), call
        Claude with the morning prompt, parse the result, save to
        daily_cards, then render
     5. The card is cached in memory and reused if Home re-renders
        within the same session

   Topic rotation (Austin local weekday):
     Mon  · person          (one Roman, vivid)
     Tue  · battle           (tactical lesson)
     Wed  · law / reform     (institutional change)
     Thu  · infrastructure   (aqueducts, roads, etc.)
     Fri  · culture          (literature, religion, art)
     Sat  · primary source   (one passage, dwell on it)
     Sun  · Latin phrase     (origin and use)

   The card has two voices:
     - Providentia: contemplative, advisory, ~3-5 sentences
     - Trajan: hard verdict, 1-2 sentences, no hedging

   The Korean section is reserved (jsonb column exists) but not
   populated until the language phase ships.

   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const NX = window.NX = window.NX || {};

  // ─── Topic rotation ───────────────────────────────────────────────
  // Indexed by getDay() in America/Chicago: 0=Sun, 1=Mon, ..., 6=Sat
  const TOPIC_ROTATION = [
    { kind: 'latin_phrase',   prompt: 'Today is Sunday — a Latin phrase. Pick one short Latin maxim still used in English. Explain its origin and how Romans used it. Show a contemporary application Orion might recognize from running restaurants.' },
    { kind: 'person',         prompt: 'Today is Monday — a Roman person. Pick one historical figure (Republic or early Empire). Describe what they did, what they got wrong, and what survives of their work. Vivid, specific, not a Wikipedia summary.' },
    { kind: 'battle',         prompt: 'Today is Tuesday — a battle. Pick one engagement from Roman history. Set the scene briefly, name the tactical decision that mattered, name the consequence. Treat it as a leadership case study, not a war story.' },
    { kind: 'law',            prompt: 'Today is Wednesday — a law or reform. Pick one institutional change from Roman history (a law, a tribune, a structural reform). Explain what was broken, what was tried, what stuck.' },
    { kind: 'infrastructure', prompt: 'Today is Thursday — Roman infrastructure. Pick one engineering or logistical achievement (aqueduct, road, fort, granary system). What problem did it solve? What does it teach about durable systems?' },
    { kind: 'culture',        prompt: 'Today is Friday — Roman culture. Pick one cultural element (a poet, a religious practice, a literary form, an artistic convention). Describe it without nostalgia. Note what it cost the people who lived it.' },
    { kind: 'primary_source', prompt: 'Today is Saturday — a primary source. Use the search_library tool internally if helpful, but pick one passage from the corpus available (Marcus Aurelius, Plutarch, Caesar, Suetonius, Tacitus, Cassius Dio, Livy). Quote it briefly. Then dwell on it — what it means, why it persists.' },
  ];

  // ─── State ────────────────────────────────────────────────────────
  let todayCard = null;            // cached after first load
  let mountedEl = null;            // DOM node we're rendering into
  let isGenerating = false;        // guard against concurrent gen attempts

  // ─── Helpers ──────────────────────────────────────────────────────

  // Austin-local YYYY-MM-DD. Matches the get_today_card RPC's date logic.
  function todayLocal() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayWeekday() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return d.getDay();
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── Generation ───────────────────────────────────────────────────

  // Builds the prompt for Claude. The persona instruction at the top
  // sets the dual-voice format; the topic instruction is rotation-driven.
  function buildPrompt(topicSpec) {
    return `You are writing a daily Roman reading for Orion, who runs three restaurants in Austin (Suerte, Este, Bar Toti). He values discipline, honest verdicts, and historical depth.

Two voices:
  · PROVIDENTIA — contemplative advisor. 3-5 sentences. Explains the topic with patience. Connects it to a contemporary lesson without forcing the parallel.
  · TRAJAN — emperor's blunt verdict. 1-2 sentences. No hedging. Hard-edged. Sometimes uncomfortable. Never preachy.

Plus a Latin tag: 2-4 words, italicized in the user's mind. A phrase that captures the topic.

Topic instruction:
${topicSpec.prompt}

Output format (strict JSON, no markdown fences, no preamble):
{
  "topic": "Short label (5-10 words)",
  "providentia": "...",
  "trajan": "...",
  "latin_tag": "Memento mori"
}

Rules:
  · No bullet points, no headers, no markdown formatting in the values.
  · Don't say "Marcus said" or "Caesar wrote" — just speak.
  · If you want to quote a primary source, quote 5-15 words at most. Then say what it means.
  · No emojis.
  · Don't address Orion by name in the body. The voice already knows him.
  · Single response. Don't add commentary outside the JSON.`;
  }

  async function generateToday() {
    if (isGenerating) return null;
    isGenerating = true;
    try {
      const weekday = todayWeekday();
      const topicSpec = TOPIC_ROTATION[weekday];
      const prompt = buildPrompt(topicSpec);

      // Pattern matches brain-chat.js — direct browser call to
      // Anthropic with the dangerous-direct-browser-access flag.
      // This is the same security posture as the rest of NEXUS chat;
      // a Phase C edge function migration will fix all of it at once.
      const apiKey = (NX.getApiKey && NX.getApiKey()) || localStorage.getItem('nexus_api_key');
      if (!apiKey) {
        console.warn('[daily-card] no API key; skipping generation');
        return null;
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await resp.json();
      const text = data?.content?.[0]?.text;
      if (!text) {
        console.warn('[daily-card] empty response from Claude', data);
        return null;
      }

      // Parse the JSON response. Strip code fences in case the model
      // ignored the "no markdown" instruction.
      let parsed;
      try {
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.warn('[daily-card] could not parse JSON; got:', text);
        return null;
      }

      if (!parsed.providentia || !parsed.trajan) {
        console.warn('[daily-card] parsed but missing required fields', parsed);
        return null;
      }

      // Save to Supabase. UNIQUE on card_date prevents dupes if two
      // tabs race; we ignore the conflict and re-fetch.
      const row = {
        card_date:        todayLocal(),
        topic_kind:       topicSpec.kind,
        topic:            parsed.topic || topicSpec.kind,
        providentia_text: parsed.providentia,
        trajan_text:      parsed.trajan,
        latin_tag:        parsed.latin_tag || null,
        source_refs:      parsed.source_refs || [],
      };
      const { data: ins, error: insErr } = await NX.sb
        .from('daily_cards')
        .insert(row)
        .select()
        .single();
      if (insErr) {
        // Probably a UNIQUE violation from a race — fetch the existing row
        const { data: existing } = await NX.sb.rpc('get_today_card');
        return (existing && existing[0]) || null;
      }
      return ins;
    } catch (e) {
      console.error('[daily-card] generation failed', e);
      return null;
    } finally {
      isGenerating = false;
    }
  }

  // ─── Render ───────────────────────────────────────────────────────

  function renderSkeleton() {
    if (!mountedEl) return;
    mountedEl.innerHTML = `
      <div class="dcard dcard--loading">
        <div class="dcard-skeleton dcard-skeleton-tag"></div>
        <div class="dcard-skeleton dcard-skeleton-line"></div>
        <div class="dcard-skeleton dcard-skeleton-line"></div>
        <div class="dcard-skeleton dcard-skeleton-line dcard-skeleton-line--short"></div>
      </div>
    `;
  }

  function renderEmpty(reason) {
    if (!mountedEl) return;
    // No API key, generation failed, etc. Silent — don't intrude.
    // Just leave a small affordance so a tap can retry.
    mountedEl.innerHTML = `
      <button class="dcard dcard--empty" id="dcardRetry" type="button">
        <span class="dcard-empty-text">Today's reading isn't available yet.</span>
        <span class="dcard-empty-hint">Tap to try generating it now.</span>
      </button>
    `;
    const btn = document.getElementById('dcardRetry');
    if (btn) {
      btn.addEventListener('click', async () => {
        renderSkeleton();
        const card = await generateToday();
        if (card) { todayCard = card; renderCard(card); }
        else renderEmpty('retry-failed');
      });
    }
  }

  function renderCard(card) {
    if (!mountedEl || !card) return;
    const tag = card.latin_tag ? `<span class="dcard-tag">${escHtml(card.latin_tag)}</span>` : '';
    const topicKind = card.topic_kind || 'reading';
    mountedEl.innerHTML = `
      <article class="dcard" data-kind="${escHtml(topicKind)}">
        <header class="dcard-head">
          ${tag}
          <h3 class="dcard-topic">${escHtml(card.topic || '')}</h3>
        </header>
        <div class="dcard-providentia">
          <span class="dcard-voice-label">Providentia</span>
          <p class="dcard-body">${escHtml(card.providentia_text || '')}</p>
        </div>
        <div class="dcard-trajan">
          <span class="dcard-voice-label">Trajan</span>
          <p class="dcard-body">${escHtml(card.trajan_text || '')}</p>
        </div>
      </article>
    `;
  }

  // ─── Public API ───────────────────────────────────────────────────

  // Called by home.js after the home view's innerHTML is set.
  // Looks up today's card; if missing, generates one.
  async function mount(targetEl) {
    if (!targetEl) return;
    mountedEl = targetEl;

    // If we already have today's card cached in memory and the date
    // hasn't rolled over, just re-render. Avoids re-fetching across
    // multiple Home views in one session.
    if (todayCard && todayCard.card_date === todayLocal()) {
      renderCard(todayCard);
      return;
    }

    renderSkeleton();

    if (!NX.sb) { renderEmpty('no-supabase'); return; }

    // Try to read existing card for today
    try {
      const { data, error } = await NX.sb.rpc('get_today_card');
      if (error) { console.warn('[daily-card] get_today_card failed', error); }
      if (data && data.length) {
        todayCard = data[0];
        renderCard(todayCard);
        return;
      }
    } catch (e) {
      console.warn('[daily-card] get_today_card threw', e);
    }

    // No card for today — generate one
    const generated = await generateToday();
    if (generated) {
      todayCard = generated;
      renderCard(generated);
    } else {
      renderEmpty('gen-failed');
    }
  }

  // Force regenerate — clears today's row and generates a new one.
  // Useful for debugging or if the user dislikes today's card.
  async function regenerate() {
    if (!NX.sb) return null;
    await NX.sb.from('daily_cards').delete().eq('card_date', todayLocal());
    todayCard = null;
    if (mountedEl) renderSkeleton();
    const gen = await generateToday();
    if (gen) {
      todayCard = gen;
      renderCard(gen);
    }
    return gen;
  }

  NX.dailyCard = { mount, regenerate };
})();
