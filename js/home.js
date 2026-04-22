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

      // Date line: "WEDNESDAY · APRIL 22 · 6:47 AM"
      const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
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
            <div class="home-feed-calm">
              <span class="home-feed-calm-mark">◇</span>
              <div class="home-feed-calm-text">
                Nothing urgent this morning. All equipment current, no overnight tickets, contractors on schedule.
              </div>
            </div>
          `;
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

        const { data: events, error } = await NX.sb.from('contractor_events')
          .select('id, contractor_name, event_date, event_time, description, location, status')
          .gte('event_date', pastBound)
          .lte('event_date', futureBound)
          .neq('status', 'cancelled')
          .order('event_date', { ascending: true })
          .order('event_time', { ascending: true })
          .limit(60);

        if (error) throw error;

        // Bucket events into a day-keyed map
        const byDate = new Map();
        (events || []).forEach(e => {
          if (!byDate.has(e.event_date)) byDate.set(e.event_date, []);
          byDate.get(e.event_date).push(e);
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

        // Degenerate case: only today with no items and no past/future context
        const hasAnyEvents = (events || []).length > 0;
        if (!hasAnyEvents) {
          calEl.innerHTML = `
            <div class="home-cal-empty-all">
              Nothing on the contractor calendar for the next few weeks. <br>
              Email ingestion will add visits as they're confirmed.
            </div>
          `;
          return;
        }

        calEl.innerHTML = days.map(day => {
          const isToday  = day.relative === 'today';
          const isPast   = day.relative === 'past';
          const dateLabel = formatCalDate(day.date, isToday);

          const itemsHtml = day.items.length === 0
            ? `<div class="home-cal-empty">No visits scheduled.</div>`
            : day.items.map(e => {
                const timeStr = e.event_time ? formatTime12(e.event_time) : 'all day';
                const titleBits = [e.contractor_name, e.location && titleCase(e.location)].filter(Boolean);
                const title = titleBits.join(' · ') || 'Scheduled visit';
                return `
                  <button class="home-cal-item" data-event-id="${esc(e.id)}" type="button">
                    <span class="home-cal-time">${esc(timeStr)}</span>
                    <span class="home-cal-body">
                      <span class="home-cal-title">${esc(title)}</span>
                      ${e.description ? `<span class="home-cal-desc">${esc(e.description).slice(0, 80)}</span>` : ''}
                    </span>
                  </button>
                `;
              }).join('');

          return `
            <div class="home-cal-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}">
              <div class="home-cal-date">
                ${isToday ? '<span class="home-cal-today-dot"></span>' : ''}
                <span>${esc(dateLabel)}</span>
              </div>
              <div class="home-cal-items">${itemsHtml}</div>
            </div>
          `;
        }).join('');

        // Wire item taps to the calendar view (full detail lives there)
        calEl.querySelectorAll('.home-cal-item').forEach(btn => {
          btn.addEventListener('click', () => NX.switchTo?.('cal'));
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
    // A fidget-worthy micro-galaxy, ~22px, always alive. It's pure canvas,
    // ~60 FPS but visually slow so it reads as confident, not jittery.
    // Tap it → switch to the full brain view so the user "opens the hood".
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

      // 10 nodes at varied radii. Small prime offsets so they never quite
      // line up — gives it that organic "system running" quality.
      const nodes = Array.from({ length: 10 }, (_, i) => ({
        r: 2.2 + (i % 4) * 1.6 + Math.random() * 0.8,
        theta: (i * 36 * Math.PI / 180) + Math.random() * 0.6,
        speed: 0.0005 + (i % 3) * 0.00025,   // rad/ms, very slow
        size: 0.8 + Math.random() * 0.6,
        alpha: 0.35 + Math.random() * 0.45,
      }));

      // One "central" node, slightly brighter
      const core = { size: 1.3, alpha: 0.85 };

      let running = true;
      let lastT = performance.now();

      function frame(t) {
        if (!running) return;
        const dt = t - lastT;
        lastT = t;

        ctx.clearRect(0, 0, size, size);

        // Very faint radial glow
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
        grad.addColorStop(0, 'rgba(212, 164, 78, 0.12)');
        grad.addColorStop(0.7, 'rgba(212, 164, 78, 0.02)');
        grad.addColorStop(1, 'rgba(212, 164, 78, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Orbiting nodes
        for (const n of nodes) {
          n.theta += n.speed * dt;
          const x = cx + Math.cos(n.theta) * n.r;
          const y = cy + Math.sin(n.theta) * n.r;
          ctx.fillStyle = `rgba(237, 233, 224, ${n.alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(x, y, n.size, 0, Math.PI * 2);
          ctx.fill();
        }

        // Core — warm gold
        ctx.fillStyle = `rgba(212, 164, 78, ${core.alpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, core.size, 0, Math.PI * 2);
        ctx.fill();

        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      // Pause when tab hidden to save battery
      document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        if (running) { lastT = performance.now(); requestAnimationFrame(frame); }
      });

      wrap.addEventListener('click', () => {
        // Open the full galaxy view
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

    // ─── INCOMING — contractor events in next 48h
    try {
      const today = new Date().toISOString().slice(0, 10);
      const twoDays = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 10);
      const { data: events } = await NX.sb.from('contractor_events')
        .select('id, contractor_name, event_date, event_time, description, location, status')
        .gte('event_date', today)
        .lte('event_date', twoDays)
        .neq('status', 'cancelled')
        .order('event_date', { ascending: true })
        .order('event_time', { ascending: true })
        .limit(5);
      if (events?.length) {
        const ev = events[0];
        const when = formatEventWhen(ev.event_date, ev.event_time);
        const others = events.length - 1;
        const body = others > 0
          ? `${when}${ev.location ? ' at ' + titleCase(ev.location) : ''}${ev.description ? ' for ' + ev.description : ''}. ${others} other visit${others === 1 ? '' : 's'} coming up.`
          : `${when}${ev.location ? ' at ' + titleCase(ev.location) : ''}${ev.description ? ' for ' + ev.description : '.'}`;
        candidates.push({
          tone: 'incoming',
          severity: 40,
          title: ev.contractor_name || 'Contractor visit',
          body,
          actionLabel: 'View calendar',
          onClick: () => NX.switchTo?.('cal'),
        });
      }
    } catch (e) { console.warn('[home] events fetch failed:', e.message); }

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
