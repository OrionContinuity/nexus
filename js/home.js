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
      // wireGalaxy() removed Stage U — masthead in app.js setupMasthead()
      // owns the coin lifecycle now (NX.coin.* + NX.homeGalaxyPulse alias).
      // The legacy homeCoinMini element no longer renders.
      this.wireAsk();
      await this.refresh();
      this._loaded = true;
      // Subscribe to the data sources that feed the Home priority feed.
      // We don't differentiate events — any change to tickets, cards,
      // contractor events, or equipment triggers a debounced refresh.
      // Aggregation views like Home don't need granular diffing; they
      // just need to know "something changed, recompute."
      this.subscribeRealtime();
      this.bindVisibility();
    },

    async show() {
      // Called every time the home tab becomes active.
      // Stale-while-revalidate — if we have cached data from <15s ago
      // and our subscription is alive, render instantly and skip the
      // fetch. The realtime layer has already kept us current.
      if (!this._loaded) return this.init();
      const isWarm = this._rtConnected && this._lastRefresh && (Date.now() - this._lastRefresh) < 15000;
      if (isWarm) {
        // Instant — already rendered, nothing to do
        return;
      }
      await this.refresh();
      // If tab was hidden long enough that we unsubscribed, resub now
      if (!this._rtChannel) this.subscribeRealtime();
    },

    // ── REALTIME AGGREGATION ───────────────────────────────────────
    // Subscribe once to the 5 tables that feed Home's priority feed.
    // Any INSERT/UPDATE fires our debounced refresh — the view self-
    // updates without the user tapping anything. The 3-second debounce
    // is deliberately generous: Home is an editorial summary, not a
    // live dashboard. Multiple rapid events collapse into one refresh.
    subscribeRealtime() {
      if (this._rtChannel || !NX.sb?.channel) return;
      try {
        this._rtChannel = NX.sb.channel('home-feed')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' },          () => this.scheduleRefresh())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'kanban_cards' },     () => this.scheduleRefresh())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_events' },() => this.scheduleRefresh())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' },        () => this.scheduleRefresh())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs' },       () => this.scheduleRefresh())
          .subscribe((status) => {
            this._rtConnected = (status === 'SUBSCRIBED');
          });
      } catch (e) {
        console.warn('[home] realtime subscribe failed:', e);
      }
    },

    unsubscribeRealtime() {
      if (!this._rtChannel) return;
      try { NX.sb.removeChannel(this._rtChannel); } catch (_) {}
      this._rtChannel = null;
      this._rtConnected = false;
    },

    // Debounce: 3s window where additional events don't queue extra
    // refreshes. A bulk import that fires 50 events over 2 seconds
    // triggers exactly one refresh — not 50.
    scheduleRefresh() {
      if (this._refreshTimer) return;
      this._refreshTimer = setTimeout(async () => {
        this._refreshTimer = null;
        try { await this.refresh(); } catch (e) { console.warn('[home] bg refresh:', e); }
      }, 3000);
    },

    bindVisibility() {
      if (this._visBound) return;
      this._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.unsubscribeRealtime();
        } else {
          // Re-subscribe if Home is the active view when we return
          const homeActive = document.querySelector('.view[data-view="home"]')?.classList.contains('active');
          if (homeActive) {
            this.subscribeRealtime();
            // May have missed events while hidden — pull fresh once
            this.refresh();
          }
        }
      });
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
          <!-- Library card — surfaces today's track + chapter from
               js/library.js. Mounts above the lede so it leads the
               morning ritual. Module fills this in async after the
               rest of Home renders. -->
          <div class="dcard-mount" id="libraryCardMount"></div>

          <h1 class="home-lede">
            ${esc(greeting)}<span class="home-lede-comma">,</span>
            <span class="home-lede-name">${esc(firstName)}.</span>
          </h1>

          <!-- v18.32 Home Rebuild — Today's Mission line. Replaces the
               static "Checking what's happening…" intro with a data-driven
               1-liner that summarizes daily state in 4-12 words. Filled
               in by loadTodayMission() after data lands. -->
          <p class="home-intro" id="homeIntro">
            <span class="home-intro-skel">···</span>
          </p>

          <!-- v18.32 Home Rebuild — Daily Operations card. Two pills:
               Daily Log status (today's submission state) + Biweekly
               Review countdown (days until next due). Most-tapped new
               surfaces, deserve top-of-page placement. -->
          <div class="home-ops" id="homeOps">
            <button class="home-ops-pill" data-ops="daily" type="button">
              <span class="home-ops-eyebrow">DAILY LOG</span>
              <span class="home-ops-state" id="homeOpsDailyState">···</span>
              <span class="home-ops-arrow">→</span>
            </button>
            <button class="home-ops-pill" data-ops="biweekly" type="button">
              <span class="home-ops-eyebrow">BIWEEKLY</span>
              <span class="home-ops-state" id="homeOpsBiweeklyState">···</span>
              <span class="home-ops-arrow">→</span>
            </button>
          </div>

          <!-- STATS — moved above the fold. Most-tapped surface,
               so it should be visible without scrolling. -->
          <div class="home-glance" id="homeGlance">
            ${['tickets','overdue','services','nodes'].map(k => `
              <button class="nx-stat" data-stat="${k}">
                <span class="nx-stat-num is-loading">—</span>
                <span class="nx-stat-label">${labelFor(k)}</span>
              </button>
            `).join('')}
          </div>

          <!-- v18.32 Home Rebuild — Vendor Watch. Hidden by default;
               loadVendorWatch() populates and reveals only when vendors
               have open work orders awaiting your action (quotes, parts
               waits, overdue contacts). One-tap call buttons. -->
          <section class="home-vendor-watch" id="homeVendorWatch" hidden>
            <h2 class="nx-section">
              <span class="nx-section-title">Vendor watch</span>
            </h2>
            <div class="home-vendor-list" id="homeVendorList"></div>
          </section>

          <h2 class="nx-section">
            <span class="nx-section-title">Today</span>
          </h2>
          <div class="home-feed" id="homeFeed">
            <div class="home-skeleton"></div>
            <div class="home-skeleton"></div>
            <div class="home-skeleton"></div>
          </div>

          <h2 class="nx-section">
            <span class="nx-section-title">On the books</span>
          </h2>
          <div class="home-cal" id="homeCal">
            <div class="home-skeleton home-skeleton-cal"></div>
            <div class="home-skeleton home-skeleton-cal"></div>
          </div>
          <div class="home-cal-viewall-row">
            <button class="nx-pill nx-pill--quiet nx-pill--sm" id="homeCalView">
              View full calendar →
            </button>
          </div>

          <button class="home-ask" id="homeAsk" type="button" aria-label="Ask NEXUS — open AI chat">
            <span class="home-ask-prompt">
              <svg class="home-ask-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
              Ask NEXUS
            </span>
            <span class="home-ask-hint" id="homeAskHint"></span>
          </button>
        </div>
      `;

      // Mount the library card. Module handles its own loading,
      // generation, error states. Fire-and-forget — Home keeps rendering
      // even if the library is slow or fails.
      try {
        const libMount = document.getElementById('libraryCardMount');
        if (libMount && NX.library && typeof NX.library.mount === 'function') {
          NX.library.mount(libMount);
        }
      } catch (e) { console.warn('[home] library mount failed', e); }

      // Cycle through example prompt previews under the Ask pill.
      // Gives users an idea of what they can ask without taking up
      // visual real estate. Text swap is driven by the CSS animation's
      // `animationiteration` event — this fires at the END of each
      // 4s cycle, when the hint has just faded out. Swapping at that
      // exact moment means text never changes mid-fade (the previous
      // setInterval-based version drifted against the CSS clock).
      const askHint = document.getElementById('homeAskHint');
      if (askHint) {
        const examples = [
          'about overdue equipment',
          'how was last week',
          'what to plan tomorrow',
          'about a contractor',
          'for the day\'s priorities',
        ];
        let idx = 0;
        // Initial paint
        askHint.textContent = examples[idx];
        idx = (idx + 1) % examples.length;
        // Swap on every animation cycle end
        const onIter = () => {
          askHint.textContent = examples[idx];
          idx = (idx + 1) % examples.length;
        };
        askHint.addEventListener('animationiteration', onIter);
        // Pause on press — user is about to tap; hold the current hint
        const askBtn = document.getElementById('homeAsk');
        if (askBtn) {
          const pause = () => askHint.style.animationPlayState = 'paused';
          askBtn.addEventListener('mouseenter', pause);
          askBtn.addEventListener('touchstart', pause, { passive: true });
        }
      }
      // v18.32 Home Rebuild — wire Daily Operations pill taps.
      // Daily → daily-log view, Biweekly → biweekly view. Uses the same
      // switchTo helper everything else uses.
      const opsDaily = el.querySelector('[data-ops="daily"]');
      if (opsDaily) opsDaily.addEventListener('click', () => NX.switchTo?.('daily-log'));
      const opsBiweekly = el.querySelector('[data-ops="biweekly"]');
      if (opsBiweekly) opsBiweekly.addEventListener('click', () => NX.switchTo?.('biweekly'));
    },

    async refresh() {
      await Promise.all([
        this.loadFeed(),
        this.loadCalendar(),
        this.loadGlance(),
        // v18.32 Home Rebuild — new data sources
        this.loadDailyOps(),
        this.loadVendorWatch(),
      ]);
      // Today's Mission summarizes state from whatever the other loaders
      // populated — runs LAST so it can read their freshest state.
      try { this.loadTodayMission(); } catch (e) { console.warn('[home] mission summary failed:', e); }
      this._lastRefresh = Date.now();
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
              <span class="nx-pill nx-pill--secondary nx-pill--sm">Review equipment →</span>
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
        events.forEach(e => pushItem(e.event_date, {
          ...e,
          contractor_name: stripEmoji(e.contractor_name),
          description: stripEmoji(e.description),
          _kind: 'event',
        }));
        cards.forEach(c => {
          pushItem(c.due_date, {
            _kind: 'card',
            id: c.id,
            contractor_name: stripEmoji(c.title) || 'Task',
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
        const btn = document.querySelector(`.nx-stat[data-stat="${k}"]`);
        if (!btn) return;
        const num = btn.querySelector('.nx-stat-num');
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
        num.classList.remove('is-loading');
        if (k === 'overdue' && typeof v === 'number' && v > 0) {
          num.classList.add('is-alert');
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
      document.querySelectorAll('.nx-stat').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.stat;
          statRoutes[k]?.();
        });
      });
    },

    /* THE COIN — moved to app.js setupMasthead() in Stage U.
       The coin now lives in the persistent top masthead rather than
       inside the home view, so its lifecycle is owned by app.js.
       Public API: NX.coin.{pulse, idle, flip} and NX.homeGalaxyPulse
       (alias for backward compat with ~7 callers across the app). */


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

    /* ═════════════ v18.32 — DAILY OPERATIONS ═════════════════════════
       Loads today's daily log + biweekly review state and updates the
       two pills above the glance tiles. Both queries are scoped to the
       current user. The pills render with skeletons until this lands. */
    async loadDailyOps() {
      if (!NX.sb) return;
      const today = new Date().toISOString().slice(0, 10);
      const userId = NX.currentUser?.id;

      try {
        // Daily log for today (scoped to user)
        let dailyQ = NX.sb.from('facility_logs')
          .select('id, log_date, drive_upload_status, submitted_at, drive_uploaded_at, data')
          .eq('log_type', 'daily')
          .eq('log_date', today)
          .order('id', { ascending: false })
          .limit(1);
        if (userId) dailyQ = dailyQ.eq('created_by', userId);
        const { data: dailyRows } = await dailyQ;
        const daily = dailyRows && dailyRows[0];
        this._dailyState = formatDailyState(daily);
        const dailyEl = document.getElementById('homeOpsDailyState');
        if (dailyEl) dailyEl.textContent = this._dailyState.label;
      } catch (e) {
        console.warn('[home] loadDailyOps daily failed:', e.message);
        this._dailyState = { label: 'Tap to start', tone: 'idle' };
        const dailyEl = document.getElementById('homeOpsDailyState');
        if (dailyEl) dailyEl.textContent = 'Tap to start';
      }

      try {
        // Most recent biweekly review (scoped to user)
        let bwQ = NX.sb.from('facility_logs')
          .select('id, log_date, submitted_at, drive_upload_status')
          .eq('log_type', 'biweekly')
          .order('log_date', { ascending: false })
          .limit(1);
        if (userId) bwQ = bwQ.eq('created_by', userId);
        const { data: bwRows } = await bwQ;
        const last = bwRows && bwRows[0];
        this._biweeklyState = formatBiweeklyState(last);
        const bwEl = document.getElementById('homeOpsBiweeklyState');
        if (bwEl) bwEl.textContent = this._biweeklyState.label;
      } catch (e) {
        console.warn('[home] loadDailyOps biweekly failed:', e.message);
        this._biweeklyState = { label: 'Tap to open', tone: 'idle' };
        const bwEl = document.getElementById('homeOpsBiweeklyState');
        if (bwEl) bwEl.textContent = 'Tap to open';
      }
    },

    /* ═════════════ v18.32 — VENDOR WATCH ═════════════════════════════
       Surfaces vendors with open work orders awaiting your attention.
       Renders only when there's something to show — otherwise the
       whole section stays hidden. Top 3 by urgency (waiting longest).
       Reads from equipment_issues + vendors. Tolerates missing R&M
       schema by degrading silently to hidden. */
    async loadVendorWatch() {
      if (!NX.sb) return;
      const sectionEl = document.getElementById('homeVendorWatch');
      const listEl    = document.getElementById('homeVendorList');
      if (!sectionEl || !listEl) return;

      try {
        // Pull issues with a vendor assigned, in actionable states.
        // "Actionable" = waiting on the user (quote approval) or
        // stuck (awaiting_parts, awaiting_invoice for too long).
        const ATTENTION_STATUSES = ['awaiting_quote', 'quote_approved', 'awaiting_parts', 'awaiting_invoice'];
        const { data: issues, error } = await NX.sb.from('equipment_issues')
          .select('id, vendor_id, title, status, priority, reported_at')
          .not('vendor_id', 'is', null)
          .in('status', ATTENTION_STATUSES)
          .order('reported_at', { ascending: true })   // oldest first
          .limit(20);
        if (error) {
          // Tables might not exist — degrade quietly.
          sectionEl.hidden = true;
          return;
        }
        if (!issues || !issues.length) {
          sectionEl.hidden = true;
          return;
        }

        // Group by vendor — show ONE row per vendor (their oldest)
        const seenVendors = new Set();
        const pickedIssues = [];
        for (const i of issues) {
          if (seenVendors.has(i.vendor_id)) continue;
          seenVendors.add(i.vendor_id);
          pickedIssues.push(i);
          if (pickedIssues.length >= 3) break;
        }

        // Hydrate vendor names + phones
        const vendorIds = pickedIssues.map(i => i.vendor_id);
        const { data: vendors } = await NX.sb.from('vendors')
          .select('id, name, company, phone')
          .in('id', vendorIds);
        const vendorById = {};
        (vendors || []).forEach(v => { vendorById[v.id] = v; });

        // Render
        listEl.innerHTML = pickedIssues.map(i => {
          const v = vendorById[i.vendor_id] || {};
          const name = v.company || v.name || '(unknown vendor)';
          const days = Math.floor((Date.now() - new Date(i.reported_at).getTime()) / 86400000);
          const ageText = days < 1 ? 'today' : days === 1 ? '1 day' : `${days} days`;
          const statusLabel = (i.status || '').replace(/_/g, ' ');
          const phoneHref = v.phone ? `tel:${String(v.phone).replace(/[^\d+]/g, '')}` : null;
          return `
            <div class="home-vendor-row">
              <div class="home-vendor-row-main">
                <div class="home-vendor-row-name">${esc(name)}</div>
                <div class="home-vendor-row-meta">
                  <span class="home-vendor-row-status">${esc(statusLabel)}</span>
                  <span class="home-vendor-row-age">${esc(ageText)}</span>
                </div>
                <div class="home-vendor-row-title">${esc((i.title || 'Untitled issue').slice(0, 60))}</div>
              </div>
              ${phoneHref ? `<a class="home-vendor-row-call" href="${phoneHref}" aria-label="Call ${esc(name)}">📞</a>` : ''}
            </div>`;
        }).join('');
        sectionEl.hidden = false;
        this._vendorWatchCount = pickedIssues.length;
      } catch (e) {
        console.warn('[home] loadVendorWatch failed:', e.message);
        sectionEl.hidden = true;
        this._vendorWatchCount = 0;
      }
    },

    /* ═════════════ v18.32 — TODAY'S MISSION ═════════════════════════
       Synthesizes a 1-line summary of the day's state from whatever
       the other loaders populated. Runs LAST in refresh(), so it can
       read the freshest counts/state. Reads three signals:
         • Daily log state ("submitted" / "draft" / "not started")
         • Open ticket count (from the glance tiles, already loaded)
         • Vendor watch count (action-needed vendors)
       Falls back to a generic "Checking…" line if data isn't ready. */
    loadTodayMission() {
      const introEl = document.getElementById('homeIntro');
      if (!introEl) return;

      const parts = [];

      // Daily log status — always include
      if (this._dailyState && this._dailyState.label) {
        parts.push(this._dailyState.label);
      }

      // Open tickets — pull from the glance tile's current text
      const ticketsBtn = document.querySelector('.nx-stat[data-stat="tickets"] .nx-stat-num');
      if (ticketsBtn && !ticketsBtn.classList.contains('is-loading')) {
        const n = parseInt(ticketsBtn.textContent.replace(/,/g, ''), 10);
        if (!isNaN(n)) {
          if (n === 0) parts.push('no open tickets');
          else if (n === 1) parts.push('1 open ticket');
          else parts.push(`${n} open tickets`);
        }
      }

      // Overdue PMs — same pull
      const overdueBtn = document.querySelector('.nx-stat[data-stat="overdue"] .nx-stat-num');
      if (overdueBtn && !overdueBtn.classList.contains('is-loading')) {
        const n = parseInt(overdueBtn.textContent.replace(/,/g, ''), 10);
        if (!isNaN(n) && n > 0) {
          parts.push(`${n} PM${n === 1 ? '' : 's'} overdue`);
        }
      }

      // Vendor watch — only if non-zero
      if (this._vendorWatchCount > 0) {
        parts.push(`${this._vendorWatchCount} vendor${this._vendorWatchCount === 1 ? '' : 's'} need a touch`);
      }

      if (!parts.length) {
        introEl.textContent = 'Checking what\'s happening across the restaurants…';
        return;
      }
      // Capitalize the first character of the first part
      parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      introEl.textContent = parts.join(' · ');
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

  // ─── Emoji sanitizer ──────────────────────────────────────────────
  // Strips pictographic emoji from upstream data (process-emails tags
  // like the urgency prefixes that upstream importers inject) so
  // Home renders cleanly per UI-UX-CRITERIA §15 banned-pattern #6.
  // Keeps editorial glyphs: ◇ ◎ ◆ ○ ● ★ ☆ ☐ ☑ ✓ ✕ ✗ ✦ → ← ▼ ▲ · — …
  // Strips: every pictorial emoji (siren, wrench, warning, etc.)
  function stripEmoji(s) {
    if (s == null) return '';
    return String(s)
      // Pictographic supplementary planes — Misc Symbols & Pictographs,
      // Supplemental Symbols & Pictographs, Transport, Symbols Extended-A,
      // and regional indicators (flags).
      .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
      // Dingbats (2700-27BF) — preserve specific editorial glyphs.
      .replace(/[\u{2700}-\u{27BF}]/gu, (m) => {
        const cp = m.codePointAt(0);
        return (cp === 0x2713 || cp === 0x2715 || cp === 0x2717 ||
                cp === 0x2726) ? m : '';
      })
      // Misc Symbols (2600-26FF) — preserve geometric shapes only.
      .replace(/[\u{2600}-\u{26FF}]/gu, (m) => {
        const cp = m.codePointAt(0);
        return (cp === 0x2605 || cp === 0x2606 ||
                cp === 0x2610 || cp === 0x2611) ? m : '';
      })
      .replace(/\uFE0F/g, '')   // VS-16 (emoji presentation selector)
      .replace(/\u200D/g, '')   // ZWJ joiner (used by compound emoji)
      .replace(/\s{2,}/g, ' ')
      .trim();
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

  /* ═════════════ v18.32 Home Rebuild — Ops pill formatters ════════════
     Pure functions: take a Supabase row (or null) and return a small
     { label, tone } object describing the human-readable state.
     The pill DOM is updated separately — these are just the formatters. */

  function formatDailyState(row) {
    if (!row) {
      return { label: 'Not started · tap to begin', tone: 'idle' };
    }
    // Drive upload status > submitted_at > draft. Each maps to a
    // different display:
    //   • uploaded → "Submitted 9:14am · 3 vendor calls"
    //   • submitted_at set but no Drive → "Submitted · awaiting upload"
    //   • neither → "Draft saved 14m ago"
    if (row.drive_upload_status === 'uploaded' && row.drive_uploaded_at) {
      const t = new Date(row.drive_uploaded_at);
      const timeStr = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
      // Try to surface vendor-calls count from data.locations[*].vendor_calls
      let vcCount = 0;
      try {
        (row.data && row.data.locations || []).forEach(loc => {
          vcCount += (loc.vendor_calls || []).length;
        });
      } catch (_) {}
      const extra = vcCount ? ` · ${vcCount} vendor call${vcCount === 1 ? '' : 's'}` : '';
      return { label: `Submitted ${timeStr}${extra}`, tone: 'done' };
    }
    if (row.submitted_at) {
      return { label: 'Submitted · awaiting upload', tone: 'pending' };
    }
    // Draft — show "saved Xm ago" relative time
    const updatedIso = row.updated_at || row.submitted_at || null;
    if (updatedIso) {
      const mins = Math.floor((Date.now() - new Date(updatedIso).getTime()) / 60000);
      const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
      return { label: `Draft saved ${rel}`, tone: 'draft' };
    }
    return { label: 'In progress', tone: 'draft' };
  }

  function formatBiweeklyState(row) {
    // Biweekly cadence is 14 days. State depends on time since last
    // submission:
    //   • No prior review → "Not started · tap to begin"
    //   • Submitted within last day → "Submitted [date]"
    //   • <14 days since last → "Next due in N days"
    //   • 14+ days since last → "Due now · tap to open"
    if (!row) {
      return { label: 'Not started · tap to begin', tone: 'idle' };
    }
    const lastDate = row.log_date || (row.submitted_at && row.submitted_at.slice(0, 10));
    if (!lastDate) {
      return { label: 'Tap to open', tone: 'idle' };
    }
    const daysSince = Math.floor((Date.now() - new Date(lastDate + 'T12:00:00').getTime()) / 86400000);
    if (daysSince <= 1) {
      const friendly = new Date(lastDate + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
      return { label: `Submitted ${friendly}`, tone: 'done' };
    }
    const daysLeft = 14 - daysSince;
    if (daysLeft > 1) {
      return { label: `Next due in ${daysLeft} days`, tone: 'idle' };
    }
    if (daysLeft === 1) {
      return { label: 'Due tomorrow', tone: 'pending' };
    }
    if (daysLeft === 0) {
      return { label: 'Due today', tone: 'pending' };
    }
    return { label: `Overdue by ${Math.abs(daysLeft)} days`, tone: 'overdue' };
  }

  /* ═════════════════════════════════════════════════════════════════
     PRIORITY COLLECTION — each returns 0..N candidate items.
     Final list is capped at 3 by severity weight.
     ═════════════════════════════════════════════════════════════════ */
  async function collectPriorityItems() {
    if (!NX.sb) return [];
    const candidates = [];

    // ─── PM SCHEDULE SYNC ─────────────────────────────────────────
    // Sweep pm_schedules looking for any active schedule whose
    // next_due_at is past today. For each that doesn't already have
    // an open board card, create one. Throttled inside the domain
    // layer to once per hour per session. Fire-and-forget — admin
    // sees the cards on the board next time they look, and overdue
    // PMs continue to surface through the `equipment.next_pm_date`
    // query below.
    if (NX.currentUser?.role === 'admin' && NX.domain?.checkPMsDue) {
      NX.domain.checkPMsDue().catch(e => {
        console.warn('[home] checkPMsDue hook failed (non-fatal):', e);
      });
    }

    // ─── OVERDUE PMs
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: overdueList } = await NX.sb.from('equipment')
        .select('id, name, location, area, next_pm_date, service_contractor_name')
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
          : `Preventative maintenance overdue ${days} day${days === 1 ? '' : 's'}.${worst.service_contractor_name ? ` Usually serviced by ${worst.service_contractor_name}.` : ''}`;
        candidates.push({
          tone: 'overdue',
          severity: 100 + days, // older = more severe
          title: `${stripEmoji(worst.name)}${worst.location ? ' · ' + titleCase(worst.location) : ''}`,
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
          title: stripEmoji(ev.contractor_name) || 'Contractor visit',
          location: ev.location,
          description: stripEmoji(ev.description),
          date: ev.event_date,
        });
      });
      (cardsResp.data || []).forEach(c => {
        merged.push({
          kind: 'card',
          when: formatEventWhen(c.due_date, null),
          title: stripEmoji(c.title) || 'Task',
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

    // v18.32 Home Rebuild — ─── CHRONIC TICKETS — open > 2 weeks ────
    // Long-running open tickets are a signal of something getting stuck.
    // We bubble them up as a single candidate so they don't crowd out
    // urgent items but stay visible across the typical user's eyeline.
    try {
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data: chronic } = await NX.sb.from('tickets')
        .select('id, title, location, priority, created_at')
        .not('status', 'in', '("closed","resolved","done")')
        .lt('created_at', twoWeeksAgo)
        .order('created_at', { ascending: true })
        .limit(10);
      if (chronic?.length) {
        const oldest = chronic[0];
        const days = Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86400000);
        const n = chronic.length;
        const title = n === 1
          ? `Chronic: ${stripTicketPrefix(oldest.title).slice(0, 60)}`
          : `${n} chronic tickets`;
        const body = n === 1
          ? `Open for ${days} days${oldest.location ? ' at ' + titleCase(oldest.location) : ''}. Worth a touch.`
          : `Oldest open ${days} days. Address before the next biweekly review.`;
        candidates.push({
          tone: 'overdue',
          severity: 70 + Math.min(days / 7, 10),  // grow severity with age, capped
          title,
          body,
          actionLabel: 'See tickets',
          onClick: () => NX.switchTo?.('log'),
        });
      }
    } catch (e) { console.warn('[home] chronic tickets fetch failed:', e.message); }

    // v18.32 Home Rebuild — ─── DAILY LOG NOT STARTED (after 2pm) ────
    // If it's afternoon and the user hasn't started today's daily log,
    // bubble that up. Lower severity than urgent items — but a real
    // nudge that the day's record-keeping is slipping.
    try {
      const now = new Date();
      if (now.getHours() >= 14) {  // 2pm or later
        const todayISO = now.toISOString().slice(0, 10);
        const userId = NX.currentUser?.id;
        let q = NX.sb.from('facility_logs')
          .select('id, submitted_at, drive_upload_status')
          .eq('log_type', 'daily')
          .eq('log_date', todayISO)
          .limit(1);
        if (userId) q = q.eq('created_by', userId);
        const { data: existing } = await q;
        if (!existing || !existing.length) {
          // No row at all → not started
          candidates.push({
            tone: 'reported',
            severity: 60,
            title: 'Daily log not started',
            body: 'Today\'s facility log hasn\'t been opened yet. Quick entry now keeps the trail current.',
            actionLabel: 'Open daily log',
            onClick: () => NX.switchTo?.('daily-log'),
          });
        }
      }
    } catch (e) { console.warn('[home] daily log check failed:', e.message); }

    // Sort by severity, take top 3
    candidates.sort((a, b) => (b.severity || 0) - (a.severity || 0));
    return candidates.slice(0, 3);
  }

  function stripTicketPrefix(title) {
    if (!title) return '';
    // Strip emoji first (upstream importers inject urgency/category prefixes
    // labels into ticket titles), then editorial bracket prefixes.
    const cleaned = stripEmoji(title);
    return cleaned.replace(/^\[(Equipment|CALL|Ticket)\]\s*/i, '').replace(/^[^:]+:\s*/, (m) => {
      // Keep the actual issue description, drop "Hot Expo Low Boy: " prefix
      return '';
    }) || cleaned;
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
  // Format a calendar-row date label: always uses the abbreviated day
  // name + month/day, e.g. "WED · MAY 3", "FRI · APR 24". Special-case
  // labels like TODAY/TOMORROW/YESTERDAY are NOT used here — they go
  // in relativeDayLabel below so the column width stays consistent.
  // The + 'T12:00:00' suffix sidesteps timezone-at-midnight bugs that
  // otherwise shift dates.
  function formatCalDate(isoDate, _isTodayUnused) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T12:00:00');
    const weekdays = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return `${weekdays[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
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
  // Relative-time label for the rel-slot under the date. Carries the
  // "today" / "tomorrow" / "yesterday" semantics that used to live in
  // formatCalDate, plus longer-range labels for further-out dates.
  // For today, returns '' — the gold pulsing dot + gold date color
  // already communicate "today" without needing the word.
  function relativeDayLabel(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T12:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff ===  0) return '';                  // dot says "today" already
    if (diff ===  1) return 'TOMORROW';
    if (diff === -1) return 'YESTERDAY';
    if (diff > 1 && diff <= 7)  return `IN ${diff} DAYS`;
    if (diff > 7 && diff <= 14) return 'NEXT WEEK';
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
    if (s === 'pending')                     return { key: 'pending',   label: 'Pending',   icon: '◷' };
    if (isPast)                              return { key: 'past',      label: 'Past',      icon: '' };
    return { key: 'scheduled', label: 'Scheduled', icon: '' };
  }

  // Accent bar color by status. Returns CSS var() references so themes
  // follow tokens automatically. The completed-event green was previously
  // a literal #6b9b6b (kelly green) — banned by criteria §6.1; now uses
  // the system's olive-bronze --nx-green.
  function statusColor(status) {
    const key = status?.key || 'scheduled';
    return ({
      completed: 'var(--nx-green)',
      confirmed: 'var(--nx-gold)',
      pending:   'var(--nx-gold-line-2)',
      scheduled: 'var(--nx-gold-line-3)',
      past:      'var(--nx-faintest)',
    })[key] || 'var(--nx-gold-line-3)';
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
