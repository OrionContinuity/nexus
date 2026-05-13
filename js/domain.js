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
      if (!cards || !cards.length) return;
      const card = cards[0];

      const labels = Array.isArray(card.labels) ? [...card.labels] : [];
      const sentinel = `dispatch:${dispatchEventId}`;
      if (!labels.includes(sentinel)) labels.push(sentinel);

      await NX.sb.from('kanban_cards').update({
        dispatch_event_id: dispatchEventId,
        labels,
      }).eq('id', card.id);
    } catch (e) {
      console.warn('[domain.recordDispatch] link failed:', e?.message || e);
    }
  };


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
      await NX.sb.from('equipment').update({ status: newStatus }).eq('id', equipmentId);
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

  function extractIssueIdFromLabels(labels) {
    if (!Array.isArray(labels)) return null;
    for (const l of labels) {
      if (typeof l === 'string' && l.startsWith('issue:')) {
        return l.slice('issue:'.length);
      }
    }
    return null;
  }

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

  async function autoCreateIssueCard({ issueId, equipmentId, title, description, priority }) {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location')
      .eq('id', equipmentId).maybeSingle();
    if (!eq) return;

    if (await hasOpenCardWithLabel(equipmentId, `issue:${issueId}`)) return;

    const target = await pickBoardTarget({
      listHints: ['report', 'issue|broken', 'todo|to.do|backlog'],
    });
    if (!target) return;

    const desc = (description ? description + '\n\n' : '') +
                 `Equipment issue reported on ${eq.name}.\n` +
                 `When resolved, move this card to Done — the linked issue will be marked repaired automatically.`;

    await NX.sb.from('kanban_cards').insert({
      title: `⚠️ ${title || 'Issue'} — ${eq.name}`,
      description: desc,
      board_id: target.boardId,
      list_id: target.listId,
      column_name: '',
      position: target.position,
      priority: priority || 'high',
      location: eq.location || null,
      equipment_id: equipmentId,
      reported_by: NX.currentUser?.name || 'Issue Tracker',
      checklist: [], comments: [],
      labels: ['equipment-issue', `issue:${issueId}`],
      photo_urls: [],
      archived: false,
    });
  }

  // ─── Board targeting ────────────────────────────────────────────────
  // Picks (boardId, listId, position) for a new card. Tries to match
  // one of the hint patterns (in order) against list names; falls back
  // to the first list of the first active board.
  async function pickBoardTarget({ listHints }) {
    const { data: boards } = await NX.sb.from('boards')
      .select('id, name')
      .eq('archived', false)
      .order('position')
      .limit(20);
    if (!boards || !boards.length) return null;
    const board = boards[0];

    const { data: lists } = await NX.sb.from('board_lists')
      .select('id, name, position')
      .eq('board_id', board.id)
      .order('position');
    if (!lists || !lists.length) return null;

    let targetList = null;
    for (const pattern of (listHints || [])) {
      const re = new RegExp(pattern, 'i');
      const found = lists.find(l => re.test(l.name));
      if (found) { targetList = found; break; }
    }
    if (!targetList) targetList = lists[0];

    const { count: posCount } = await NX.sb.from('kanban_cards')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', targetList.id)
      .eq('archived', false);

    return {
      boardId: board.id,
      listId: targetList.id,
      position: posCount || 0,
    };
  }


  console.log('[domain] v2 loaded — ' + Object.keys(D).length + ' business events registered');
})();
