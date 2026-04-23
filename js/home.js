/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Home — Stage A
   
   The first thing you see at 6am. Editorial/terminal hybrid dashboard.
   Renders a priority feed of things actually needing attention, followed
   by 4 at-a-glance metric counts, then the Ask NEXUS entry point.
   
   Design: no feed item is invented — every line has a real row behind
   it. If nothing's wrong, we show a calm "quiet this morning" state
   rather than padding with fake urgency.
   
   Priority feed sources (in order of importance):
     1. OVERDUE — equipment where next_pm_date < now
     2. REPORTED — tickets opened in the last 18h
     3. INCOMING — contractor_events happening in the next 48h
     4. FYI — recent knowledge nodes added by teammates (calm signal)
   
   We cap at 3 items. More than that becomes noise, not priority.
   
   Extends NX.modules so app.js can call show()/init() via its existing
   module router. Stays self-contained otherwise.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const TONE_LABELS = {
    overdue:  'OVERDUE',
    reported: 'REPORTED',
    incoming: 'INCOMING',
    calm:     'QUIET',
    fyi:      'FYI',
  };

  const home = {
    _loaded: false,
    _feedItems: [],

    async init() {
      // Called once by app.js module loader. Render immediately with
      // skeletons, then populate from real data.
      this.render();
      this.wireGalaxy();
      this.wireAsk();
      await this.refresh();
      this._loaded = true;
    },

    async show() {
      // Called every time the home tab becomes active. Re-fetch.
      if (!this._loaded) return this.init();
      await this.refresh();
    },

    render() {
      const el = document.getElementById('homeView');
      if (!el) return;
      const now = new Date();
      const hour = now.getHours();
      const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
      const firstName = (NX.currentUser?.name || '').split(' ')[0] || 'there';

      // Date line: "WED · APR 22 · 6:47 AM" — short enough to fit
      // alongside the NEXUS wordmark + mini-galaxy on any phone.
      const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const dateLine = [
        days[now.getDay()],
        `${months[now.getMonth()]} ${now.getDate()}`,
        now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase()
      ].join(' · ');

      el.innerHTML = `
        <div class="home-page">
          <div class="home-mast">
            <div class="home-mast-brand">NEXUS</div>
            <div class="home-mast-date">
              <span>${esc(dateLine)}</span>
              <span class="home-mini-galaxy" id="homeMiniGalaxy" title="Open the galaxy view">
                <canvas id="homeMiniGalaxyCanvas" width="44" height="44"></canvas>
              </span>
            </div>
          </div>

          <h1 class="home-lede">
            ${esc(greeting)}<span class="home-lede-comma">,</span>
            <span class="home-lede-name">${esc(firstName)}.</span>
          </h1>

          <p class="home-intro" id="homeIntro">
            Checking what's happening across the restaurants…
          </p>

          <div class="home-feed" id="homeFeed">
            <div class="home-skeleton"></div>
            <div class="home-skeleton"></div>
            <div class="home-skeleton"></div>
          </div>

          <div class="home-rule">On the books</div>
          <div class="home-cal" id="homeCal">
            <div class="home-skeleton home-skeleton-cal"></div>
            <div class="home-skeleton home-skeleton-cal"></div>
          </div>
          <button class="home-cal-viewall" id="homeCalView">View full calendar →</button>

          <div class="home-rule">At a glance</div>
          <div class="home-glance" id="homeGlance">
            ${['tickets','overdue','services','nodes'].map(k => `
              <button class="home-stat" data-stat="${k}">
                <span class="home-stat-num loading">—</span>
                <span class="home-stat-label">${labelFor(k)}</span>
              </button>
            `).join('')}
          </div>

          <div class="home-rule">Ask</div>
          <div class="home-ask" id="homeAsk">
            <span class="home-ask-prompt">Ask <em>NEXUS</em> anything…</span>
            <span class="home-ask-kbd">⏎</span>
          </div>
        </div>
      `;
    },

    async refresh() {
      await Promise.all([
        this.loadFeed(),
        this.loadCalendar(),
        this.loadGlance(),
      ]);
    },

    /* ═════════════ PRIORITY FEED ═════════════════════════════════ */
    async loadFeed() {
      const feedEl = document.getElementById('homeFeed');
      const introEl = document.getElementById('homeIntro');
      if (!feedEl) return;

      try {
        const items = await collectPriorityItems();
        this._feedItems = items;

        if (!items.length) {
          feedEl.innerHTML = `
            <button class="home-feed-calm" type="button" data-action="review-equipment">
              <span class="home-feed-calm-mark">◇</span>
              <div class="home-feed-calm-text">
                Nothing urgent this morning. All equipment current, no overnight tickets, contractors on schedule.
              </div>
              <span class="home-feed-calm-cta">Review equipment →</span>
            </button>
          `;
          // Wire the calm-card tap → jump to Equipment view. Bypasses
          // any intermediate screens; the user explicitly asked for a
          // direct route from the "nothing urgent" card to the list.
          const calmBtn = feedEl.querySelector('.home-feed-calm');
          if (calmBtn) {
            calmBtn.addEventListener('click', () => {
              if (NX.switchTo) NX.switchTo('equipment');
            });
          }
          if (introEl) {
            introEl.innerHTML = 'All equipment is current and nothing new came in overnight. <strong>The restaurants are calm.</strong>';
          }
          return;
        }

        if (introEl) {
          introEl.innerHTML = buildSituationLine(items);
        }

        feedEl.innerHTML = items.map((item, idx) => `
          <button class="home-item" data-tone="${item.tone}" data-action-key="${item.actionKey || ''}">
            <span class="home-item-num">${String(idx + 1).padStart(2, '0')}</span>
            <div class="home-item-kicker">${TONE_LABELS[item.tone] || 'NOTE'}</div>
            <div class="home-item-title">${esc(item.title)}</div>
            <div class="home-item-body">${esc(item.body)}</div>
            ${item.actionLabel ? `<span class="home-item-action">${esc(item.actionLabel)}</span>` : ''}
          </button>
        `).join('');

        // Wire item clicks
        feedEl.querySelectorAll('.home-item').forEach((el, idx) => {
          el.addEventListener('click', () => {
            const item = this._feedItems[idx];
            if (item?.onClick) item.onClick();
          });
        });
      } catch (err) {
        console.error('[home] feed load failed:', err);
        feedEl.innerHTML = `
          <div class="home-feed-calm">
            <div class="home-feed-calm-text">Couldn't load priorities right now. Try again in a moment.</div>
          </div>
        `;
      }
    },

    /* ═════════════ ON THE BOOKS — contractor calendar ════════════
       Pulls contractor_events for ~2 weeks back and ~2 weeks forward,
       grouped by day. Email ingestion populates this table, so the
       home screen stays fresh without any manual upkeep.
       
       Density policy: up to 3 past days (only those with events),
       today (always, even if empty — confirms "nothing today"),
       and up to 6 future days with events. Roughly one screenful
       of calendar context on a phone.                                */
    async loadCalendar() {
      const calEl = document.getElementById('homeCal');
      const viewBtn = document.getElementById('homeCalView');
      if (!calEl || !NX.sb) return;

      // Wire the "View full calendar →" link once, regardless of data
      if (viewBtn && !viewBtn._wired) {
        viewBtn.addEventListener('click', () => NX.switchTo?.('cal'));
        viewBtn._wired = true;
      }

      try {
        const today = new Date().toISOString().slice(0, 10);
        const pastBound = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        const futureBound = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);

        // Home's "On the books" pulls from TWO sources so it matches
        // what Calendar view shows:
        //   1. contractor_events — scheduled contractor visits
        //   2. kanban_cards with due_date — board tasks with deadlines
        // Both are merged into one day-keyed map below.
        const [eventsResp, cardsResp] = await Promise.all([
          NX.sb.from('contractor_events')
            .select('id, contractor_name, event_date, event_time, description, location, status')
            .gte('event_date', pastBound)
            .lte('event_date', futureBound)
            .neq('status', 'cancelled')
            .order('event_date', { ascending: true })
            .order('event_time', { ascending: true })
            .limit(60),
          NX.sb.from('kanban_cards')
            .select('id, title, due_date, priority, status, column_name, location, archived')
            .not('due_date', 'is', null)
            .gte('due_date', pastBound)
            .lte('due_date', futureBound)
            .or('archived.is.null,archived.eq.false')
            .neq('column_name', 'done')
            .order('due_date', { ascending: true })
            .limit(60),
        ]);

        if (eventsResp.error) throw eventsResp.error;
        const events = eventsResp.data || [];
        const cards  = cardsResp.data  || [];

        // Bucket events + cards into a day-keyed map. Both types share
        // the same row schema downstream — normalize cards to the same
        // shape (contractor_name + event_time etc.) so rendering is
        // uniform. A `_kind` field lets status coloring distinguish them.
        const byDate = new Map();
        const pushItem = (date, item) => {
          if (!byDate.has(date)) byDate.set(date, []);
          byDate.get(date).push(item);
        };
        events.forEach(e => pushItem(e.event_date, { ...e, _kind: 'event' }));
        cards.forEach(c => {
          pushItem(c.due_date, {
            _kind: 'card',
            id: c.id,
            contractor_name: c.title || 'Task',
            event_date: c.due_date,
            event_time: null,            // cards are "all day"
            description: '',
            location: c.location,
            status: c.status || 'pending',
            _priority: c.priority,
          });
        });

        // Build the day list with past/today/future logic
        const days = [];
        const pastDates   = [...byDate.keys()].filter(d => d <  today).sort();
        const futureDates = [...byDate.keys()].filter(d => d >  today).sort();

        // Last 3 past days with events, oldest first so they read chronologically
        pastDates.slice(-3).forEach(d => days.push({ date: d, items: byDate.get(d), relative: 'past' }));
        // Today — always included so users see "no visits today" when relevant
        days.push({ date: today, items: byDate.get(today) || [], relative: 'today' });
        // Next 6 future days with events
        futureDates.slice(0, 6).forEach(d => days.push({ date: d, items: byDate.get(d), relative: 'future' }));

        // Degenerate case: no contractor events AND no card due dates
        const hasAnyEvents = events.length > 0 || cards.length > 0;
        if (!hasAnyEvents) {
          calEl.innerHTML = `
            <div class="home-cal-empty-all">
              Nothing scheduled for the next few weeks. <br>
              Add events in Calendar or cards with due dates on the Board.
            </div>
          `;
          return;
        }

        // Track whether we've marked the "Next up" event yet — the
        // first future event gets a highlight treatment so the strip
        // has forward momentum even when today is empty.
        let nextUpMarked = false;

        calEl.innerHTML = days.map(day => {
          const isToday  = day.relative === 'today';
          const isPast   = day.relative === 'past';
          const isFuture = day.relative === 'future';
          const dateLabel = formatCalDate(day.date, isToday);
          const relLabel  = isFuture ? relativeDayLabel(day.date) : '';

          const itemsHtml = day.items.length === 0
            ? `<div class="home-cal-empty">Nothing scheduled.</div>`
            : day.items.map(e => {
                const isCard = e._kind === 'card';
                const timeStr = e.event_time ? formatTime12(e.event_time) : (isCard ? 'due' : 'all day');
                const titleBits = [e.contractor_name, e.location && titleCase(e.location)].filter(Boolean);
                const title = titleBits.join(' · ') || 'Scheduled visit';
                const status = eventStatus(e, isPast);
                const accent = statusColor(status);
                const isNextUp = isFuture && !nextUpMarked;
                if (isNextUp) nextUpMarked = true;
                return `
                  <button class="home-cal-item ${isNextUp ? 'is-nextup' : ''}" data-event-id="${esc(e.id)}" data-kind="${isCard ? 'card' : 'event'}" type="button">
                    <span class="home-cal-accent" style="background:${accent}"></span>
                    <span class="home-cal-time">${esc(timeStr)}</span>
                    <span class="home-cal-body">
                      ${isNextUp ? '<span class="home-cal-nextup">Next up</span>' : ''}
                      <span class="home-cal-title">
                        <span class="home-cal-title-text">${esc(title)}</span>
                        ${status.icon ? `<span class="home-cal-status" title="${esc(status.label)}">${status.icon}</span>` : ''}
                      </span>
                      ${e.description ? `<span class="home-cal-desc">${esc(e.description).slice(0, 80)}</span>` : ''}
                    </span>
                  </button>
                `;
              }).join('');

          return `
            <div class="home-cal-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${isFuture ? 'is-future' : ''}">
              <div class="home-cal-date">
                ${isToday ? '<span class="home-cal-today-dot"></span>' : ''}
                <span class="home-cal-date-label">${esc(dateLabel)}</span>
                ${relLabel ? `<span class="home-cal-date-rel">${esc(relLabel)}</span>` : ''}
              </div>
              <div class="home-cal-items">${itemsHtml}</div>
            </div>
          `;
        }).join('');

        // Wire item taps: cards → Board, events → Calendar (both places
        // have richer detail than we can show in this compact strip).
        calEl.querySelectorAll('.home-cal-item').forEach(btn => {
          btn.addEventListener('click', () => {
            const kind = btn.dataset.kind;
            NX.switchTo?.(kind === 'card' ? 'board' : 'cal');
          });
        });
      } catch (err) {
        console.warn('[home] calendar load failed:', err.message);
        calEl.innerHTML = `
          <div class="home-cal-empty-all">
            Couldn't load the calendar right now. Tap "View full calendar" to try there.
          </div>
        `;
      }
    },

    /* ═════════════ AT-A-GLANCE STATS ═════════════════════════════ */
    async loadGlance() {
      if (!NX.sb) return;
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 86400000).toISOString();
      const nowIso = today.toISOString();

      // Fire all in parallel, let any individual failure degrade gracefully
      const [ticketsRes, overdueRes, servicesRes, nodesRes] = await Promise.allSettled([
        NX.sb.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'open'),
        NX.sb.from('equipment').select('*', { count: 'exact', head: true }).lt('next_pm_date', nowIso.slice(0, 10)),
        NX.sb.from('equipment_maintenance').select('*', { count: 'exact', head: true }).gte('event_date', weekAgo.slice(0, 10)),
        // Total node count across the brain (not the 7-day slice — users
        // want to know how big their knowledge graph is, not recent adds)
        NX.sb.from('nodes').select('*', { count: 'exact', head: true }),
      ]);

      const counts = {
        tickets:  numOrDash(ticketsRes),
        overdue:  numOrDash(overdueRes),
        services: numOrDash(servicesRes),
        nodes:    numOrDash(nodesRes),
      };

      Object.keys(counts).forEach(k => {
        const btn = document.querySelector(`.home-stat[data-stat="${k}"]`);
        if (!btn) return;
        const num = btn.querySelector('.home-stat-num');
        // Format numbers with commas so '2400' reads as '2,400' at a glance.
        // Special case: show '2.4k' for the nodes stat when it gets very
        // large so it doesn't spill over adjacent columns on small phones.
        const v = counts[k];
        if (typeof v === 'number') {
          if (k === 'nodes' && v >= 1000) {
            num.textContent = (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
          } else {
            num.textContent = v.toLocaleString();
          }
        } else {
          num.textContent = v;
        }
        num.classList.remove('loading');
        if (k === 'overdue' && typeof v === 'number' && v > 0) {
          num.classList.add('alert');
        }
      });

      // Wire stat taps to relevant views — with filter intents where useful
      const statRoutes = {
        tickets: () => {
          NX.ticketsFilterIntent = { status: 'open' };
          NX.switchTo?.('log');
        },
        overdue: () => {
          // Pre-activate the overdue-PM filter in the equipment module.
          // equipment.js reads this on show() and clears it after applying.
          NX.equipmentFilterIntent = { pm: 'overdue' };
          NX.switchTo?.('equipment');
        },
        services: () => NX.switchTo?.('cal'),
        nodes: () => NX.switchTo?.('brain'),
      };
      document.querySelectorAll('.home-stat').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.stat;
          statRoutes[k]?.();
        });
      });
    },

    /* ═════════════ THE SPINNING MINI GALAXY ══════════════════════ */
    // This is the essence of NEXUS distilled into 22 pixels. A real
    // mini of the big galaxy, not a generic particle demo. Built with
    // a few specific decisions that add up to "alive":
    //
    //   1. LOG-SPIRAL ARMS. Two arms, offset by π. Particles cluster
    //      along arm phase. Radius grows exponentially with arm length
    //      (classic astronomy formula r = a·e^(b·θ)). Gives the sweeping
    //      look instead of dots on rings.
    //
    //   2. DIFFERENTIAL ROTATION. Inner particles orbit faster than
    //      outer (approximation of Kepler). Arms slowly wind up over
    //      time, never repeating the same silhouette. ω ∝ 1/√r.
    //
    //   3. PERSPECTIVE TILT. Y-axis squashed 0.72 for a ~25° viewing
    //      angle, matching the big galaxy's orientation. Free depth.
    //
    //   4. ACCRETION DISK. Thin bright elliptical ring at r=3 around
    //      the core — the event horizon glow from the big version.
    //
    //   5. COLOR PALETTE. Warm cream (arm tracers), pale gold
    //      (featured particles), and dim sepia background stars.
    //      Core is hot gold. Variety reads as "galaxy", not "dots".
    //
    //   6. TWINKLE. Each particle has its own phase/rate, alpha
    //      breathes ±3%. Subtle enough you don't notice it consciously
    //      but the result feels alive, not looped.
    //
    //   7. MOTION TRAIL. Frame doesn't clear — it dims by 12% and
    //      composites over. Creates a silky continuous-rotation
    //      feel instead of choppy 60 discrete frames.
    //
    //   8. PULSE RESPONSE. When a node activates anywhere in the app,
    //      the galaxy brightens, the accretion disk flares, and a
    //      gold shockwave ripples outward through the arms. Tied to
    //      the `galaxy:node-open` event from galaxy.js. Also exposed
    //      as NX.homeGalaxyPulse() for any module to trigger.
    //
    //   9. ADMIN-GATED CLICK. Everyone sees the animation. Only
    //      admins can tap it to open the full galaxy view (non-admins
    //      get a no-op — the mini stays purely ornamental for them).
    wireGalaxy() {
      const canvas = document.getElementById('homeMiniGalaxyCanvas');
      const wrap = document.getElementById('homeMiniGalaxy');
      if (!canvas || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const size = 22;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const cx = size / 2;
      const cy = size / 2;
      const TILT_Y = 0.72;             // Y-axis squash = tilted perspective

      // Arm geometry: log spiral r = A · e^(B·θ)
      // B = cot(pitch); small pitch = tight arms. 15° pitch works at 22px.
      // A tuned so that at θ=0, r starts ~1.5, and at arm_length=1.0
      // the particle reaches the outer edge (~9).
      const PITCH_DEG = 14;
      const B = 1 / Math.tan(PITCH_DEG * Math.PI / 180);
      // Arms drift slightly over time — the whole pattern rotates
      // like a real galaxy (~1 revolution per minute).
      const GALAXY_OMEGA = 0.00010;    // rad/ms. Slow enough to feel confident.

      // Particle pool. Two kinds:
      //   arm particles  — bright, trace the spiral arms (12 per arm)
      //   field particles — dim background stars, uniformly distributed (14)
      const arms = [];
      for (let armId = 0; armId < 2; armId++) {
        const armPhase = armId * Math.PI;   // two arms, π apart
        for (let i = 0; i < 12; i++) {
          const t = 0.05 + (i / 12) * 0.95;  // position along arm (0..1)
          arms.push({
            arm: armPhase,
            t,                                // position along arm
            size: 0.55 + Math.random() * 0.8,
            alphaBase: 0.40 + Math.random() * 0.45,
            // Small tangential offset so arms look thick not linear
            tanOff: (Math.random() - 0.5) * 0.5,
            radialOff: (Math.random() - 0.5) * 0.25,
            // Twinkle: frequency 0.6–1.3 Hz, amplitude ±3%
            twinkleRate: 0.0006 + Math.random() * 0.0007,
            twinklePhase: Math.random() * Math.PI * 2,
            // Color bias: 0 = warm cream, 1 = pale gold
            hue: Math.random() > 0.65 ? 1 : 0,
          });
        }
      }
      const field = [];
      for (let i = 0; i < 14; i++) {
        // Random position in disk, but radius-biased so density is
        // higher toward the center (1 - sqrt(u) gives 1/r falloff)
        const u = Math.random();
        const r = 2 + (1 - Math.sqrt(u)) * 7 + Math.random() * 2;
        const theta = Math.random() * Math.PI * 2;
        field.push({
          r, theta,
          size: 0.35 + Math.random() * 0.4,
          alphaBase: 0.10 + Math.random() * 0.20,
          twinkleRate: 0.0005 + Math.random() * 0.0006,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }

      let running = true;
      let lastT = performance.now();
      let pulseT0 = 0;
      const PULSE_MS = 1200;

      function pulseCurve(t) {
        if (t < 0 || t > 1) return 0;
        if (t < 0.2) return t / 0.2;                      // attack
        return Math.pow(1 - (t - 0.2) / 0.8, 2);          // quadratic decay
      }

      // Map [t along arm 0..1] → (r, θ) on log spiral.
      // r = 1.5 * e^(B * (t * scale)). Scale tuned so t=1 → r ≈ 8.5.
      // θ = base + t * ARM_SWEEP (how much the arm wraps around).
      const ARM_SWEEP = 1.6 * Math.PI;  // arms spiral through 288° each
      function armPoint(armBase, t) {
        const theta = armBase + t * ARM_SWEEP;
        const r = 1.5 * Math.exp(B * (t * ARM_SWEEP * 0.068));
        return { r, theta };
      }

      // Drawing a point with elliptical tilt — Y squashed.
      function projectDraw(r, theta, drawFn) {
        const x = cx + r * Math.cos(theta);
        const y = cy + r * Math.sin(theta) * TILT_Y;
        drawFn(x, y);
      }

      function frame(t) {
        if (!running) return;
        const dt = t - lastT;
        lastT = t;

        const pulseIntensity = pulseT0
          ? pulseCurve((t - pulseT0) / PULSE_MS)
          : 0;

        // Composite fade — don't clear, dim. 12% per frame ≈ short trail.
        // Higher alpha = shorter trail. Tuned for silk-smooth rotation.
        ctx.fillStyle = 'rgba(9, 8, 12, 0.22)';
        ctx.fillRect(0, 0, size, size);

        // Soft radial wash underneath everything — warm light leaking
        // from the core. Intensifies during pulse.
        const washAlpha = 0.08 + pulseIntensity * 0.22;
        const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 1.8);
        wash.addColorStop(0, `rgba(212, 164, 78, ${washAlpha.toFixed(3)})`);
        wash.addColorStop(0.6, `rgba(212, 164, 78, ${(washAlpha * 0.25).toFixed(3)})`);
        wash.addColorStop(1, 'rgba(212, 164, 78, 0)');
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, size, size);

        // Galaxy-level rotation angle (advances steadily)
        const galaxyTheta = t * GALAXY_OMEGA;

        // ─── Field stars (dim background) ───────────────────────────
        // Slow differential rotation. These don't move along arms,
        // just rotate at their radius.
        for (const s of field) {
          const omega = 0.00018 / Math.sqrt(Math.max(0.5, s.r));
          s.theta += omega * dt;
          const twinkle = 1 + 0.04 * Math.sin(t * s.twinkleRate + s.twinklePhase);
          const a = Math.min(1, s.alphaBase * twinkle * (1 + pulseIntensity * 0.5));
          projectDraw(s.r, s.theta, (x, y) => {
            ctx.fillStyle = `rgba(220, 208, 182, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, s.size, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        // ─── Arm particles (the sweeping spiral) ────────────────────
        // Each particle flows along its arm. Its t-position advances,
        // and when it reaches the outer edge it respawns at the core.
        // Combined with galaxy-level rotation, this draws the spiral.
        for (const p of arms) {
          // Flow along the arm — inner particles flow faster.
          const flowSpeed = 0.00009 * (1.4 - p.t * 0.7);
          p.t += flowSpeed * dt;
          if (p.t > 1.05) p.t = 0.05;   // respawn at core when consumed

          // Base spiral position
          const { r: rBase, theta: thBase } = armPoint(p.arm + galaxyTheta, p.t);
          // Add per-particle offsets (arm thickness, tangential spread)
          const r = rBase + p.radialOff * (1 + p.t);
          const theta = thBase + (p.tanOff * 0.15) / Math.max(0.5, r);

          const twinkle = 1 + 0.04 * Math.sin(t * p.twinkleRate + p.twinklePhase);
          const pulseBoost = 1 + pulseIntensity * 0.55;
          const a = Math.min(1, p.alphaBase * twinkle * pulseBoost);
          const s = p.size * (1 + pulseIntensity * 0.15);

          // Cream for the bulk of arm particles, pale gold for
          // featured ones (hue=1). Core-proximity nudge adds warmth.
          const coreNearness = Math.max(0, 1 - p.t * 1.8);
          const warmPull = p.hue === 1 ? 0.7 : 0.25 * coreNearness;
          const rCh = Math.round(237 - warmPull * 15);
          const gCh = Math.round(228 - warmPull * 45);
          const bCh = Math.round(205 - warmPull * 95);

          projectDraw(r, theta, (x, y) => {
            ctx.fillStyle = `rgba(${rCh}, ${gCh}, ${bCh}, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, s, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        // ─── Accretion disk — thin bright elliptical ring at core ───
        // Tilted (elliptical because of TILT_Y), pulses with beat.
        const diskR = 3.2;
        const diskAlpha = 0.35 + pulseIntensity * 0.45;
        const diskWidth = 0.7 + pulseIntensity * 0.8;
        ctx.strokeStyle = `rgba(234, 184, 102, ${diskAlpha.toFixed(3)})`;
        ctx.lineWidth = diskWidth;
        ctx.beginPath();
        ctx.ellipse(cx, cy, diskR, diskR * TILT_Y, 0, 0, Math.PI * 2);
        ctx.stroke();

        // ─── Shockwave on pulse — a second ring expanding outward ───
        if (pulseIntensity > 0) {
          const shockR = 3 + pulseIntensity * 7;
          const shockA = pulseIntensity * 0.35;
          ctx.strokeStyle = `rgba(212, 164, 78, ${shockA.toFixed(3)})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy, shockR, shockR * TILT_Y, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        // ─── Core — hot gold, pulses ────────────────────────────────
        const coreAlpha = Math.min(1, 0.92 + pulseIntensity * 0.08);
        const coreSize = 1.5 + pulseIntensity * 0.7;
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize * 1.8);
        coreGrad.addColorStop(0, `rgba(255, 215, 140, ${coreAlpha})`);
        coreGrad.addColorStop(0.5, `rgba(212, 164, 78, ${coreAlpha * 0.6})`);
        coreGrad.addColorStop(1, 'rgba(212, 164, 78, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, coreSize * 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Bright core pixel
        ctx.fillStyle = `rgba(255, 230, 180, ${coreAlpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, coreSize * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // End pulse window
        if (pulseT0 && (t - pulseT0) > PULSE_MS) pulseT0 = 0;

        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      // Public API — any module can call NX.homeGalaxyPulse() to
      // trigger the shine/shockwave. Passive for modules that don't
      // know/care about Home.
      NX.homeGalaxyPulse = () => {
        pulseT0 = performance.now();
        if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(frame); }
      };

      // Listen for node-open events from the full galaxy view.
      // galaxy.js fires 'galaxy:node-open' whenever a node panel opens.
      document.addEventListener('galaxy:node-open', () => {
        NX.homeGalaxyPulse();
      });

      // Pause when tab hidden to save battery
      document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        if (running) { lastT = performance.now(); requestAnimationFrame(frame); }
      });

      wrap.addEventListener('click', () => {
        // Non-admins see the animation but can't navigate into the
        // full brain view — the mini stays purely ornamental for
        // them. Check body class at click-time so role changes during
        // the session are respected.
        if (document.body.classList.contains('no-galaxy-access')) return;
        NX.switchTo?.('brain');
      });
    },

    /* ═════════════ ASK NEXUS ENTRY POINT ═════════════════════════ */
    wireAsk() {
      const ask = document.getElementById('homeAsk');
      if (!ask) return;
      ask.addEventListener('click', () => {
        // Stage B: open the dedicated full-screen chat view. If it hasn't
        // loaded yet, lazy-load it and open once ready. Fallback to legacy
        // chat-hud if chat-view.js fails to load.
        if (NX.chatview) { NX.chatview.open(); return; }
        const s = document.createElement('script');
        s.src = 'js/chat-view.js';
        s.onload = () => NX.chatview?.open();
        s.onerror = () => {
          NX.switchTo?.('brain');
          setTimeout(() => {
            document.getElementById('chatHud')?.classList.add('expanded');
            document.getElementById('chatInput')?.focus();
          }, 250);
        };
        document.head.appendChild(s);
      });
      // Keyboard: "/" anywhere on the home page focuses the ask bar
      const onKey = (e) => {
        if (e.key === '/' && document.body.classList.contains('view-home')) {
          const tgt = e.target;
          if (tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA') return;
          e.preventDefault();
          ask.click();
        }
      };
      document.addEventListener('keydown', onKey);
    },
  };

  /* ═════════════════════════════════════════════════════════════════
     HELPERS
     ═════════════════════════════════════════════════════════════════ */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function numWord(n) {
    const words = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
    return n < words.length ? words[n] : String(n);
  }

  // ─── Situation line — describes what's actually happening across the
  // restaurants. Reads from the already-collected priority items so it
  // matches what shows in the feed below. Gold strong elements flag
  // the subjects; the tone stays matter-of-fact and quick to scan.
  function buildSituationLine(items) {
    const counts = { overdue: 0, reported: 0, incoming: 0 };
    items.forEach(i => { counts[i.tone] = (counts[i.tone] || 0) + 1; });

    // Build a short natural sentence from whichever buckets are active
    const parts = [];
    if (counts.overdue)  parts.push(`<strong>${counts.overdue}</strong> overdue PM${counts.overdue === 1 ? '' : 's'}`);
    if (counts.reported) parts.push(`<strong>${counts.reported}</strong> new ticket${counts.reported === 1 ? '' : 's'} overnight`);
    if (counts.incoming) parts.push(`<strong>${counts.incoming}</strong> visit${counts.incoming === 1 ? '' : 's'} coming up`);

    if (!parts.length) return 'Everything the restaurants need, at a glance.';

    const joined =
      parts.length === 1 ? parts[0] :
      parts.length === 2 ? parts.join(' and ') :
      parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];

    return `${joined[0].toUpperCase() + joined.slice(1)}. Worth a look when you have a moment.`;
  }

  function labelFor(k) {
    return ({
      tickets: 'Open tickets',
      overdue: 'Overdue PMs',
      services: 'Services this wk',
      nodes: 'Nodes in brain',
    })[k] || k.toUpperCase();
  }

  function numOrDash(settled) {
    if (settled?.status !== 'fulfilled') return '—';
    const c = settled.value?.count;
    return typeof c === 'number' ? c : '—';
  }

  function daysAgo(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function hoursAgo(iso) {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  }

  /* ═════════════════════════════════════════════════════════════════
     PRIORITY COLLECTION — each returns 0..N candidate items.
     Final list is capped at 3 by severity weight.
     ═════════════════════════════════════════════════════════════════ */
  async function collectPriorityItems() {
    if (!NX.sb) return [];
    const candidates = [];

    // ─── OVERDUE PMs
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: overdueList } = await NX.sb.from('equipment')
        .select('id, name, location, area, next_pm_date, service_contact_name')
        .lt('next_pm_date', today)
        .order('next_pm_date', { ascending: true })
        .limit(3);
      if (overdueList?.length) {
        // Most overdue item gets the top spot
        const worst = overdueList[0];
        const days = daysAgo(worst.next_pm_date);
        const others = overdueList.length - 1;
        const body = others > 0
          ? `Preventative maintenance overdue ${days} day${days === 1 ? '' : 's'}. ${others} other unit${others === 1 ? '' : 's'} also past due.`
          : `Preventative maintenance overdue ${days} day${days === 1 ? '' : 's'}.${worst.service_contact_name ? ` Usually serviced by ${worst.service_contact_name}.` : ''}`;
        candidates.push({
          tone: 'overdue',
          severity: 100 + days, // older = more severe
          title: `${worst.name}${worst.location ? ' · ' + titleCase(worst.location) : ''}`,
          body,
          actionLabel: 'View equipment',
          onClick: () => NX.switchTo?.('equipment'),
        });
      }
    } catch (e) { console.warn('[home] overdue fetch failed:', e.message); }

    // ─── REPORTED — tickets in the last 18h
    try {
      const sinceIso = new Date(Date.now() - 18 * 3600000).toISOString();
      const { data: tickets } = await NX.sb.from('tickets')
        .select('id, title, reported_by, location, priority, created_at')
        .eq('status', 'open')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(5);
      if (tickets?.length) {
        const top = tickets[0];
        const nOthers = tickets.length - 1;
        const urgentCount = tickets.filter(t => t.priority === 'urgent').length;
        const hrs = hoursAgo(top.created_at);

        let title, body;
        if (tickets.length === 1) {
          title = stripTicketPrefix(top.title) || 'New ticket';
          body = `Opened ${hrs === 0 ? 'just now' : hrs + 'h ago'} by ${top.reported_by || 'unknown'}${top.location ? ' at ' + titleCase(top.location) : ''}.${top.priority === 'urgent' ? ' Marked urgent.' : ''}`;
        } else {
          title = `${tickets.length} new tickets overnight`;
          const locs = [...new Set(tickets.map(t => t.location).filter(Boolean))];
          body = `${urgentCount > 0 ? `${urgentCount} urgent. ` : ''}Reported across ${locs.length ? locs.map(titleCase).join(', ') : 'the restaurants'}. Most recent: ${stripTicketPrefix(top.title).slice(0, 80)}.`;
        }

        candidates.push({
          tone: 'reported',
          severity: 80 + (urgentCount * 10) + tickets.length,
          title,
          body,
          actionLabel: 'See all tickets',
          onClick: () => NX.switchTo?.('log'),
        });
      }
    } catch (e) { console.warn('[home] tickets fetch failed:', e.message); }

    // ─── INCOMING — contractor events + card deadlines in next 48h
    try {
      const today = new Date().toISOString().slice(0, 10);
      const twoDays = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 10);
      const [eventsResp, cardsResp] = await Promise.all([
        NX.sb.from('contractor_events')
          .select('id, contractor_name, event_date, event_time, description, location, status')
          .gte('event_date', today)
          .lte('event_date', twoDays)
          .neq('status', 'cancelled')
          .order('event_date', { ascending: true })
          .order('event_time', { ascending: true })
          .limit(5),
        NX.sb.from('kanban_cards')
          .select('id, title, due_date, priority, status, column_name, location, archived')
          .not('due_date', 'is', null)
          .gte('due_date', today)
          .lte('due_date', twoDays)
          .or('archived.is.null,archived.eq.false')
          .neq('column_name', 'done')
          .order('due_date', { ascending: true })
          .limit(5),
      ]);
      // Normalize both into {when, title, location} shape and merge
      const merged = [];
      (eventsResp.data || []).forEach(ev => {
        merged.push({
          kind: 'event',
          when: formatEventWhen(ev.event_date, ev.event_time),
          title: ev.contractor_name || 'Contractor visit',
          location: ev.location,
          description: ev.description,
          date: ev.event_date,
        });
      });
      (cardsResp.data || []).forEach(c => {
        merged.push({
          kind: 'card',
          when: formatEventWhen(c.due_date, null),
          title: c.title || 'Task',
          location: c.location,
          description: '',
          date: c.due_date,
        });
      });
      // Sort by date so the soonest item is first
      merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (merged.length) {
        const first = merged[0];
        const others = merged.length - 1;
        const otherLabel = others > 0
          ? `. ${others} other ${others === 1 ? 'item' : 'items'} coming up.`
          : (first.description ? '' : '.');
        const locPart = first.location ? ' at ' + titleCase(first.location) : '';
        const descPart = first.description ? ' for ' + first.description : '';
        candidates.push({
          tone: 'incoming',
          severity: 40,
          title: first.title,
          body: `${first.when}${locPart}${descPart}${otherLabel}`,
          actionLabel: first.kind === 'card' ? 'View board' : 'View calendar',
          onClick: () => NX.switchTo?.(first.kind === 'card' ? 'board' : 'cal'),
        });
      }
    } catch (e) { console.warn('[home] events fetch failed:', e.message); }

    // ─── REVIEW — pending public PM logs (admin-only) ────────────────
    // Contractors submit service logs via the QR form which land in
    // pm_logs with review_status='pending'. These are invisible until
    // an admin approves them. Surface the count here so the review
    // flow is one tap away instead of buried behind a hidden modal.
    if (NX.currentUser?.role === 'admin') {
      try {
        const { count } = await NX.sb.from('pm_logs')
          .select('id', { count: 'exact', head: true })
          .eq('review_status', 'pending');
        if (count && count > 0) {
          candidates.push({
            tone: 'reported',
            severity: 60,   // high-priority; sits above INCOMING (40), below OVERDUE (70)
            title: `${count} service log${count === 1 ? '' : 's'} awaiting review`,
            body: count === 1
              ? 'A contractor submitted a service log via the QR form. Approve it to add to the equipment timeline.'
              : `${count} contractors submitted service logs via the QR form. Approve or reject each to move them into the equipment timeline.`,
            actionLabel: count === 1 ? 'Review log' : 'Review logs',
            onClick: () => {
              if (NX.pmLogger?.reviewPendingLogs) {
                NX.pmLogger.reviewPendingLogs();
              } else {
                // Lazy load — equipment-public-pm.js may not be loaded yet
                const s = document.createElement('script');
                s.src = 'js/equipment-public-pm.js';
                s.onload = () => NX.pmLogger?.reviewPendingLogs?.();
                s.onerror = () => alert('Review module failed to load.');
                document.head.appendChild(s);
              }
            },
          });
        }
      } catch (e) { console.warn('[home] pm_logs review count failed:', e.message); }
    }

    // Sort by severity, take top 3
    candidates.sort((a, b) => (b.severity || 0) - (a.severity || 0));
    return candidates.slice(0, 3);
  }

  function stripTicketPrefix(title) {
    if (!title) return '';
    return title.replace(/^\[(Equipment|CALL|Ticket)\]\s*/i, '').replace(/^[^:]+:\s*/, (m) => {
      // Keep the actual issue description, drop "Hot Expo Low Boy: " prefix
      return '';
    }) || title;
  }

  function titleCase(s) {
    if (!s) return '';
    return s.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  function formatEventWhen(dateStr, timeStr) {
    if (!dateStr) return 'Upcoming';
    const d = new Date(dateStr + 'T' + (timeStr || '09:00') + ':00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const rowDay = new Date(d); rowDay.setHours(0, 0, 0, 0);
    const timeStrFormatted = timeStr
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'all day';
    if (rowDay.getTime() === today.getTime())    return `Today at ${timeStrFormatted}`;
    if (rowDay.getTime() === tomorrow.getTime()) return `Tomorrow at ${timeStrFormatted}`;
    const weekday = d.toLocaleDateString([], { weekday: 'long' });
    return `${weekday} at ${timeStrFormatted}`;
  }

  // Format a calendar-row date label: "TODAY · APR 22", "TOMORROW · APR 23",
  // "YESTERDAY · APR 21", or "THU · APR 24". The + 'T12:00:00' suffix
  // sidesteps timezone-at-midnight bugs that otherwise shift dates.
  function formatCalDate(isoDate, isToday) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T12:00:00');
    const weekdays = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const suffix = `${months[d.getMonth()]} ${d.getDate()}`;
    if (isToday) return `TODAY · ${suffix}`;
    const today = new Date(); today.setHours(0,0,0,0);
    const thisDay = new Date(d); thisDay.setHours(0,0,0,0);
    const diff = Math.round((thisDay.getTime() - today.getTime()) / 86400000);
    if (diff === 1)  return `TOMORROW · ${suffix}`;
    if (diff === -1) return `YESTERDAY · ${suffix}`;
    return `${weekdays[d.getDay()]} · ${suffix}`;
  }

  // Convert "HH:MM" or "HH:MM:SS" 24h time to "2:00 PM" style.
  function formatTime12(time24) {
    if (!time24) return '';
    const parts = String(time24).split(':');
    const h = parseInt(parts[0], 10);
    const m = (parts[1] || '00').slice(0, 2);
    if (!Number.isFinite(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  }

  // Relative-time label for future days: "IN 3 DAYS", "NEXT WEEK", etc.
  // Appears under the date label so the strip reads with a forward
  // rhythm instead of static dates. Returns '' for today/tomorrow
  // because formatCalDate already covers those relative cases.
  function relativeDayLabel(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T12:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff <= 1)  return '';
    if (diff <= 7)  return `IN ${diff} DAYS`;
    if (diff <= 14) return 'NEXT WEEK';
    return '';
  }

  // Event status derived from the status column + past/future context.
  // Returns { key, label, icon }. Past events without status get marked
  // as completed (best guess — if it was in the past and not cancelled,
  // it probably happened). Falls back reasonably for unknown states.
  function eventStatus(e, isPast) {
    const s = (e.status || '').toLowerCase();
    if (s === 'completed' || (isPast && !s)) return { key: 'completed', label: 'Completed', icon: '✓' };
    if (s === 'confirmed')                   return { key: 'confirmed', label: 'Confirmed', icon: '●' };
    if (s === 'pending')                     return { key: 'pending',   label: 'Pending',   icon: '⏱' };
    if (isPast)                              return { key: 'past',      label: 'Past',      icon: '' };
    return { key: 'scheduled', label: 'Scheduled', icon: '' };
  }

  // Accent bar color by status. Gold stays the star player (confirmed/
  // scheduled), muted green signals completed, dim gold for pending,
  // very muted for unknown past events. All inline-compatible.
  function statusColor(status) {
    const key = status?.key || 'scheduled';
    return ({
      completed: '#6b9b6b',
      confirmed: 'rgba(212, 164, 78, 0.9)',
      pending:   'rgba(212, 164, 78, 0.45)',
      scheduled: 'rgba(212, 164, 78, 0.55)',
      past:      'rgba(212, 182, 138, 0.2)',
    })[key] || 'rgba(212, 164, 78, 0.55)';
  }

  /* ═════════════════════════════════════════════════════════════════
     REGISTER WITH APP
     ═════════════════════════════════════════════════════════════════ */
  NX.modules = NX.modules || {};
  NX.modules.home = home;
  NX.home = home;

  // Expose a small helper for the spinning galaxy + stat buttons to use
  if (!NX.switchTo) {
    NX.switchTo = (view) => {
      const btn = document.querySelector(`.bnav-btn[data-view="${view}"]`)
                || document.querySelector(`.nav-tab[data-view="${view}"]`)
                || (view === 'brain' ? document.getElementById('navNexus') : null);
      btn?.click();
    };
  }
})();
