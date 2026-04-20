/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Equipment ↔ Brain Sync v1
   
   Auto-syncs equipment rows into the nodes table as category='equipment'
   so the brain/galaxy renders them as nebulae and the AI can query them.
   
   Sync rules:
     - On equipment list load → upsert each non-deleted equipment as a node
     - On equipment edit/save → re-sync that one row
     - On part add/edit/delete → re-sync the parent equipment node
     - On dispatch event → re-sync (status note)
     - On maintenance log → re-sync (last service date)
     - On soft delete → soft-delete the matching node
     - On soft restore → restore the node
   
   Node structure for equipment:
     name = equipment.name
     category = 'equipment'
     notes = rich summary string with all key facts (model, location, 
             status, parts count, last service, contractor info, etc.)
             AI search reads notes — this is where the queryable text lives
     tags = [location, equipment_category, status, manufacturer]
     links = [related_node_ids]  (contractors, parts vendors)
     source_emails = []
     access_count = updated to current time
     
   Node ID strategy:
     We use a deterministic node ID derived from equipment.id so re-syncs
     UPSERT cleanly without duplicates. Format: 'eq:<equipment_id>'
     This requires nodes.id to be text. If it's bigint, we use a separate
     equipment_node_id column on equipment to track the link.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  function whenReady(check, fn, maxWait = 5000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); fn(); }
      else if (Date.now() - start > maxWait) { clearInterval(interval); }
    }, 100);
  }

  whenReady(
    () => NX && NX.modules && NX.modules.equipment && NX.sb,
    () => init()
  );

  let nodesIdType = null;  // Detected at runtime: 'text', 'bigint', 'uuid'

  async function init() {
    console.log('[eq-brain-sync] initializing equipment→brain sync');
    await detectNodesIdType();
    patchSyncHooks();
    // Initial bulk sync after a moment so equipment data is loaded
    setTimeout(syncAllEquipment, 1500);
  }

  async function detectNodesIdType() {
    // Sniff a node to determine the id column type
    try {
      const { data } = await NX.sb.from('nodes').select('id').limit(1).single();
      if (data && data.id != null) {
        const v = data.id;
        if (typeof v === 'number') nodesIdType = 'bigint';
        else if (typeof v === 'string' && /^[0-9a-f]{8}-/i.test(v)) nodesIdType = 'uuid';
        else nodesIdType = 'text';
      } else {
        nodesIdType = 'bigint';  // safe default
      }
      console.log('[eq-brain-sync] detected nodes.id type:', nodesIdType);
    } catch (e) {
      nodesIdType = 'bigint';
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     BUILD NODE PAYLOAD from equipment row
     ═════════════════════════════════════════════════════════════════════════ */

  function buildNodePayload(eq, parts, recentMaint, recentDispatches) {
    parts = parts || [];
    recentMaint = recentMaint || [];
    recentDispatches = recentDispatches || [];
    
    // Build a rich, AI-searchable notes string. Format is plain natural language
    // so embeddings/search work well.
    const lines = [];
    lines.push(`${eq.name || 'Equipment'} — ${eq.category || 'uncategorized'}`);
    if (eq.location || eq.area) {
      lines.push(`Location: ${eq.location || ''}${eq.area ? ' · ' + eq.area : ''}`);
    }
    if (eq.manufacturer || eq.model) {
      lines.push(`Make/Model: ${eq.manufacturer || ''} ${eq.model || ''}`.trim());
    }
    if (eq.serial_number) lines.push(`Serial: ${eq.serial_number}`);
    if (eq.status) lines.push(`Status: ${eq.status}`);
    if (eq.health_score != null) lines.push(`Health: ${eq.health_score}%`);
    if (eq.install_date) lines.push(`Installed: ${eq.install_date}`);
    if (eq.warranty_until) lines.push(`Warranty until: ${eq.warranty_until}`);
    if (eq.purchase_price) lines.push(`Cost: $${eq.purchase_price}`);
    if (eq.next_pm_date) lines.push(`Next PM: ${eq.next_pm_date}`);
    if (eq.notes) lines.push(`Notes: ${eq.notes}`);
    
    // Service contractor info
    if (eq.service_contractor_name) {
      lines.push(`Service contractor: ${eq.service_contractor_name}${eq.service_contractor_phone ? ' (' + eq.service_contractor_phone + ')' : ''}`);
    }
    if (eq.backup_contractor_name) {
      lines.push(`Backup contractor: ${eq.backup_contractor_name}${eq.backup_contractor_phone ? ' (' + eq.backup_contractor_phone + ')' : ''}`);
    }
    
    // Parts catalog
    if (parts.length) {
      lines.push(`Parts catalog (${parts.length}):`);
      parts.slice(0, 20).forEach(p => {
        const vendorCount = Array.isArray(p.vendors) ? p.vendors.length : 0;
        const vendorStr = vendorCount > 0 
          ? ` — ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`
          : (p.supplier ? ` — ${p.supplier}` : '');
        lines.push(`  • ${p.part_name}${p.oem_part_number ? ' (OEM: ' + p.oem_part_number + ')' : ''}${vendorStr}`);
      });
      if (parts.length > 20) lines.push(`  …and ${parts.length - 20} more parts`);
    }
    
    // Recent maintenance
    if (recentMaint.length) {
      lines.push(`Recent service:`);
      recentMaint.slice(0, 5).forEach(m => {
        const dateStr = m.event_date ? new Date(m.event_date).toLocaleDateString() : '';
        lines.push(`  • ${dateStr} — ${m.event_type || 'service'}${m.notes ? ': ' + m.notes : ''}`);
      });
    }
    
    // Recent dispatches
    if (recentDispatches.length) {
      lines.push(`Recent dispatches:`);
      recentDispatches.slice(0, 5).forEach(d => {
        const dateStr = d.dispatched_at ? new Date(d.dispatched_at).toLocaleDateString() : '';
        lines.push(`  • ${dateStr} — called ${d.contractor_name || 'contractor'}${d.issue_description ? ' for: ' + d.issue_description : ''}`);
      });
    }
    
    // Manual link
    if (eq.manual_url) lines.push(`Manual: ${eq.manual_url}`);

    // Tags = filterable / facetable terms
    const tags = ['equipment'];
    if (eq.location) tags.push(eq.location);
    if (eq.category) tags.push(eq.category);
    if (eq.status) tags.push(eq.status);
    if (eq.manufacturer) tags.push(eq.manufacturer);

    return {
      name: eq.name || 'Unnamed equipment',
      category: 'equipment',
      notes: lines.join('\n'),
      tags,
      links: [],
      source_emails: [],
      access_count: Date.now()
    };
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SYNC ONE equipment row → its corresponding node
     Uses the equipment_node_id column on equipment (added by SQL migration)
     to track which node represents which equipment.
     ═════════════════════════════════════════════════════════════════════════ */

  async function syncOneEquipment(equipId) {
    try {
      // Load full equipment + parts + recent events
      const [{ data: eq }, { data: parts }, { data: maint }, { data: dispatches }] = await Promise.all([
        NX.sb.from('equipment').select('*').eq('id', equipId).single(),
        NX.sb.from('equipment_parts').select('*').eq('equipment_id', equipId).eq('is_deleted', false).order('part_name'),
        NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', equipId).order('event_date', { ascending: false }).limit(5),
        NX.sb.from('dispatch_events').select('*').eq('equipment_id', equipId).order('dispatched_at', { ascending: false }).limit(5)
      ]);

      if (!eq) return;
      
      // Soft-deleted equipment? Soft-delete the matching node too
      if (eq.is_deleted) {
        if (eq.equipment_node_id) {
          await NX.sb.from('nodes').update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: 'auto-sync',
            deleted_reason: 'parent equipment was deleted'
          }).eq('id', eq.equipment_node_id);
        }
        return;
      }
      
      const payload = buildNodePayload(eq, parts, maint, dispatches);
      
      if (eq.equipment_node_id) {
        // Update existing node — also restore if it was soft-deleted
        const { error } = await NX.sb.from('nodes').update({
          ...payload,
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          deleted_reason: null
        }).eq('id', eq.equipment_node_id);
        if (error) {
          // Node probably got hard-deleted — create a new one
          console.warn('[eq-brain-sync] update failed, creating new node:', error.message);
          await createNewNodeForEquipment(eq, payload);
        }
      } else {
        // No linked node — create one
        await createNewNodeForEquipment(eq, payload);
      }
    } catch (e) {
      console.warn('[eq-brain-sync] sync failed for', equipId, e);
    }
  }

  async function createNewNodeForEquipment(eq, payload) {
    try {
      const { data, error } = await NX.sb.from('nodes').insert(payload).select().single();
      if (error) throw error;
      // Link the new node ID back to the equipment
      await NX.sb.from('equipment').update({ equipment_node_id: data.id }).eq('id', eq.id);
      // Add to local NX.nodes cache so galaxy picks it up
      if (NX.nodes && Array.isArray(NX.nodes)) NX.nodes.push(data);
    } catch (e) {
      console.warn('[eq-brain-sync] create node failed:', e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     BULK SYNC — runs once after equipment view loads. Catches any equipment
     that doesn't have a linked node yet and creates them.
     ═════════════════════════════════════════════════════════════════════════ */

  async function syncAllEquipment() {
    try {
      const { data: allEq } = await NX.sb.from('equipment')
        .select('id, equipment_node_id, is_deleted')
        .eq('is_deleted', false);
      if (!allEq?.length) return;
      
      // Only sync the ones missing a node link OR that haven't been synced recently
      const needsSync = allEq.filter(e => !e.equipment_node_id);
      if (!needsSync.length) {
        console.log('[eq-brain-sync] all equipment already synced');
        return;
      }
      
      console.log(`[eq-brain-sync] bulk syncing ${needsSync.length} equipment to brain…`);
      // Sync in parallel batches of 5 to avoid hammering Supabase
      for (let i = 0; i < needsSync.length; i += 5) {
        const batch = needsSync.slice(i, i + 5);
        await Promise.all(batch.map(e => syncOneEquipment(e.id)));
      }
      console.log('[eq-brain-sync] bulk sync done');
    } catch (e) {
      console.warn('[eq-brain-sync] bulk sync error:', e);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PATCH HOOKS — re-sync the relevant equipment whenever data changes
     ═════════════════════════════════════════════════════════════════════════ */

  function patchSyncHooks() {
    const EQ = NX.modules.equipment;
    if (!EQ) return;

    // Wrap saveEquipment / updateEquipment if they exist
    ['saveEquipment', 'updateEquipment', 'edit'].forEach(fn => {
      if (typeof EQ[fn] === 'function') {
        const orig = EQ[fn];
        EQ[fn] = async function(...args) {
          const result = await orig.apply(this, args);
          // First arg is usually the equipment ID
          const id = typeof args[0] === 'string' ? args[0] : args[0]?.id;
          if (id) setTimeout(() => syncOneEquipment(id), 500);
          return result;
        };
      }
    });

    // Wrap addPart/editPart/deletePart — re-sync parent equipment
    ['addPart', 'editPart', 'savePart'].forEach(fn => {
      if (typeof EQ[fn] === 'function') {
        const orig = EQ[fn];
        EQ[fn] = async function(...args) {
          const result = await orig.apply(this, args);
          // Try to extract the equipId from the most-recently-opened detail
          const equipId = NX.currentEquipId || EQ.currentEquipId;
          if (equipId) setTimeout(() => syncOneEquipment(equipId), 500);
          return result;
        };
      }
    });

    // Wrap dispatch logging via the eq-fixes openDispatchModal
    if (EQ.dispatch) {
      const orig = EQ.dispatch;
      EQ.dispatch = async function(equipId) {
        const result = await orig.call(this, equipId);
        if (equipId) setTimeout(() => syncOneEquipment(equipId), 1500);
        return result;
      };
    }

    // Wrap logService
    if (typeof EQ.logService === 'function') {
      const orig = EQ.logService;
      EQ.logService = async function(equipId, ...rest) {
        const result = await orig.call(this, equipId, ...rest);
        if (equipId) setTimeout(() => syncOneEquipment(equipId), 1000);
        return result;
      };
    }
    
    console.log('[eq-brain-sync] hooks patched');
  }

  // Expose for manual sync from console / AI tools
  NX.eqBrainSync = {
    syncOne: syncOneEquipment,
    syncAll: syncAllEquipment,
    buildNodePayload
  };

})();
