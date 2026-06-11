/* ════════════════════════════════════════════════════════════════════
   NEXUS DOMAIN LAYER — Cross-Module Business Event Orchestration
   v2 (May 2026) — Priorities 1-3 added per architecture audit
   ════════════════════════════════════════════════════════════════════

   THIS FILE EXISTS BECAUSE:

   Real-world business events have effects across multiple modules:

       PM scan submitted   → pm_logs + equipment stamp + kanban card +
                             brain sync
       PM scan approved    → archive review card + brain sync
       PM scheduled is due → kanban card created for the work
       Equipment issue     → kanban card created + linked back via labels
       Issue card → done   → equipment_issues marked repaired
       Dispatch event      → linked back to open kanban card

   Instead of scattering those effects across UI handlers, each
   business event has ONE function in this file that orchestrates the
   downstream writes. Each handler does the PRIMARY write (insert the
   row that fired the event) and then calls the domain function for
   the ripples.

   ────────────────────────────────────────────────────────────────────

   REGISTERED EVENTS

     PM SUBMITTED          NX.domain.recordPMScan
     PM APPROVED           NX.domain.approvePM
     PM REJECTED / SPAM    NX.domain.rejectPM
     PMs DUE TODAY         NX.domain.checkPMsDue            (Priority 1)
     ISSUE CREATED         NX.domain.recordEquipmentIssue   (Priority 2)
     ISSUE CARD → DONE     NX.domain.resolveEquipmentIssue  (Priority 2)
     DISPATCH FIRED        NX.domain.recordDispatch         (Priority 3)

   ────────────────────────────────────────────────────────────────────

   RULES (don't violate without thought):

   • Domain functions do DATABASE WRITES only — never DOM, never toast,
     never alert. Caller handles UI.
   • Each effect is wrapped try/catch with console.warn. One failure
     never aborts the others.
   • Optional module APIs are checked with `?.` before being called.
   • Idempotency: each function either checks for an existing target
     row first, or relies on a sentinel field (labels.issue:UUID,
     dispatch_event_id, etc.) to avoid duplicates.

   SCHEMA NOTES:

   • kanban tables: 'boards' + 'board_lists' + 'kanban_cards'
     (only the cards table has the kanban_ prefix — legacy quirk)
   • kanban_cards.labels is jsonb (array stored as JSON, not text[])
   • Sentinel labels we use to mark a card's origin/link:
       'pm-review'       — auto-created by recordPMScan
       'pm-due'          — auto-created by checkPMsDue
       'equipment-issue' — auto-created by recordEquipmentIssue
       'sched:<uuid>'    — links to a pm_schedules row
       'issue:<uuid>'    — links to an equipment_issues row
       'dispatch:<uuid>' — links to a dispatch_events row

   ════════════════════════════════════════════════════════════════════ */

(function(){
  if (!window.NX) window.NX = {};
  const D = window.NX.domain = window.NX.domain || {};

  // Throttle for checkPMsDue — don't recompute more than once an hour
  // per browser session. The function is safe to call repeatedly but
  // recomputing burns Supabase quota.
  let _lastPMCheckAt = 0;
  const PM_CHECK_INTERVAL_MS = 60 * 60 * 1000;   // 1 hour


  // ════════════════════════════════════════════════════════════════════
  // EVENT: PM log was submitted via public QR scan
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  equipment-public-pm.js → submitPmLog() after pm_logs INSERT
  // EFFECTS:   stamp equipment, create review board card, brain sync
  //
  D.recordPMScan = async function({ equipmentIds, pmLogIds, contractor }) {
    if (!Array.isArray(equipmentIds) || !equipmentIds.length) return;
    if (!NX.sb) return;

    for (const eqId of equipmentIds) {
      try {
        await NX.sb.from('equipment')
          .update({ last_pm_submitted_at: new Date().toISOString() })
          .eq('id', eqId);
      } catch (_) { /* column may not exist — pm_logs.submitted_at is still authoritative */ }

      try {
        await autoCreateReviewCard(eqId, contractor);
      } catch (e) {
        console.warn('[domain.recordPMScan] card create skipped:', e?.message || e);
      }

      try {
        if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(eqId);
      } catch (_) {}
    }
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: admin approved a PM log
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  equipment.js → approvePmLog()
  // EFFECTS:   archive auto-created review cards, brain sync
  //
  D.approvePM = async function({ pmLogId, equipmentId }) {
    if (!NX.sb || !equipmentId) return;
    try { await archiveCardsByLabel(equipmentId, 'pm-review'); }
    catch (e) { console.warn('[domain.approvePM] card archive skipped:', e?.message || e); }
    try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: admin rejected or spammed a PM log
  // ════════════════════════════════════════════════════════════════════
  //
  D.rejectPM = async function({ pmLogId, equipmentId }) {
    if (!NX.sb || !equipmentId) return;
    try { await archiveCardsByLabel(equipmentId, 'pm-review'); }
    catch (e) { console.warn('[domain.rejectPM] card archive skipped:', e?.message || e); }
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: check which scheduled PMs are due, create board cards
  // (Priority 1 — wires pm_schedules → kanban_cards for the first time)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  home.js when admin loads home (throttled to 1×/hour)
  //            pm.js after schedule create/edit (immediate sync)
  //
  // EFFECTS:
  //   For each active pm_schedule with next_due_at <= today AND no
  //   open card with `sched:<id>` label, creates a board card.
  //
  // SCHEMA:
  //   - pm_schedules: id, equipment_id, title, frequency_days,
  //                   next_due_at, active, assigned_to
  //   - kanban_cards: labels include 'pm-due' + 'sched:<schedule_id>'
  //
  // IDEMPOTENCY:
  //   Cards labeled `sched:<schedule_id>` are checked for before
  //   creating. An archived card doesn't count — once the user closes
  //   the card, the NEXT cycle will create a fresh one when the
  //   schedule's next_due_at rolls over again.
  //
  // RETURNS:
  //   { checked, created, skipped } counts (caller can show toast/log)
  //   skipped = -1 means throttled (not yet 1 hour since last check)
  //
  D.checkPMsDue = async function({ force } = {}) {
    const result = { checked: 0, created: 0, skipped: 0 };
    if (!NX.sb) return result;

    const now = Date.now();
    if (!force && (now - _lastPMCheckAt) < PM_CHECK_INTERVAL_MS) {
      result.skipped = -1;
      return result;
    }
    _lastPMCheckAt = now;

    const todayISO = new Date().toISOString();
    let schedules;
    try {
      const { data } = await NX.sb.from('pm_schedules')
        .select('id, equipment_id, title, frequency_days, next_due_at, assigned_to')
        .eq('active', true)
        .lte('next_due_at', todayISO);
      schedules = data || [];
    } catch (e) {
      console.warn('[domain.checkPMsDue] load failed:', e?.message || e);
      return result;
    }
    result.checked = schedules.length;
    if (!schedules.length) return result;

    for (const s of schedules) {
      try {
        const exists = await hasOpenCardWithLabel(s.equipment_id, `sched:${s.id}`);
        if (exists) { result.skipped++; continue; }
        await autoCreatePMDueCard(s);
        result.created++;
      } catch (e) {
        console.warn('[domain.checkPMsDue] one schedule failed:', s.id, e?.message || e);
      }
    }
    return result;
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: a new equipment_issues row was created
  // (Priority 2 — wires equipment_issues → kanban_cards)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  equipment.js → promptNewIssue() after equipment_issues INSERT
  //
  // EFFECTS:
  //   Creates a board card for the issue. Card's labels array contains
  //   `issue:<issue_uuid>` so the reverse direction (card → done →
  //   mark issue repaired) can find the issue.
  //
  // RETURNS:   { statusProposal? }
  //   - statusProposal — if the new issue suggests an equipment.status
  //                      change (e.g., high-priority issue → 'down'),
  //                      caller can show a confirm() and call
  //                      applyEquipmentStatusChange.
  //
  D.recordEquipmentIssue = async function({ issueId, equipmentId, title, description, priority }) {
    const out = { statusProposal: null };
    if (!NX.sb || !equipmentId || !issueId) return out;
    try {
      await autoCreateIssueCard({
        issueId, equipmentId, title, description,
        priority: priority || 'high',
      });
    } catch (e) {
      console.warn('[domain.recordEquipmentIssue] card create failed:', e?.message || e);
    }
    try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}

    // Compute proposed equipment.status change (don't apply)
    out.statusProposal = await computeProposedEquipmentStatus({
      equipmentId,
      trigger: { type: 'issue_created', priority: priority || 'high', issueId },
    });
    return out;
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: an issue-linked card moved to done
  // (Priority 2 — wires kanban_cards → equipment_issues)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  board.js → moveCard() when movingToDone && wasNotDone
  //
  // EFFECTS:
  //   If the card has an `issue:<uuid>` label, marks that
  //   equipment_issues row as status='repaired' with the current time.
  //
  // PARAMS:
  //   card: full kanban_cards row (we read labels off it)
  //
  D.resolveEquipmentIssue = async function({ card }) {
    if (!NX.sb || !card) return;
    const issueId = extractIssueIdFromLabels(card.labels);
    if (!issueId) return;
    try {
      await NX.sb.from('equipment_issues').update({
        status: 'repaired',
        repaired_at: new Date().toISOString(),
      }).eq('id', issueId);
    } catch (e) {
      console.warn('[domain.resolveEquipmentIssue] mark repaired failed:', e?.message || e);
    }
    if (card.equipment_id) {
      try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(card.equipment_id); } catch (_) {}
    }
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: a contractor was dispatched (call/text/email)
  // (Priority 3 — fills in the dead kanban_cards.dispatch_event_id column)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  equipment.js after dispatch_events INSERT
  //            equipment-public-pm.js after dispatch_events INSERT
  //
  // EFFECTS:
  //   If the equipment has an open kanban_card without a dispatch
  //   already attached, sets dispatch_event_id and adds the
  //   `dispatch:<uuid>` label. Gives the card a back-link to
  //   "we called Joe's HVAC about this on Tuesday."
  //
  D.recordDispatch = async function({ equipmentId, dispatchEventId }) {
    if (!NX.sb || !equipmentId || !dispatchEventId) return;
    try {
      const { data: cards } = await NX.sb.from('kanban_cards')
        .select('id, labels, dispatch_event_id, last_status_change_at, created_at')
        .eq('equipment_id', equipmentId)
        .eq('archived', false)
        .is('dispatch_event_id', null)
        .order('last_status_change_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1);

      // Prefer attaching the call to an existing open card (the issue/PM
      // it's about) so we get "we called Joe's HVAC about this on Tuesday."
      if (cards && cards.length) {
        const card = cards[0];
        const labels = Array.isArray(card.labels) ? [...card.labels] : [];
        const sentinel = `dispatch:${dispatchEventId}`;
        if (!labels.includes(sentinel)) labels.push(sentinel);
        await NX.sb.from('kanban_cards').update({
          dispatch_event_id: dispatchEventId,
          labels,
        }).eq('id', card.id);
        return;
      }

      // No open card to attach to → create one so the call is tracked on the
      // board (a bare "called the vendor" still becomes a work item).
      await autoCreateDispatchCard({ equipmentId, dispatchEventId });
    } catch (e) {
      console.warn('[domain.recordDispatch] failed:', e?.message || e);
    }
  };

  // Create (or fold into) a board card representing an outbound contractor
  // contact. Mirrors autoCreateIssueCard's resilient-insert pattern. If an
  // open call-tracking card already exists for this unit, the new dispatch
  // is appended to it rather than spawning a duplicate.
  async function autoCreateDispatchCard({ equipmentId, dispatchEventId }) {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location').eq('id', equipmentId).maybeSingle();
    if (!eq) return null;

    let dispatch = null;
    try {
      const { data } = await NX.sb.from('dispatch_events').select('*').eq('id', dispatchEventId).maybeSingle();
      dispatch = data;
    } catch (_) {}

    // Fold into an existing open call card if there is one.
    try {
      const { data: openCards } = await NX.sb.from('kanban_cards')
        .select('id, labels').eq('equipment_id', equipmentId).eq('archived', false)
        .contains('labels', ['dispatch-call']).limit(1);
      if (openCards && openCards.length) {
        const c = openCards[0];
        const labels = Array.isArray(c.labels) ? [...c.labels] : [];
        const sentinel = `dispatch:${dispatchEventId}`;
        if (!labels.includes(sentinel)) labels.push(sentinel);
        await NX.sb.from('kanban_cards').update({ labels, dispatch_event_id: dispatchEventId }).eq('id', c.id);
        return c;
      }
    } catch (_) {}

    const target = await pickBoardTarget({ listHints: ['report', 'issue|broken', 'todo|to.do|backlog'] });
    if (!target) { console.warn('[domain.autoCreateDispatchCard] no board/list target'); return null; }

    const method = (dispatch && dispatch.method) || 'call';
    const who = (dispatch && dispatch.contractor_name) || 'contractor';
    const verb = method === 'text' ? 'Texted' : method === 'email' ? 'Emailed' : method === 'in_house' ? 'Dispatched (in-house)' : 'Called';
    const desc = `${verb} ${who} about ${eq.name}.` +
      ((dispatch && dispatch.issue_description) ? `\n\nReason: ${dispatch.issue_description}` : '') +
      `\n\nMove this card to Done once the visit is resolved.`;

    const row = {
      title: `📞 ${verb} ${who} — ${eq.name}`,
      description: desc,
      board_id: target.boardId,
      list_id: target.listId,
      column_name: '',
      position: target.position,
      priority: 'normal',
      location: eq.location || null,
      equipment_id: equipmentId,
      reported_by: (dispatch && dispatch.dispatched_by) || 'Dispatch',
      checklist: [], comments: [],
      labels: ['dispatch-call', `dispatch:${dispatchEventId}`],
      dispatch_event_id: dispatchEventId,
      photo_urls: [],
      archived: false,
    };
    let payload = Object.assign({}, row);
    let created = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data, error } = await NX.sb.from('kanban_cards').insert(payload).select('*').single();
      if (!error) { created = data; break; }
      const m = /column "?([a-z0-9_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) { delete payload[m[1]]; continue; }
      throw error;
    }
    try { if (created && NX.modules && NX.modules.board && NX.modules.board.reload) NX.modules.board.reload(); } catch (_) {}
    return created;
  }


  // ════════════════════════════════════════════════════════════════════
  // EVENT: advance an equipment_issue through its lifecycle
  // (Phase A — board card timeline drives the issue forward)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  board.js card detail timeline tap
  //            equipment.js issue tracker (for consistency)
  //
  // PARAMS:
  //   issueId    (uuid)
  //   newStatus  one of: reported, contractor_called, eta_set,
  //              in_progress, awaiting_parts, repaired
  //
  // RETURNS:   { ok, issue, statusProposal }
  //   - ok            — true on success
  //   - issue         — updated equipment_issues row
  //   - statusProposal — { suggestedStatus, reason } | null
  //                      Caller shows a confirm() and if accepted,
  //                      calls applyEquipmentStatusChange().
  //
  // EFFECTS:   Updates issue row + appropriate timestamp column.
  //            Computes (but does NOT apply) a suggested equipment
  //            status change. The caller handles the UI prompt.
  //
  D.transitionEquipmentIssue = async function({ issueId, newStatus }) {
    const out = { ok: false, issue: null, statusProposal: null };
    if (!NX.sb || !issueId || !newStatus) return out;

    // status → timestamp column. Matches the convention in equipment.js.
    const STATUS_TS_COLUMN = {
      reported:           'reported_at',
      contractor_called:  'contractor_called_at',
      eta_set:            'eta_set_at',
      in_progress:        'in_progress_at',
      awaiting_parts:     'awaiting_parts_at',
      repaired:           'repaired_at',
    };
    if (!STATUS_TS_COLUMN[newStatus]) return out;

    const update = { status: newStatus };
    update[STATUS_TS_COLUMN[newStatus]] = new Date().toISOString();

    let issue;
    try {
      const { data, error } = await NX.sb.from('equipment_issues')
        .update(update).eq('id', issueId).select('*').single();
      if (error) throw error;
      issue = data;
      out.ok = true;
      out.issue = issue;
    } catch (e) {
      console.warn('[domain.transitionEquipmentIssue] update failed:', e?.message || e);
      return out;
    }

    out.statusProposal = await computeProposedEquipmentStatus({
      equipmentId: issue.equipment_id,
      trigger: { type: 'issue_status', newStatus, issueId },
    });

    if (issue.equipment_id) {
      try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(issue.equipment_id); } catch (_) {}
    }
    return out;
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: reopen a repaired equipment_issue OR fork into a new one
  // (Phase A — "did it break again from same issue, or new problem?")
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  board.js card detail "Reopen / Continue" button
  //
  // PARAMS:
  //   issueId  (uuid)  — the existing (repaired) issue
  //   mode     'continue'   — same root cause: revert this issue to
  //                           in_progress, keep all attempt history
  //            'newProblem' — different problem: keeps the original
  //                           closed, creates a NEW equipment_issue +
  //                           linked card so history doesn't muddy
  //   newTitle, newDescription — required when mode='newProblem'
  //
  // RETURNS:   { ok, issue?, newIssue?, statusProposal? }
  //
  D.reopenEquipmentIssue = async function({ issueId, mode, newTitle, newDescription }) {
    const out = { ok: false, issue: null, newIssue: null, statusProposal: null };
    if (!NX.sb || !issueId) return out;

    let original;
    try {
      const { data, error } = await NX.sb.from('equipment_issues')
        .select('*').eq('id', issueId).single();
      if (error) throw error;
      original = data;
    } catch (e) {
      console.warn('[domain.reopenEquipmentIssue] fetch failed:', e?.message || e);
      return out;
    }

    if (mode === 'continue') {
      try {
        const { data, error } = await NX.sb.from('equipment_issues').update({
          status: 'in_progress',
          repaired_at: null,
        }).eq('id', issueId).select('*').single();
        if (error) throw error;
        out.ok = true;
        out.issue = data;

        // Un-archive any linked board card so the team sees it again.
        try {
          await NX.sb.from('kanban_cards').update({ archived: false })
            .eq('equipment_id', original.equipment_id)
            .contains('labels', [`issue:${issueId}`]);
        } catch (_) {}

        out.statusProposal = await computeProposedEquipmentStatus({
          equipmentId: original.equipment_id,
          trigger: { type: 'issue_reopened', issueId },
        });
      } catch (e) {
        console.warn('[domain.reopenEquipmentIssue] continue failed:', e?.message || e);
      }
      return out;
    }

    if (mode === 'newProblem') {
      try {
        const payload = {
          equipment_id:     original.equipment_id,
          title:            newTitle || 'Recurring issue',
          description:      newDescription || null,
          status:           'reported',
          reported_at:      new Date().toISOString(),
          reported_by:      (NX.user && NX.user.id) ? NX.user.id : null,
          reported_by_name: (NX.user && NX.user.name) ? NX.user.name : null,
        };
        const { data: created, error } = await NX.sb.from('equipment_issues')
          .insert(payload).select('*').single();
        if (error) throw error;
        out.ok = true;
        out.newIssue = created;

        try {
          await autoCreateIssueCard({
            issueId: created.id,
            equipmentId: created.equipment_id,
            title: created.title,
            description: created.description,
            priority: 'high',
          });
        } catch (_) {}

        out.statusProposal = await computeProposedEquipmentStatus({
          equipmentId: created.equipment_id,
          trigger: { type: 'issue_created', priority: 'high', issueId: created.id },
        });
      } catch (e) {
        console.warn('[domain.reopenEquipmentIssue] newProblem failed:', e?.message || e);
      }
      return out;
    }
    return out;
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: record a repair attempt (call, text, email, in-house)
  // (Phase C — every attempt = a dispatch_events row)
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  board.js card detail "+ Add Attempt" button
  //
  // PARAMS:
  //   equipmentId       (uuid)
  //   method            'call' | 'text' | 'email' | 'in_house'
  //   contractorName    (text)
  //   contractorPhone   (text, optional)
  //   issueDescription  (text) — what they're trying to fix
  //   notes             (text) — initial notes
  //
  // RETURNS:   { ok, dispatchEvent }
  //
  D.recordRepairAttempt = async function({ equipmentId, method, contractorName, contractorPhone, issueDescription, notes }) {
    const out = { ok: false, dispatchEvent: null };
    if (!NX.sb || !equipmentId) return out;
    try {
      const { data, error } = await NX.sb.from('dispatch_events').insert({
        equipment_id: equipmentId,
        contractor_name: contractorName || (NX.currentUser?.name || 'Staff'),
        contractor_phone: contractorPhone || null,
        method: method || 'in_house',
        issue_description: issueDescription || null,
        dispatched_by: NX.currentUser?.name || null,
        outcome: 'pending',
        outcome_notes: notes || null,
      }).select('*').single();
      if (error) throw error;
      out.ok = true;
      out.dispatchEvent = data;
    } catch (e) {
      console.warn('[domain.recordRepairAttempt] insert failed:', e?.message || e);
      return out;
    }

    // Back-link to open card (reuses recordDispatch logic)
    try {
      await D.recordDispatch({
        equipmentId,
        dispatchEventId: out.dispatchEvent.id,
      });
    } catch (_) {}
    return out;
  };


  // ════════════════════════════════════════════════════════════════════
  // EVENT: mark an attempt's outcome (resolved / failed / no_answer)
  // (Phase C — failed attempts propose equipment.status='down')
  // ════════════════════════════════════════════════════════════════════
  //
  // FIRED BY:  board.js attempts list — "Mark resolved" / "Mark failed"
  //
  // PARAMS:
  //   dispatchEventId  (uuid)
  //   outcome          'resolved' | 'failed' | 'no_answer' | 'pending'
  //   outcomeNotes     (text)
  //   photoUrls        (array)  — best-effort; requires
  //                               dispatch_events.photo_urls column.
  //                               If column missing, photos are dropped
  //                               and the rest of the update succeeds.
  //
  // RETURNS:   { ok, dispatchEvent, statusProposal }
  //
  D.markAttemptOutcome = async function({ dispatchEventId, outcome, outcomeNotes, photoUrls }) {
    const out = { ok: false, dispatchEvent: null, statusProposal: null };
    if (!NX.sb || !dispatchEventId || !outcome) return out;

    const update = { outcome, outcome_notes: outcomeNotes || null };
    if (outcome !== 'pending') update.responded_at = new Date().toISOString();
    if (photoUrls && photoUrls.length) update.photo_urls = photoUrls;

    let row;
    try {
      const { data, error } = await NX.sb.from('dispatch_events')
        .update(update).eq('id', dispatchEventId).select('*').single();
      if (error && /photo_urls/i.test(error.message || '')) {
        // Column missing — retry without photos
        delete update.photo_urls;
        const retry = await NX.sb.from('dispatch_events')
          .update(update).eq('id', dispatchEventId).select('*').single();
        if (retry.error) throw retry.error;
        row = retry.data;
      } else if (error) {
        throw error;
      } else {
        row = data;
      }
      out.ok = true;
      out.dispatchEvent = row;
    } catch (e) {
      console.warn('[domain.markAttemptOutcome] update failed:', e?.message || e);
      return out;
    }

    if (outcome === 'failed' && row?.equipment_id) {
      out.statusProposal = await computeProposedEquipmentStatus({
        equipmentId: row.equipment_id,
        trigger: { type: 'attempt_failed', dispatchEventId },
      });
    }
    return out;
  };


  // ════════════════════════════════════════════════════════════════════
  // ACTION: apply an accepted equipment.status proposal
  // ════════════════════════════════════════════════════════════════════
  //
  // RULES (per project requirements):
  //   • Only ever sets one of: operational, needs_service, down.
  //   • NEVER touches: loaned, relocated, missing, retired, broken —
  //     those are user-managed via other flows.
  //
  D.applyEquipmentStatusChange = async function({ equipmentId, newStatus }) {
    if (!NX.sb || !equipmentId) return false;
    const ALLOWED = ['operational', 'needs_service', 'down'];
    if (!ALLOWED.includes(newStatus)) {
      console.warn('[domain.applyEquipmentStatusChange] refused status:', newStatus);
      return false;
    }
    try {
      // v18.32 Phase 3b — read current status BEFORE the update so we
      // can record the from→to transition on the activity stream. Used
      // by the Daily Log "equipment activity" feed.
      let priorStatus = null, eqName = null, eqLocation = null;
      try {
        const { data: priorRow } = await NX.sb.from('equipment')
          .select('status, name, location').eq('id', equipmentId).single();
        if (priorRow) {
          priorStatus = priorRow.status;
          eqName      = priorRow.name;
          eqLocation  = priorRow.location;
        }
      } catch (_) {/* fall through — log will degrade gracefully */}

      await NX.sb.from('equipment').update({ status: newStatus }).eq('id', equipmentId);

      // Best-effort activity log. NX.logEquipmentEvent is exposed by
      // equipment.js — if that module hasn't loaded yet the call is a
      // no-op via optional-chaining. Acceptable degradation: the AI-
      // proposed change still happens, just won't surface in the day's
      // activity feed for that one event.
      if (priorStatus && priorStatus !== newStatus) {
        NX.logEquipmentEvent?.({
          equipmentId,
          eventType: 'status_change',
          location: eqLocation,
          payload: {
            from: priorStatus, to: newStatus,
            equipment_name: eqName,
            source: 'ai_proposal',
          },
        });
      }
      try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[domain.applyEquipmentStatusChange] update failed:', e?.message || e);
      return false;
    }
  };


  // ════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS — not exposed on NX.domain
  // ════════════════════════════════════════════════════════════════════

  // Compute a proposed equipment.status change without applying it.
  // Returns { suggestedStatus, reason } or null.
  //
  // Rules:
  //   trigger.type === 'issue_created' && priority === 'high'
  //     → propose 'down' (urgent issue means equipment likely unusable)
  //   trigger.type === 'issue_created' && priority normal/low
  //     → propose 'needs_service'
  //   trigger.type === 'issue_status' && newStatus === 'repaired'
  //     → propose 'operational' IF no other open issues for this eq
  //   trigger.type === 'issue_reopened'
  //     → propose 'needs_service'  (or 'down' if was 'down' before? skip)
  //   trigger.type === 'attempt_failed'
  //     → propose 'down'
  //
  // Refuses to suggest a change if current status is loaned/relocated/
  // missing/retired/broken (those are managed elsewhere — see rules).
  async function computeProposedEquipmentStatus({ equipmentId, trigger }) {
    if (!equipmentId || !trigger) return null;
    const PROTECTED = ['loaned', 'relocated', 'missing', 'retired', 'broken'];

    let eq;
    try {
      const { data } = await NX.sb.from('equipment')
        .select('id, name, status').eq('id', equipmentId).maybeSingle();
      if (!data) return null;
      eq = data;
    } catch (_) { return null; }

    if (PROTECTED.includes(eq.status)) return null;   // hands off

    if (trigger.type === 'issue_created') {
      const suggested = trigger.priority === 'high' ? 'down' : 'needs_service';
      if (eq.status === suggested) return null;
      // Don't downgrade a 'down' equipment to 'needs_service' on a new low-pri issue
      if (eq.status === 'down' && suggested === 'needs_service') return null;
      return {
        suggestedStatus: suggested,
        reason: `New ${trigger.priority === 'high' ? 'high-priority ' : ''}issue reported.`,
        equipmentId: eq.id, equipmentName: eq.name,
        currentStatus: eq.status,
      };
    }

    if (trigger.type === 'issue_status' && trigger.newStatus === 'repaired') {
      if (eq.status === 'operational') return null;
      // Check no other open issues exist for this equipment
      try {
        const { data: others } = await NX.sb.from('equipment_issues')
          .select('id, status')
          .eq('equipment_id', equipmentId)
          .neq('id', trigger.issueId)
          .neq('status', 'repaired')
          .limit(1);
        if (others && others.length) return null;   // still have open issues
      } catch (_) {}
      return {
        suggestedStatus: 'operational',
        reason: 'Issue marked repaired and no other open issues.',
        equipmentId: eq.id, equipmentName: eq.name,
        currentStatus: eq.status,
      };
    }

    if (trigger.type === 'issue_reopened') {
      if (eq.status === 'needs_service' || eq.status === 'down') return null;
      return {
        suggestedStatus: 'needs_service',
        reason: 'Issue reopened — equipment likely needs attention again.',
        equipmentId: eq.id, equipmentName: eq.name,
        currentStatus: eq.status,
      };
    }

    if (trigger.type === 'attempt_failed') {
      if (eq.status === 'down') return null;   // already where we'd push to
      return {
        suggestedStatus: 'down',
        reason: 'A repair attempt failed.',
        equipmentId: eq.id, equipmentName: eq.name,
        currentStatus: eq.status,
      };
    }

    return null;
  }


  // Read an `issue:<uuid>` sentinel out of a card's labels array.
  async function archiveCardsByLabel(equipmentId, labelSentinel) {
    const { data: cards } = await NX.sb.from('kanban_cards')
      .select('id, labels, title')
      .eq('equipment_id', equipmentId)
      .eq('archived', false);
    if (!cards) return;
    for (const c of cards) {
      const hasLabel = Array.isArray(c.labels) && c.labels.includes(labelSentinel);
      // Fallback for legacy cards predating labels — match on title.
      const titleMatches = labelSentinel === 'pm-review' && /review\s*pm/i.test(c.title);
      if (hasLabel || titleMatches) {
        try {
          await NX.sb.from('kanban_cards').update({ archived: true }).eq('id', c.id);
        } catch (_) { /* per-card errors are non-fatal */ }
      }
    }
  }

  async function hasOpenCardWithLabel(equipmentId, labelSentinel) {
    const { data } = await NX.sb.from('kanban_cards')
      .select('id, labels')
      .eq('equipment_id', equipmentId)
      .eq('archived', false)
      .limit(50);
    if (!data) return false;
    return data.some(c => Array.isArray(c.labels) && c.labels.includes(labelSentinel));
  }

  // Label-only dedup — used for issue cards, which must dedup even when the
  // issue has no resolvable equipment_id (hasOpenCardWithLabel keys on
  // equipment_id and would miss those). Scans non-archived cards for the
  // exact label sentinel.
  async function hasCardWithLabel(labelSentinel) {
    // Server-side containment query — the old version downloaded 500 full
    // rows and scanned them in JS on EVERY dedup check (issue cards,
    // reorder cards, QR deep-links). Same answer, one indexed row, and no
    // false-negative once the board grows past 500 cards.
    try {
      const { data, error } = await NX.sb.from('kanban_cards')
        .select('id')
        .eq('archived', false)
        .contains('labels', [labelSentinel])
        .limit(1);
      if (!error) return !!(data && data.length);
    } catch (_) {}
    // Fallback: legacy scan (e.g. if labels isn't a containment-queryable
    // column in some deployment).
    const { data } = await NX.sb.from('kanban_cards')
      .select('id, labels').eq('archived', false).limit(500);
    return !!(data && data.some(c => Array.isArray(c.labels) && c.labels.includes(labelSentinel)));
  }

  function extractIssueIdFromLabels(labels) {
    if (!Array.isArray(labels)) return null;
    for (const l of labels) {
      if (typeof l === 'string' && l.startsWith('issue:')) {
        return l.slice('issue:'.length);
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // UNIFIED WORK ITEM API  (NX.work)
  // ════════════════════════════════════════════════════════════════════
  //
  // One creation path and one close path for "a thing that needs doing".
  // A work item is a kanban_card (source of truth: photos, checklist,
  // comments, progress) MIRRORED to a tickets row (legacy/Duties readers,
  // home counts, biweekly, calendar, AI). The two are cross-linked
  // (kanban_cards.ticket_id ↔ tickets.board_card_id) and created/closed
  // together, so the two surfaces never drift.
  //
  // Replaces the scattered dual-writes that used to live in equipment.js,
  // equipment-public-scan.js, brain-chat.js and ai-writer.js.
  const W = window.NX.work = window.NX.work || {};

  // Column-tolerant insert: drops any column the schema doesn't have and
  // retries, so a missing migration degrades instead of losing the row.
  async function resilientInsert(table, row) {
    let payload = Object.assign({}, row);
    for (let i = 0; i < 10; i++) {
      const { data, error } = await NX.sb.from(table).insert(payload).select('*').single();
      if (!error) return data;
      const m = /column "?([a-z0-9_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) { delete payload[m[1]]; continue; }
      throw error;
    }
    return null;
  }

  // Create a work item. Returns { card, ticket }.
  //   opts: { title, notes|description, priority, location, equipmentId,
  //           photoUrl|photoUrls, reportedBy, priorEqStatus, aiCreated,
  //           aiTroubleshoot, labels, listHints }
  W.create = async function(opts = {}) {
    const out = { card: null, ticket: null };
    if (!NX.sb) return out;
    const title = opts.title || 'Untitled';
    const notes = (opts.notes != null ? opts.notes : opts.description) || null;
    const priority = opts.priority || 'normal';
    const photoUrls = Array.isArray(opts.photoUrls) ? opts.photoUrls
      : (opts.photoUrl ? [opts.photoUrl] : []);
    const reportedBy = opts.reportedBy || (NX.currentUser && NX.currentUser.name) || 'Staff';
    const equipmentId = opts.equipmentId || null;
    const location = opts.location || null;
    const priorEqStatus = opts.priorEqStatus || null;

    // 1) Card — source of truth.
    try {
      const target = await pickBoardTarget({
        listHints: opts.listHints || ['report', 'issue|broken', 'todo|to.do|backlog'],
      });
      if (target) {
        const labels = Array.isArray(opts.labels) ? [...opts.labels] : [];
        if (opts.aiCreated && !labels.includes('ai-created')) labels.push('ai-created');
        out.card = await resilientInsert('kanban_cards', {
          title,
          description: notes,
          board_id: target.boardId,
          list_id: target.listId,
          column_name: '',
          position: target.position,
          priority,
          location,
          equipment_id: equipmentId,
          reported_by: reportedBy,
          prior_eq_status: priorEqStatus,
          checklist: [], comments: [], labels,
          photo_urls: photoUrls,
          archived: false,
        });
      } else {
        console.warn('[NX.work.create] no board/list target — card skipped');
      }
    } catch (e) {
      console.warn('[NX.work.create] card insert failed:', e?.message || e);
    }

    // 2) Ticket mirror — legacy/Duties/AI/biweekly readers depend on it.
    try {
      out.ticket = await resilientInsert('tickets', {
        title,
        notes,
        location,
        priority,
        status: 'open',
        reported_by: reportedBy,
        equipment_id: equipmentId,
        photo_url: photoUrls[0] || null,
        prior_eq_status: priorEqStatus,
        ai_created: !!opts.aiCreated,
        ai_troubleshoot: opts.aiTroubleshoot || null,
        board_card_id: out.card ? out.card.id : null,
      });
    } catch (e) {
      console.warn('[NX.work.create] ticket insert failed:', e?.message || e);
    }

    // 3) Cross-link card → ticket.
    if (out.card && out.ticket) {
      try { await NX.sb.from('kanban_cards').update({ ticket_id: out.ticket.id }).eq('id', out.card.id); } catch (_) {}
    }

    try { if (out.ticket && NX.notifyTicketCreated) NX.notifyTicketCreated(out.ticket); } catch (_) {}
    try { if (out.card && NX.modules && NX.modules.board && NX.modules.board.reload) NX.modules.board.reload(); } catch (_) {}
    return out;
  };

  // Close a work item from either surface — closes BOTH sides and restores
  // equipment status if this item had bumped it. Safe to call with whatever
  // ids you have (cardId and/or ticketId).
  W.close = async function({ cardId, ticketId, equipmentId, priorEqStatus } = {}) {
    if (!NX.sb) return;
    const now = new Date().toISOString();
    // Resolve the missing side from the cross-link if only one id is known.
    try {
      if (cardId && !ticketId) {
        const { data } = await NX.sb.from('kanban_cards').select('ticket_id').eq('id', cardId).maybeSingle();
        ticketId = data && data.ticket_id;
      } else if (ticketId && !cardId) {
        const { data } = await NX.sb.from('tickets').select('board_card_id').eq('id', ticketId).maybeSingle();
        cardId = data && data.board_card_id;
      }
    } catch (_) {}
    if (ticketId) { try { await NX.sb.from('tickets').update({ status: 'closed', closed_at: now }).eq('id', ticketId); } catch (_) {} }
    if (cardId)   { try { await NX.sb.from('kanban_cards').update({ archived: true, closed_at: now }).eq('id', cardId); } catch (_) {} }
    if (equipmentId && priorEqStatus) {
      try { await NX.sb.from('equipment').update({ status: priorEqStatus }).eq('id', equipmentId); } catch (_) {}
    }
  };

  // Sync a ticket's open/closed state to match a card that moved lanes on
  // the board (called from board.js moveCard). Keeps Duties in step.
  W.syncTicketToCard = async function({ ticketId, closed }) {
    if (!NX.sb || !ticketId) return;
    try {
      await NX.sb.from('tickets').update(
        closed ? { status: 'closed', closed_at: new Date().toISOString() }
               : { status: 'open',   closed_at: null }
      ).eq('id', ticketId);
    } catch (_) {}
  };

  // Find the open work order for a unit: its board card (source of truth),
  // the mirrored ticket, and any open equipment_issue. Lets the QR scan
  // complete the EXISTING work order instead of spawning a parallel one.
  // Returns { card, ticketId, issueId } | null.
  W.findOpenForEquipment = async function({ equipmentId } = {}) {
    if (!NX.sb || !equipmentId) return null;
    let card = null, ticketId = null, issueId = null;
    // 1) Newest open (non-archived) board card for this unit.
    try {
      const { data } = await NX.sb.from('kanban_cards')
        .select('id, ticket_id, labels, equipment_id, prior_eq_status, archived, created_at')
        .eq('equipment_id', equipmentId)
        .eq('archived', false)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length) {
        card = data[0];
        ticketId = card.ticket_id || null;
        issueId = extractIssueIdFromLabels(card.labels);
      }
    } catch (_) {}
    // 2) Fallback: an open equipment_issue even when no card is on the board.
    if (!issueId) {
      try {
        const { data } = await NX.sb.from('equipment_issues')
          .select('id')
          .eq('equipment_id', equipmentId)
          .not('status', 'in', '(repaired,closed,resolved)')
          .order('reported_at', { ascending: false })
          .limit(1);
        if (data && data.length) issueId = data[0].id;
      } catch (_) {}
    }
    if (!card && !issueId) return null;
    return { card, ticketId, issueId };
  };

  // Complete a unit's open work order end to end, from either surface
  // (staff or public QR). Consolidates what used to be scattered dual-writes:
  //   1. marks the linked equipment_issue repaired   → Home "Open WO" drops
  //   2. closes card + mirrored ticket via W.close    → board + Duties in step
  //   3. restores equipment status (operational)
  //   4. writes an equipment_maintenance audit row
  // Call with just { equipmentId }. Returns a summary of what closed.
  W.fulfillForEquipment = async function({ equipmentId, performedBy, notes, restoreStatus } = {}) {
    if (!NX.sb || !equipmentId) return { ok: false, reason: 'missing-equipment' };
    const now = new Date().toISOString();
    const open = await W.findOpenForEquipment({ equipmentId });
    const issueId = open && open.issueId;
    const card = open && open.card;

    // 1) Canonical completion — mark the work order (issue) repaired.
    if (issueId) {
      try {
        await NX.sb.from('equipment_issues')
          .update({ status: 'repaired', repaired_at: now })
          .eq('id', issueId);
      } catch (e) { console.warn('[NX.work.fulfillForEquipment] mark repaired failed:', e?.message || e); }
    }

    // 2) Close the board card + mirrored ticket, restoring the unit to the
    //    status it held before this work order bumped it.
    if (card) {
      try {
        await W.close({
          cardId: card.id,
          ticketId: open.ticketId,
          equipmentId,
          priorEqStatus: card.prior_eq_status || restoreStatus || 'operational',
        });
      } catch (e) { console.warn('[NX.work.fulfillForEquipment] close failed:', e?.message || e); }
    } else {
      // No card on the board — still make sure the unit reads operational.
      try {
        await NX.sb.from('equipment')
          .update({ status: restoreStatus || 'operational' })
          .eq('id', equipmentId);
      } catch (_) {}
    }

    // 3) Auditable trail of the completion.
    try {
      await NX.sb.from('equipment_maintenance').insert({
        equipment_id: equipmentId,
        event_type: 'service',
        description: 'Work order completed' + (notes ? ' — ' + String(notes).trim() : ''),
        performed_by: performedBy || 'QR scan',
        event_date: now,
      });
    } catch (e) { console.warn('[NX.work.fulfillForEquipment] maint log failed:', e?.message || e); }

    // 4) Refresh the equipment brain + board so the change shows immediately.
    try { if (NX.eqBrainSync?.syncOne) await NX.eqBrainSync.syncOne(equipmentId); } catch (_) {}
    try { if (NX.modules?.board?.reload) NX.modules.board.reload(); } catch (_) {}

    return { ok: true, closedCard: !!card, closedIssue: !!issueId, equipmentId };
  };

  // ─── Card creators ──────────────────────────────────────────────────

  async function autoCreateReviewCard(equipmentId, contractor) {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location')
      .eq('id', equipmentId).maybeSingle();
    if (!eq) return;

    if (await hasOpenCardWithLabel(equipmentId, 'pm-review')) return;

    const target = await pickBoardTarget({
      listHints: ['pm.review|review.pm', 'report', 'todo|to.do|backlog'],
    });
    if (!target) return;

    const submittedBy = contractor?.name
      ? `${contractor.name}${contractor.company ? ' (' + contractor.company + ')' : ''}`
      : 'QR Scanner';
    const desc = `PM log submitted via public QR scan by ${submittedBy}.\n\n` +
                 `Open the equipment detail → Timeline tab to review and approve or reject.`;

    await NX.sb.from('kanban_cards').insert({
      title: `🔧 Review PM — ${eq.name}`,
      description: desc,
      board_id: target.boardId,
      list_id: target.listId,
      column_name: '',
      position: target.position,
      priority: 'normal',
      location: eq.location || null,
      equipment_id: equipmentId,
      reported_by: submittedBy,
      checklist: [], comments: [],
      labels: ['pm-review'],
      photo_urls: [],
      archived: false,
    });
  }

  async function autoCreatePMDueCard(schedule) {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location')
      .eq('id', schedule.equipment_id).maybeSingle();
    if (!eq) return;

    const target = await pickBoardTarget({
      listHints: ['pm.due|due.pm', 'pm', 'scheduled|maintenance', 'todo|to.do|backlog'],
    });
    if (!target) return;

    const daysOverdue = Math.floor(
      (Date.now() - new Date(schedule.next_due_at).getTime()) / 86400000
    );
    const overdueText = daysOverdue > 1 ? ` (${daysOverdue} days overdue)`
                     : daysOverdue === 1 ? ' (1 day overdue)'
                     : ' (due today)';

    const desc = `Scheduled PM is due${overdueText}.\n\n` +
                 `Schedule: every ${schedule.frequency_days} day${schedule.frequency_days === 1 ? '' : 's'}.\n` +
                 (schedule.assigned_to ? `Assigned to: ${schedule.assigned_to}.\n\n` : '\n') +
                 `When complete, scan the QR on this equipment to log the PM, or close this card manually.`;

    await NX.sb.from('kanban_cards').insert({
      title: `🛠 PM Due — ${eq.name} — ${schedule.title}`,
      description: desc,
      board_id: target.boardId,
      list_id: target.listId,
      column_name: '',
      position: target.position,
      priority: daysOverdue > 7 ? 'high' : 'normal',
      location: eq.location || null,
      equipment_id: schedule.equipment_id,
      reported_by: 'PM Scheduler',
      checklist: [], comments: [],
      labels: ['pm-due', `sched:${schedule.id}`],
      photo_urls: [],
      archived: false,
    });
  }

  async function autoCreateIssueCard({ issueId, equipmentId, title, description, priority, location }) {
    if (!issueId) return null;
    // Equipment is OPTIONAL. A work order with a null/stale equipment_id used
    // to get NO card at all (this returned null), leaving it un-openable from
    // Home and invisible on the board. Now we look equipment up best-effort
    // and create the card regardless.
    let eq = null;
    if (equipmentId) {
      const { data } = await NX.sb.from('equipment')
        .select('id, name, location')
        .eq('id', equipmentId).maybeSingle();
      eq = data || null;
    }

    // Dedup by the issue label (works with or without equipment_id).
    if (await hasCardWithLabel(`issue:${issueId}`)) return null;

    const target = await pickBoardTarget({
      listHints: ['report', 'issue|broken', 'todo|to.do|backlog'],
    });
    if (!target) { console.warn('[domain.autoCreateIssueCard] no board/list target — board not initialized?'); return null; }

    const eqName = (eq && eq.name) || '';
    const loc = (eq && eq.location) || location || null;
    const titleText = title || 'Work order';
    const desc = (description ? description + '\n\n' : '') +
                 (eqName ? `Equipment issue reported on ${eqName}.\n` : `Work order.\n`) +
                 `When resolved, move this card to Done — the linked issue will be marked repaired automatically.`;

    const row = {
      title: eqName ? `⚠️ ${titleText} — ${eqName}` : `⚠️ ${titleText}`,
      description: desc,
      board_id: target.boardId,
      list_id: target.listId,
      column_name: '',
      position: target.position,
      priority: priority || 'high',
      location: loc,
      equipment_id: equipmentId || null,
      reported_by: (NX.currentUser && NX.currentUser.name) || (NX.user && NX.user.name) || 'Issue Tracker',
      checklist: [], comments: [],
      labels: ['equipment-issue', `issue:${issueId}`],
      photo_urls: [],
      archived: false,
    };
    // Resilient insert: if the schema is missing a column, drop it and retry
    // rather than failing the whole card silently (the recurring 42703 trap).
    let payload = Object.assign({}, row);
    let created = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data, error } = await NX.sb.from('kanban_cards').insert(payload).select('*').single();
      if (!error) { created = data; break; }
      const m = /column "?([a-z0-9_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) { delete payload[m[1]]; continue; }
      throw error;
    }
    // If the board is open, refresh it so the new card appears immediately.
    try { if (created && NX.modules && NX.modules.board && NX.modules.board.reload) NX.modules.board.reload(); } catch (_) {}
    return created;
  }

  // Backfill: create board cards for OPEN issues that don't have one yet
  // (e.g. issues created before this orchestration existed, or via paths
  // that skipped it). Idempotent — autoCreateIssueCard dedupes by the
  // `issue:<id>` label. Returns the number of cards created.
  D.backfillIssueCards = async function() {
    if (!NX.sb) return 0;
    let created = 0;
    try {
      const { data: issues } = await NX.sb.from('equipment_issues').select('*').limit(200);
      // Include issues with NO equipment_id too — they're still work orders
      // and still need a card (previously they were silently skipped).
      const open = (issues || []).filter(i => i &&
        !/^(repaired|resolved|closed|done|cancelled|canceled)$/i.test(i.status || ''));
      for (const it of open) {
        try {
          const card = await autoCreateIssueCard({
            issueId: it.id, equipmentId: it.equipment_id,
            title: it.title, description: it.description,
            priority: it.priority || 'high', location: it.location,
          });
          if (card) created++;
        } catch (e) { console.warn('[domain.backfillIssueCards] one issue failed:', e?.message || e); }
      }
    } catch (e) { console.warn('[domain.backfillIssueCards] failed:', e?.message || e); }
    return created;
  };

  // Ensure a single issue has a board card — create it on demand (used when
  // tapping a Home work order whose card is missing). Dedups via the issue
  // label, so calling it when a card already exists is a no-op.
  D.ensureIssueCard = async function(issueId) {
    if (!NX.sb || !issueId) return null;
    try {
      const { data: it } = await NX.sb.from('equipment_issues').select('*').eq('id', issueId).maybeSingle();
      if (!it) return null;
      return await autoCreateIssueCard({
        issueId: it.id, equipmentId: it.equipment_id,
        title: it.title, description: it.description,
        priority: it.priority || 'high', location: it.location,
      });
    } catch (e) { console.warn('[domain.ensureIssueCard] failed:', e?.message || e); return null; }
  };

  // ─── Board targeting ────────────────────────────────────────────────
  // Picks (boardId, listId, position) for a new card. Tries to match
  // one of the hint patterns (in order) against list names; falls back
  // to the first list of the first active board.
  async function pickBoardTarget({ listHints }) {
    // Fetch tolerant of a missing/NULL `archived` flag — do NOT use
    // .eq('archived', false), which silently drops rows where archived
    // IS NULL (and would leave a real board un-found → no card created).
    const { data: boardsRaw } = await NX.sb.from('boards').select('*').order('position').limit(20);
    const boards = (boardsRaw || []).filter(b => b && b.archived !== true);
    if (!boards.length) return null;
    const board = boards[0];

    const { data: listsRaw } = await NX.sb.from('board_lists')
      .select('*').eq('board_id', board.id).order('position');
    const lists = (listsRaw || []).filter(l => l && l.archived !== true);
    if (!lists.length) return null;

    let targetList = null;
    for (const pattern of (listHints || [])) {
      const re = new RegExp(pattern, 'i');
      const found = lists.find(l => re.test(l.name || ''));
      if (found) { targetList = found; break; }
    }
    if (!targetList) targetList = lists[0];

    // Add-to-top to match the board composer (render sorts by position asc).
    let position = 0;
    try {
      const { data: inList } = await NX.sb.from('kanban_cards')
        .select('position').eq('list_id', targetList.id).eq('archived', false);
      if (inList && inList.length) {
        position = Math.min(...inList.map(c => (typeof c.position === 'number' ? c.position : 0))) - 1;
      }
    } catch (_) {}

    return { boardId: board.id, listId: targetList.id, position };
  }


  console.log('[domain] v2 loaded — ' + Object.keys(D).length + ' business events registered');
})();
