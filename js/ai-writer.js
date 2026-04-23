/* ═══════════════════════════════════════════════════════════════════════
 * NEXUS AI WRITER — full-power agentic tool system with complete audit log
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Exposes NX.aiWriter:
 *   - TOOLS: 22-tool schema for Claude
 *   - execute(tool, params, ctx): runs a write, logs it, returns result+action row
 *   - undo(actionId): reverses an action
 *   - renderActionCard(action): DOM element for chat inline card
 *   - openActivityPanel(): full "AI Activity" view of all past actions
 *   - getToolPromptSection(): text block to append to Claude's system prompt
 *
 * Every single write:
 *   1. Checks kill switch + rate limit
 *   2. Snapshots row state BEFORE the change
 *   3. Executes the write
 *   4. Snapshots row state AFTER
 *   5. Computes inverse operation for undo
 *   6. Writes complete audit row to ai_actions
 *   7. Renders a detailed action card in chat
 *
 * ═══════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // ────────────────────────────────────────────────────────────────────
  // TOOL DEFINITIONS
  // ────────────────────────────────────────────────────────────────────
  // Schema format matches Claude's tool-use JSON.
  // `tier`: A (free writes), B (graph-structure writes), C (board writes)
  // `description` is what Claude sees — keep short but unambiguous.
  // `params` is a JSON-schema-ish shape for param validation.

  const WRITE_TOOLS = [
    // ─── TIER A: free writes (append-only, low-stakes) ──────────────
    {
      name:'add_note_to_node',
      tier:'A',
      description:'Append text to a node\'s notes. Preserves old notes in notes_history. Use to add observations about equipment, people, etc.',
      params:{node_id:'int (required)', text:'string (required) — what to append'}
    },
    {
      name:'log_contractor_event',
      tier:'A',
      description:'Record that a contractor did work at a location. Use when user mentions contractor visits, repairs, quotes.',
      params:{contractor_name:'string (required)', location:'string (Suerte|Este|Bar Toti)', event_date:'YYYY-MM-DD', description:'string', status:'pending|confirmed|completed'}
    },
    {
      name:'update_contractor_event_status',
      tier:'A',
      description:'Change the status of a contractor event (pending→confirmed→completed).',
      params:{event_id:'int (required)', status:'confirmed|completed|cancelled (required)'}
    },
    {
      name:'log_cleaning_task',
      tier:'A',
      description:'Add a new cleaning task for a location.',
      params:{location:'string (required)', task_name:'string (required)', frequency:'daily|weekly|monthly', notes:'string'}
    },
    {
      name:'complete_cleaning_task',
      tier:'A',
      description:'Mark a cleaning task as completed for today.',
      params:{task_id:'int (required)', notes:'string'}
    },
    {
      name:'create_ticket',
      tier:'A',
      description:'Open a new ticket for an issue needing attention. Use when user reports problems.',
      params:{title:'string (required)', notes:'string', location:'Suerte|Este|Bar Toti', priority:'low|normal|high|urgent'}
    },
    {
      name:'add_ticket_comment',
      tier:'A',
      description:'Add a comment/update to an existing ticket.',
      params:{ticket_id:'int (required)', comment:'string (required)'}
    },
    {
      name:'change_ticket_status',
      tier:'A',
      description:'Change a ticket\'s status (open→in_progress→resolved).',
      params:{ticket_id:'int (required)', status:'open|in_progress|resolved|closed (required)'}
    },
    {
      name:'log_daily_entry',
      tier:'A',
      description:'Write a timestamped entry in the daily log. Use for miscellaneous observations.',
      params:{entry:'string (required)'}
    },
    {
      name:'link_nodes',
      tier:'A',
      description:'Connect two nodes so they reference each other in the graph.',
      params:{node_id_a:'int (required)', node_id_b:'int (required)'}
    },
    {
      name:'unlink_nodes',
      tier:'A',
      description:'Remove a connection between two nodes.',
      params:{node_id_a:'int (required)', node_id_b:'int (required)'}
    },
    {
      name:'log_warranty',
      tier:'A',
      description:'Record warranty expiration for a piece of equipment.',
      params:{node_id:'int (required)', warranty_expires:'YYYY-MM-DD (required)', warranty_notes:'string'}
    },

    // ─── TIER B: graph-structure writes (need attribution) ──────────
    {
      name:'create_node',
      tier:'B',
      description:'Create a new knowledge node (equipment, contractor, vendor, person, etc). Use when user describes something new that should be remembered.',
      params:{
        name:'string (required)',
        category:'equipment|contractors|vendors|procedure|projects|people|systems|parts|location (required)',
        tags:'string[] (optional)',
        notes:'string',
        location:'Suerte|Este|Bar Toti (optional)'
      }
    },
    {
      name:'rename_node',
      tier:'B',
      description:'Change the name of an existing node. Keeps old name in history.',
      params:{node_id:'int (required)', new_name:'string (required)'}
    },
    {
      name:'retag_node',
      tier:'B',
      description:'Add or remove tags on a node. Pass arrays.',
      params:{node_id:'int (required)', add_tags:'string[]', remove_tags:'string[]'}
    },
    {
      name:'recategorize_node',
      tier:'B',
      description:'Change a node\'s category. Use only when category is clearly wrong.',
      params:{node_id:'int (required)', new_category:'equipment|contractors|vendors|procedure|projects|people|systems|parts|location (required)'}
    },
    {
      name:'edit_notes',
      tier:'B',
      description:'Replace a node\'s notes entirely. Keeps previous notes in notes_history. Use carefully — prefer add_note_to_node for appending.',
      params:{node_id:'int (required)', new_notes:'string (required)'}
    },
    {
      name:'schedule_pm',
      tier:'B',
      description:'Schedule preventive maintenance for a piece of equipment.',
      params:{node_id:'int (required)', pm_date:'YYYY-MM-DD (required)', pm_task:'string'}
    },

    // ─── TIER C: board tools ────────────────────────────────────────
    {
      name:'create_board_card',
      tier:'C',
      description:'Add a new card to the kanban board.',
      params:{title:'string (required)', column:'todo|doing|done', priority:'low|normal|high', notes:'string'}
    },
    {
      name:'update_board_card',
      tier:'C',
      description:'Modify a card (move to different column, change title, etc).',
      params:{card_id:'int (required)', column:'todo|doing|done (optional)', title:'string (optional)', notes:'string (optional)'}
    },
    {
      name:'archive_board_card',
      tier:'C',
      description:'Soft-delete a kanban card (sets is_archived=true).',
      params:{card_id:'int (required)', reason:'string'}
    },

    // ─── ESCAPE HATCH ────────────────────────────────────────────────
    {
      name:'propose_write',
      tier:'X',
      description:'If you want to do a write that doesn\'t match any tool above, use this to propose it. Does NOT execute — just logs the proposal for the user to review.',
      params:{proposed_action:'string (required) — describe what you wanted to do', reasoning:'string (required)'}
    }
  ];

  // ────────────────────────────────────────────────────────────────────
  // VALIDATION HELPERS
  // ────────────────────────────────────────────────────────────────────
  const VALID_CATEGORIES = ['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
  const VALID_LOCATIONS  = ['Suerte','Este','Bar Toti'];
  const VALID_PRIORITIES = ['low','normal','high','urgent'];
  const VALID_TICKET_STATUSES = ['open','in_progress','resolved','closed'];
  const VALID_CE_STATUSES = ['pending','confirmed','completed','cancelled'];
  const VALID_COLUMNS = ['todo','doing','done'];
  const VALID_FREQUENCIES = ['daily','weekly','monthly'];

  function assertString(v,name,max){
    if(typeof v!=='string'||!v.trim()) throw new Error(`Param "${name}" is required (string)`);
    if(max&&v.length>max) throw new Error(`Param "${name}" too long (max ${max})`);
    return v.trim();
  }
  function assertInt(v,name){
    const n=typeof v==='number'?v:parseInt(v,10);
    if(!Number.isFinite(n)||n<=0) throw new Error(`Param "${name}" must be a positive integer`);
    return n;
  }
  function assertEnum(v,allowed,name){
    if(!allowed.includes(v)) throw new Error(`Param "${name}" must be one of: ${allowed.join(', ')}`);
    return v;
  }
  function assertDate(v,name){
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Param "${name}" must be YYYY-MM-DD`);
    return v;
  }

  // ────────────────────────────────────────────────────────────────────
  // STATE
  // ────────────────────────────────────────────────────────────────────
  let conversationId = null;
  let conversationWriteCount = 0;

  function newConversation(){
    conversationId = 'conv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
    conversationWriteCount = 0;
    return conversationId;
  }
  function getConversationId(){
    if(!conversationId) newConversation();
    return conversationId;
  }

  // ────────────────────────────────────────────────────────────────────
  // RATE LIMIT / KILL SWITCH CHECK
  // ────────────────────────────────────────────────────────────────────
  async function checkBudget(){
    try{
      const userId = NX.currentUser?.id;
      if(!userId) return {allowed:false, reason:'No current user'};
      const {data, error} = await NX.sb.rpc('check_ai_write_budget', {
        conv_id: getConversationId(),
        user_id_param: userId
      });
      if(error){
        console.warn('[aiWriter] Budget check RPC failed:', error);
        return {allowed:true, reason:'RPC unavailable, defaulting to allowed'};
      }
      return data || {allowed:true};
    }catch(e){
      console.warn('[aiWriter] Budget check exception:', e);
      return {allowed:true};
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // SNAPSHOT — capture a row's state before/after
  // ────────────────────────────────────────────────────────────────────
  async function snapshotRow(table, rowId){
    if(!rowId) return null;
    try{
      const {data, error} = await NX.sb.from(table).select('*').eq('id',rowId).single();
      if(error) return null;
      return data;
    }catch(e){ return null; }
  }

  // ────────────────────────────────────────────────────────────────────
  // AUDIT LOG — write a row to ai_actions
  // ────────────────────────────────────────────────────────────────────
  async function logAction(actionData){
    try{
      // Collect metadata
      conversationWriteCount++;
      const row = {
        conversation_id: getConversationId(),
        user_id: NX.currentUser?.id || null,
        user_query: actionData.userQuery || null,
        ai_response_id: actionData.aiResponseId || null,
        tool_name: actionData.toolName,
        tool_tier: actionData.tier,
        params: actionData.params,
        reasoning: actionData.reasoning || null,
        reasoning_structured: actionData.reasoningStructured || null,
        sql_equivalent: actionData.sqlEquivalent || null,
        result_status: actionData.status,
        result_data: actionData.result || null,
        error_message: actionData.error || null,
        affected_table: actionData.affectedTable || null,
        affected_row_id: actionData.affectedRowId ? String(actionData.affectedRowId) : null,
        affected_row_snapshot_before: actionData.snapshotBefore || null,
        affected_row_snapshot_after: actionData.snapshotAfter || null,
        inverse_tool: actionData.inverseTool || null,
        inverse_params: actionData.inverseParams || null,
        execution_duration_ms: actionData.durationMs || null,
        conversation_position: conversationWriteCount,
        user_agent: navigator.userAgent,
        client_version: '1.0.0'
      };
      const {data, error} = await NX.sb.from('ai_actions').insert(row).select().single();
      if(error){
        console.error('[aiWriter] Audit log failed:', error);
        return null;
      }
      return data;
    }catch(e){
      console.error('[aiWriter] Audit log exception:', e);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // TOOL IMPLEMENTATIONS
  // ────────────────────────────────────────────────────────────────────
  // Each returns: {status, affectedTable, affectedRowId, snapshotBefore,
  //                snapshotAfter, inverseTool, inverseParams, result, sqlEquivalent, error?}
  //
  // Errors throw. The wrapper catches and logs as status='error'.

  const TOOL_IMPL = {};

  // ─── add_note_to_node ──────────────────────────────────────────────
  TOOL_IMPL.add_note_to_node = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const text = assertString(p.text, 'text', 5000);
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const oldNotes = before.notes || '';
    const history = Array.isArray(before.notes_history) ? before.notes_history.slice() : [];
    if(oldNotes && oldNotes.length > 5) history.push({text:oldNotes, date:new Date().toISOString().split('T')[0]});
    const newNotes = oldNotes ? `${oldNotes}\n\n[AI ${new Date().toLocaleDateString()}] ${text}` : `[AI ${new Date().toLocaleDateString()}] ${text}`;
    const {error} = await NX.sb.from('nodes').update({
      notes: newNotes,
      notes_history: history.slice(-10),
      ai_last_modified_at: new Date().toISOString()
    }).eq('id', node_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_restore_notes', inverseParams:{node_id, notes:oldNotes, notes_history:before.notes_history || []},
      result:{node_name:before.name, new_notes_length:newNotes.length},
      sqlEquivalent:`update nodes set notes=... where id=${node_id}`
    };
  };

  // ─── log_contractor_event ──────────────────────────────────────────
  TOOL_IMPL.log_contractor_event = async (p) => {
    const contractor_name = assertString(p.contractor_name, 'contractor_name', 200);
    const location = p.location ? assertEnum(p.location, VALID_LOCATIONS, 'location') : null;
    const event_date = p.event_date ? assertDate(p.event_date, 'event_date') : new Date().toISOString().split('T')[0];
    const description = (p.description || '').slice(0, 1000);
    const status = p.status ? assertEnum(p.status, VALID_CE_STATUSES, 'status') : 'pending';
    const {data, error} = await NX.sb.from('contractor_events').insert({
      contractor_name, location, event_date, description, status, ai_created: true
    }).select().single();
    if(error) throw new Error(error.message);
    return {
      status:'success',
      affectedTable:'contractor_events', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'_hard_delete_row', inverseParams:{table:'contractor_events', id:data.id},
      result:{event_id:data.id, summary:`${contractor_name} @ ${location||'?'} on ${event_date}`},
      sqlEquivalent:`insert into contractor_events (...) values (...)`
    };
  };

  // ─── update_contractor_event_status ────────────────────────────────
  TOOL_IMPL.update_contractor_event_status = async (p) => {
    const event_id = assertInt(p.event_id, 'event_id');
    const status = assertEnum(p.status, VALID_CE_STATUSES, 'status');
    const before = await snapshotRow('contractor_events', event_id);
    if(!before) throw new Error(`Event ${event_id} not found`);
    const {error} = await NX.sb.from('contractor_events').update({status}).eq('id', event_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('contractor_events', event_id);
    return {
      status:'success',
      affectedTable:'contractor_events', affectedRowId:event_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'update_contractor_event_status', inverseParams:{event_id, status:before.status},
      result:{from:before.status, to:status},
      sqlEquivalent:`update contractor_events set status='${status}' where id=${event_id}`
    };
  };

  // ─── log_cleaning_task ─────────────────────────────────────────────
  TOOL_IMPL.log_cleaning_task = async (p) => {
    const location = assertString(p.location, 'location', 100);
    const task_name = assertString(p.task_name, 'task_name', 200);
    const frequency = p.frequency ? assertEnum(p.frequency, VALID_FREQUENCIES, 'frequency') : 'daily';
    const notes = (p.notes || '').slice(0, 1000);
    const entry = `[CLEAN] ${location} / ${task_name} / ${frequency}${notes?' — '+notes:''}`;
    const {data, error} = await NX.sb.from('cleaning_logs').insert({
      entry, location, task_name, frequency, notes, ai_created: true
    }).select().single();
    if(error){
      // Fallback — schema might only have `entry`
      const r2 = await NX.sb.from('cleaning_logs').insert({entry, ai_created:true}).select().single();
      if(r2.error) throw new Error(r2.error.message);
      return {
        status:'success', affectedTable:'cleaning_logs', affectedRowId:r2.data.id,
        snapshotBefore:null, snapshotAfter:r2.data,
        inverseTool:'_hard_delete_row', inverseParams:{table:'cleaning_logs', id:r2.data.id},
        result:{id:r2.data.id, entry},
        sqlEquivalent:`insert into cleaning_logs (entry) values (...)`
      };
    }
    return {
      status:'success',
      affectedTable:'cleaning_logs', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'_hard_delete_row', inverseParams:{table:'cleaning_logs', id:data.id},
      result:{id:data.id, entry},
      sqlEquivalent:`insert into cleaning_logs (...) values (...)`
    };
  };

  // ─── complete_cleaning_task ────────────────────────────────────────
  TOOL_IMPL.complete_cleaning_task = async (p) => {
    const task_id = assertInt(p.task_id, 'task_id');
    const notes = (p.notes || '').slice(0, 500);
    const before = await snapshotRow('cleaning_logs', task_id);
    if(!before) throw new Error(`Cleaning task ${task_id} not found`);
    const completedAt = new Date().toISOString();
    const {error} = await NX.sb.from('cleaning_logs').update({
      completed_at: completedAt,
      completion_notes: notes
    }).eq('id', task_id);
    if(error){
      // Fallback — append to entry field if schema doesn't have completed_at
      const newEntry = (before.entry||'') + ` ✓ completed ${completedAt.split('T')[0]}${notes?' '+notes:''}`;
      const r2 = await NX.sb.from('cleaning_logs').update({entry:newEntry}).eq('id', task_id);
      if(r2.error) throw new Error(r2.error.message);
    }
    const after = await snapshotRow('cleaning_logs', task_id);
    return {
      status:'success',
      affectedTable:'cleaning_logs', affectedRowId:task_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_revert_row', inverseParams:{table:'cleaning_logs', id:task_id, snapshot:before},
      result:{id:task_id, completed_at:completedAt},
      sqlEquivalent:`update cleaning_logs set completed_at=... where id=${task_id}`
    };
  };

  // ─── create_ticket ─────────────────────────────────────────────────
  TOOL_IMPL.create_ticket = async (p) => {
    const title = assertString(p.title, 'title', 200);
    const notes = (p.notes || '').slice(0, 2000);
    const location = p.location ? assertEnum(p.location, VALID_LOCATIONS, 'location') : null;
    const priority = p.priority ? assertEnum(p.priority, VALID_PRIORITIES, 'priority') : 'normal';
    const {data, error} = await NX.sb.from('tickets').insert({
      title, notes, location, priority, status:'open',
      reported_by: NX.currentUser?.name || 'AI',
      ai_created: true
    }).select().single();
    if(error) throw new Error(error.message);
    // Stage S: push notification to managers. AI-created tickets
    // are often from the daily brief or chat flow — managers
    // benefit from being alerted fast.
    if (NX.notifyTicketCreated) NX.notifyTicketCreated(data);
    return {
      status:'success',
      affectedTable:'tickets', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'_hard_delete_row', inverseParams:{table:'tickets', id:data.id},
      result:{ticket_id:data.id, title, priority},
      sqlEquivalent:`insert into tickets (title, notes, ...) values (...)`
    };
  };

  // ─── add_ticket_comment ────────────────────────────────────────────
  TOOL_IMPL.add_ticket_comment = async (p) => {
    const ticket_id = assertInt(p.ticket_id, 'ticket_id');
    const comment = assertString(p.comment, 'comment', 2000);
    const before = await snapshotRow('tickets', ticket_id);
    if(!before) throw new Error(`Ticket ${ticket_id} not found`);
    const oldNotes = before.notes || '';
    const newNotes = oldNotes + `\n\n[AI ${new Date().toLocaleDateString()}] ${comment}`;
    const {error} = await NX.sb.from('tickets').update({notes:newNotes}).eq('id', ticket_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('tickets', ticket_id);
    return {
      status:'success',
      affectedTable:'tickets', affectedRowId:ticket_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_revert_field', inverseParams:{table:'tickets', id:ticket_id, field:'notes', value:oldNotes},
      result:{ticket_id, comment_length:comment.length},
      sqlEquivalent:`update tickets set notes=... where id=${ticket_id}`
    };
  };

  // ─── change_ticket_status ──────────────────────────────────────────
  TOOL_IMPL.change_ticket_status = async (p) => {
    const ticket_id = assertInt(p.ticket_id, 'ticket_id');
    const status = assertEnum(p.status, VALID_TICKET_STATUSES, 'status');
    const before = await snapshotRow('tickets', ticket_id);
    if(!before) throw new Error(`Ticket ${ticket_id} not found`);
    const {error} = await NX.sb.from('tickets').update({status}).eq('id', ticket_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('tickets', ticket_id);
    return {
      status:'success',
      affectedTable:'tickets', affectedRowId:ticket_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'change_ticket_status', inverseParams:{ticket_id, status:before.status},
      result:{from:before.status, to:status},
      sqlEquivalent:`update tickets set status='${status}' where id=${ticket_id}`
    };
  };

  // ─── log_daily_entry ───────────────────────────────────────────────
  TOOL_IMPL.log_daily_entry = async (p) => {
    const entry = assertString(p.entry, 'entry', 5000);
    const aiEntry = `[AI] ${entry}`;
    const {data, error} = await NX.sb.from('daily_logs').insert({entry:aiEntry, ai_created:true}).select().single();
    if(error) throw new Error(error.message);
    return {
      status:'success',
      affectedTable:'daily_logs', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'_hard_delete_row', inverseParams:{table:'daily_logs', id:data.id},
      result:{id:data.id, entry:aiEntry.slice(0,100)},
      sqlEquivalent:`insert into daily_logs (entry) values ('${aiEntry.slice(0,40)}...')`
    };
  };

  // ─── link_nodes ────────────────────────────────────────────────────
  TOOL_IMPL.link_nodes = async (p) => {
    const node_id_a = assertInt(p.node_id_a, 'node_id_a');
    const node_id_b = assertInt(p.node_id_b, 'node_id_b');
    if(node_id_a === node_id_b) throw new Error('Cannot link a node to itself');
    const a = await snapshotRow('nodes', node_id_a);
    const b = await snapshotRow('nodes', node_id_b);
    if(!a) throw new Error(`Node ${node_id_a} not found`);
    if(!b) throw new Error(`Node ${node_id_b} not found`);
    const aLinks = Array.isArray(a.links) ? a.links.slice() : [];
    const bLinks = Array.isArray(b.links) ? b.links.slice() : [];
    if(!aLinks.includes(node_id_b)) aLinks.push(node_id_b);
    if(!bLinks.includes(node_id_a)) bLinks.push(node_id_a);
    const {error:ea} = await NX.sb.from('nodes').update({links:aLinks, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id_a);
    if(ea) throw new Error(ea.message);
    const {error:eb} = await NX.sb.from('nodes').update({links:bLinks, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id_b);
    if(eb) throw new Error(eb.message);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id_a,
      snapshotBefore:{a_links:a.links, b_links:b.links}, snapshotAfter:{a_links:aLinks, b_links:bLinks},
      inverseTool:'unlink_nodes', inverseParams:{node_id_a, node_id_b},
      result:{linked:`${a.name} <-> ${b.name}`},
      sqlEquivalent:`update nodes set links=... where id in (${node_id_a}, ${node_id_b})`
    };
  };

  // ─── unlink_nodes ──────────────────────────────────────────────────
  TOOL_IMPL.unlink_nodes = async (p) => {
    const node_id_a = assertInt(p.node_id_a, 'node_id_a');
    const node_id_b = assertInt(p.node_id_b, 'node_id_b');
    const a = await snapshotRow('nodes', node_id_a);
    const b = await snapshotRow('nodes', node_id_b);
    if(!a) throw new Error(`Node ${node_id_a} not found`);
    if(!b) throw new Error(`Node ${node_id_b} not found`);
    const aLinks = (Array.isArray(a.links) ? a.links : []).filter(x => x !== node_id_b);
    const bLinks = (Array.isArray(b.links) ? b.links : []).filter(x => x !== node_id_a);
    await NX.sb.from('nodes').update({links:aLinks, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id_a);
    await NX.sb.from('nodes').update({links:bLinks, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id_b);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id_a,
      snapshotBefore:{a_links:a.links, b_links:b.links}, snapshotAfter:{a_links:aLinks, b_links:bLinks},
      inverseTool:'link_nodes', inverseParams:{node_id_a, node_id_b},
      result:{unlinked:`${a.name} </> ${b.name}`},
      sqlEquivalent:`update nodes set links=... where id in (${node_id_a}, ${node_id_b})`
    };
  };

  // ─── log_warranty ──────────────────────────────────────────────────
  TOOL_IMPL.log_warranty = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const warranty_expires = assertDate(p.warranty_expires, 'warranty_expires');
    const warranty_notes = (p.warranty_notes || '').slice(0, 500);
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const update = {
      warranty_expires,
      warranty_notes,
      ai_last_modified_at: new Date().toISOString()
    };
    const {error} = await NX.sb.from('nodes').update(update).eq('id', node_id);
    if(error){
      // Fallback — write to notes if schema doesn't have warranty_expires
      const oldNotes = before.notes || '';
      const newNotes = oldNotes + `\n\n[AI WARRANTY] Expires: ${warranty_expires}${warranty_notes?' — '+warranty_notes:''}`;
      await NX.sb.from('nodes').update({notes:newNotes, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id);
    }
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_revert_row', inverseParams:{table:'nodes', id:node_id, snapshot:before},
      result:{node:before.name, warranty_expires},
      sqlEquivalent:`update nodes set warranty_expires='${warranty_expires}' where id=${node_id}`
    };
  };

  // ─── create_node (TIER B) ──────────────────────────────────────────
  TOOL_IMPL.create_node = async (p) => {
    const name = assertString(p.name, 'name', 200);
    const category = assertEnum(p.category, VALID_CATEGORIES, 'category');
    const tags = Array.isArray(p.tags) ? p.tags.filter(t=>typeof t==='string').slice(0,20) : [];
    const notes = (p.notes || '').slice(0, 5000);
    const location = p.location ? assertEnum(p.location, VALID_LOCATIONS, 'location') : null;
    // Duplicate name check
    const existing = NX.nodes.find(n => (n.name||'').toLowerCase() === name.toLowerCase());
    if(existing) throw new Error(`Node named "${name}" already exists (id=${existing.id})`);
    const row = {
      name, category, tags, notes, location,
      links:[], access_count:1,
      source_emails:[{from:'AI', subject:'Created by AI', date:new Date().toISOString().split('T')[0]}],
      ai_created: true,
      owner_id: NX.currentUser?.id || null
    };
    const {data, error} = await NX.sb.from('nodes').insert(row).select().single();
    if(error) throw new Error(error.message);
    // Update local NX.nodes immediately so other code sees it
    NX.nodes.push(data);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'_archive_node', inverseParams:{node_id:data.id, reason:'Reverted AI creation'},
      result:{node_id:data.id, name, category},
      sqlEquivalent:`insert into nodes (name, category, ...) values ('${name}', '${category}', ...)`
    };
  };

  // ─── rename_node ───────────────────────────────────────────────────
  TOOL_IMPL.rename_node = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const new_name = assertString(p.new_name, 'new_name', 200);
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const {error} = await NX.sb.from('nodes').update({
      name:new_name,
      ai_last_modified_at:new Date().toISOString()
    }).eq('id', node_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('nodes', node_id);
    // Update local cache
    const local = NX.nodes.find(n => n.id === node_id);
    if(local) local.name = new_name;
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'rename_node', inverseParams:{node_id, new_name:before.name},
      result:{from:before.name, to:new_name},
      sqlEquivalent:`update nodes set name='${new_name}' where id=${node_id}`
    };
  };

  // ─── retag_node ────────────────────────────────────────────────────
  TOOL_IMPL.retag_node = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const addTags = Array.isArray(p.add_tags) ? p.add_tags : [];
    const removeTags = Array.isArray(p.remove_tags) ? p.remove_tags : [];
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const currentTags = Array.isArray(before.tags) ? before.tags.slice() : [];
    const removeSet = new Set(removeTags.map(t=>t.toLowerCase()));
    let newTags = currentTags.filter(t => !removeSet.has(t.toLowerCase()));
    for(const t of addTags){
      if(typeof t === 'string' && t.trim() && !newTags.includes(t.trim())) newTags.push(t.trim());
    }
    newTags = newTags.slice(0,20);
    const {error} = await NX.sb.from('nodes').update({tags:newTags, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'retag_node', inverseParams:{node_id, add_tags:removeTags, remove_tags:addTags},
      result:{from:currentTags, to:newTags},
      sqlEquivalent:`update nodes set tags=... where id=${node_id}`
    };
  };

  // ─── recategorize_node ─────────────────────────────────────────────
  TOOL_IMPL.recategorize_node = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const new_category = assertEnum(p.new_category, VALID_CATEGORIES, 'new_category');
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const {error} = await NX.sb.from('nodes').update({
      category:new_category,
      ai_last_modified_at:new Date().toISOString()
    }).eq('id', node_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'recategorize_node', inverseParams:{node_id, new_category:before.category},
      result:{from:before.category, to:new_category},
      sqlEquivalent:`update nodes set category='${new_category}' where id=${node_id}`
    };
  };

  // ─── edit_notes ────────────────────────────────────────────────────
  TOOL_IMPL.edit_notes = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const new_notes = assertString(p.new_notes, 'new_notes', 10000);
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const oldNotes = before.notes || '';
    const history = Array.isArray(before.notes_history) ? before.notes_history.slice() : [];
    if(oldNotes && oldNotes.length > 5) history.push({text:oldNotes, date:new Date().toISOString().split('T')[0]});
    const {error} = await NX.sb.from('nodes').update({
      notes:new_notes,
      notes_history:history.slice(-10),
      ai_last_modified_at:new Date().toISOString()
    }).eq('id', node_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'edit_notes', inverseParams:{node_id, new_notes:oldNotes},
      result:{node:before.name, old_length:oldNotes.length, new_length:new_notes.length},
      sqlEquivalent:`update nodes set notes=... where id=${node_id}`
    };
  };

  // ─── schedule_pm ───────────────────────────────────────────────────
  TOOL_IMPL.schedule_pm = async (p) => {
    const node_id = assertInt(p.node_id, 'node_id');
    const pm_date = assertDate(p.pm_date, 'pm_date');
    const pm_task = (p.pm_task || '').slice(0, 500);
    const before = await snapshotRow('nodes', node_id);
    if(!before) throw new Error(`Node ${node_id} not found`);
    const update = {
      next_pm_date: pm_date,
      next_pm_task: pm_task,
      ai_last_modified_at: new Date().toISOString()
    };
    const {error} = await NX.sb.from('nodes').update(update).eq('id', node_id);
    if(error){
      // Fallback — write to notes
      const oldNotes = before.notes || '';
      const newNotes = oldNotes + `\n\n[AI PM] Scheduled ${pm_date}${pm_task?': '+pm_task:''}`;
      await NX.sb.from('nodes').update({notes:newNotes, ai_last_modified_at:new Date().toISOString()}).eq('id', node_id);
    }
    const after = await snapshotRow('nodes', node_id);
    return {
      status:'success',
      affectedTable:'nodes', affectedRowId:node_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_revert_row', inverseParams:{table:'nodes', id:node_id, snapshot:before},
      result:{node:before.name, pm_date, pm_task},
      sqlEquivalent:`update nodes set next_pm_date='${pm_date}' where id=${node_id}`
    };
  };

  // ─── create_board_card ─────────────────────────────────────────────
  TOOL_IMPL.create_board_card = async (p) => {
    const title = assertString(p.title, 'title', 200);
    const column = p.column ? assertEnum(p.column, VALID_COLUMNS, 'column') : 'todo';
    const priority = p.priority ? assertEnum(p.priority, ['low','normal','high'], 'priority') : 'normal';
    const notes = (p.notes || '').slice(0, 2000);
    const {data, error} = await NX.sb.from('kanban_cards').insert({
      title, column_name:column, priority, notes, ai_created:true
    }).select().single();
    if(error) throw new Error(error.message);
    return {
      status:'success',
      affectedTable:'kanban_cards', affectedRowId:data.id,
      snapshotBefore:null, snapshotAfter:data,
      inverseTool:'archive_board_card', inverseParams:{card_id:data.id, reason:'Reverted AI creation'},
      result:{card_id:data.id, title, column},
      sqlEquivalent:`insert into kanban_cards (title, column_name, ...) values (...)`
    };
  };

  // ─── update_board_card ─────────────────────────────────────────────
  TOOL_IMPL.update_board_card = async (p) => {
    const card_id = assertInt(p.card_id, 'card_id');
    const before = await snapshotRow('kanban_cards', card_id);
    if(!before) throw new Error(`Card ${card_id} not found`);
    const update = {};
    if(p.column) update.column_name = assertEnum(p.column, VALID_COLUMNS, 'column');
    if(p.title) update.title = assertString(p.title, 'title', 200);
    if(p.notes !== undefined) update.notes = (p.notes || '').slice(0, 2000);
    if(Object.keys(update).length === 0) throw new Error('No fields to update');
    const {error} = await NX.sb.from('kanban_cards').update(update).eq('id', card_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('kanban_cards', card_id);
    return {
      status:'success',
      affectedTable:'kanban_cards', affectedRowId:card_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_revert_row', inverseParams:{table:'kanban_cards', id:card_id, snapshot:before},
      result:{card_id, changes:update},
      sqlEquivalent:`update kanban_cards set ... where id=${card_id}`
    };
  };

  // ─── archive_board_card ────────────────────────────────────────────
  TOOL_IMPL.archive_board_card = async (p) => {
    const card_id = assertInt(p.card_id, 'card_id');
    const reason = (p.reason || 'Archived by AI').slice(0, 500);
    const before = await snapshotRow('kanban_cards', card_id);
    if(!before) throw new Error(`Card ${card_id} not found`);
    const {error} = await NX.sb.from('kanban_cards').update({
      is_archived:true,
      archived_at:new Date().toISOString()
    }).eq('id', card_id);
    if(error) throw new Error(error.message);
    const after = await snapshotRow('kanban_cards', card_id);
    return {
      status:'success',
      affectedTable:'kanban_cards', affectedRowId:card_id,
      snapshotBefore:before, snapshotAfter:after,
      inverseTool:'_unarchive_board_card', inverseParams:{card_id},
      result:{card_id, title:before.title, reason},
      sqlEquivalent:`update kanban_cards set is_archived=true where id=${card_id}`
    };
  };

  // ─── propose_write (escape hatch — logs, does NOT execute) ──────────
  TOOL_IMPL.propose_write = async (p) => {
    const proposed_action = assertString(p.proposed_action, 'proposed_action', 1000);
    const reasoning = assertString(p.reasoning, 'reasoning', 2000);
    return {
      status:'success',
      affectedTable:null, affectedRowId:null,
      snapshotBefore:null, snapshotAfter:null,
      inverseTool:null, inverseParams:null,
      result:{proposed_action, reasoning, note:'Proposal logged — not executed. Review in AI Activity panel.'},
      sqlEquivalent:'-- no execute — proposal only'
    };
  };

  // ────────────────────────────────────────────────────────────────────
  // INVERSE OPERATIONS (internal — only called by undo)
  // ────────────────────────────────────────────────────────────────────
  const INVERSE_IMPL = {
    _hard_delete_row: async (p) => {
      const {error} = await NX.sb.from(p.table).delete().eq('id', p.id);
      if(error) throw new Error(error.message);
      return {undone:true};
    },
    _revert_row: async (p) => {
      const {snapshot, table, id} = p;
      if(!snapshot) throw new Error('No snapshot to restore');
      const restore = {...snapshot};
      delete restore.id; delete restore.created_at;
      const {error} = await NX.sb.from(table).update(restore).eq('id', id);
      if(error) throw new Error(error.message);
      return {undone:true};
    },
    _revert_field: async (p) => {
      const {table, id, field, value} = p;
      const {error} = await NX.sb.from(table).update({[field]:value}).eq('id', id);
      if(error) throw new Error(error.message);
      return {undone:true};
    },
    _restore_notes: async (p) => {
      const {error} = await NX.sb.from('nodes').update({
        notes: p.notes,
        notes_history: p.notes_history || []
      }).eq('id', p.node_id);
      if(error) throw new Error(error.message);
      return {undone:true};
    },
    _archive_node: async (p) => {
      const {error} = await NX.sb.from('nodes').update({
        is_archived:true,
        archived_at:new Date().toISOString(),
        archived_reason:p.reason || 'Reverted'
      }).eq('id', p.node_id);
      if(error) throw new Error(error.message);
      // Remove from local cache
      NX.nodes = NX.nodes.filter(n => n.id !== p.node_id);
      return {undone:true};
    },
    _unarchive_board_card: async (p) => {
      const {error} = await NX.sb.from('kanban_cards').update({
        is_archived:false,
        archived_at:null
      }).eq('id', p.card_id);
      if(error) throw new Error(error.message);
      return {undone:true};
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // EXECUTE — the main entry point
  // ────────────────────────────────────────────────────────────────────
  async function execute(toolName, params, ctx){
    const t0 = performance.now();
    const tool = WRITE_TOOLS.find(t => t.name === toolName);
    if(!tool){
      return {status:'error', error:`Unknown tool: ${toolName}`, logged:null};
    }

    // Budget check
    const budget = await checkBudget();
    if(!budget.allowed){
      const logged = await logAction({
        toolName, tier:tool.tier, params,
        status:'blocked', error:budget.reason,
        userQuery: ctx?.userQuery, aiResponseId: ctx?.aiResponseId,
        reasoning: ctx?.reasoning, durationMs: Math.round(performance.now()-t0)
      });
      return {status:'blocked', error:budget.reason, logged};
    }

    // Execute
    let result, logged;
    try{
      const impl = TOOL_IMPL[toolName];
      if(!impl) throw new Error(`Tool ${toolName} has no implementation`);
      result = await impl(params);
      result.durationMs = Math.round(performance.now() - t0);
      logged = await logAction({
        toolName, tier:tool.tier, params,
        status:result.status,
        result:result.result,
        affectedTable:result.affectedTable, affectedRowId:result.affectedRowId,
        snapshotBefore:result.snapshotBefore, snapshotAfter:result.snapshotAfter,
        inverseTool:result.inverseTool, inverseParams:result.inverseParams,
        sqlEquivalent:result.sqlEquivalent,
        userQuery: ctx?.userQuery, aiResponseId: ctx?.aiResponseId,
        reasoning: ctx?.reasoning,
        durationMs: result.durationMs
      });
    }catch(e){
      logged = await logAction({
        toolName, tier:tool.tier, params,
        status:'error', error:e.message,
        userQuery: ctx?.userQuery, aiResponseId: ctx?.aiResponseId,
        reasoning: ctx?.reasoning, durationMs: Math.round(performance.now()-t0)
      });
      return {status:'error', error:e.message, logged};
    }
    return {...result, logged};
  }

  // ────────────────────────────────────────────────────────────────────
  // UNDO — reverses a logged action
  // ────────────────────────────────────────────────────────────────────
  async function undo(actionId){
    const {data:action, error} = await NX.sb.from('ai_actions').select('*').eq('id', actionId).single();
    if(error || !action) return {ok:false, error:'Action not found'};
    if(action.reverted) return {ok:false, error:'Already reverted'};
    if(!action.inverse_tool) return {ok:false, error:'No inverse operation recorded — cannot undo'};

    try{
      const impl = INVERSE_IMPL[action.inverse_tool] || TOOL_IMPL[action.inverse_tool];
      if(!impl) throw new Error(`Inverse tool ${action.inverse_tool} not implemented`);
      await impl(action.inverse_params);

      // Log the undo itself as a new ai_action row
      const undoLog = await logAction({
        toolName: '_undo:' + action.tool_name,
        tier: 'undo',
        params: {original_action_id: actionId},
        status:'success',
        affectedTable: action.affected_table,
        affectedRowId: action.affected_row_id,
        reasoning: 'User-requested undo',
        result: {reverted_action: actionId, original_tool: action.tool_name}
      });

      // Mark original as reverted
      await NX.sb.from('ai_actions').update({
        reverted:true,
        reverted_at:new Date().toISOString(),
        reverted_by_action_id: undoLog?.id || null
      }).eq('id', actionId);

      return {ok:true};
    }catch(e){
      return {ok:false, error:e.message};
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // SYSTEM PROMPT SECTION — what Claude sees
  // ────────────────────────────────────────────────────────────────────
  function getToolPromptSection(){
    return `

WRITE TOOLS (you can use these to modify the brain — every write is logged):
To use a write tool, respond with ONLY a JSON object: {"tool":"tool_name","params":{...},"reasoning":"one sentence why"}
Include a "reasoning" field — it goes into the audit log.
You have up to 8 write tool uses per conversation. Use them when the user clearly wants action taken.

Available write tools:
${WRITE_TOOLS.map(t => `- ${t.name} [tier ${t.tier}]: ${t.description}\n    params: ${JSON.stringify(t.params)}`).join('\n')}

IMPORTANT:
- For any user message that describes something to record, remember, update, or schedule — USE a tool.
- Tier A tools are free — just use them. Tier B tools (node creation/renaming) are higher-stakes — include detailed reasoning.
- If the user wants something done that doesn't match any tool, use propose_write.
- When finished with writes, give a normal text reply summarizing what you did.
- NEVER fabricate IDs. Use search_nodes first to find real IDs if needed.`;
  }

  // ────────────────────────────────────────────────────────────────────
  // UI — ACTION CARD (inline in chat, detailed)
  // ────────────────────────────────────────────────────────────────────
  function renderActionCard(logged){
    const card = document.createElement('div');
    card.className = 'ai-action-card ' + (logged.result_status === 'success' ? 'success'
                                        : logged.result_status === 'blocked' ? 'blocked'
                                        : 'error');
    card.dataset.actionId = logged.id || '';

    const icon = logged.result_status === 'success' ? '⚡'
               : logged.result_status === 'blocked' ? '🔒'
               : '⚠';
    const statusColor = logged.result_status === 'success' ? 'var(--accent)'
                      : logged.result_status === 'blocked' ? 'var(--muted)'
                      : 'var(--red)';

    // Summary line
    const summary = document.createElement('div');
    summary.className = 'aac-summary';
    const affected = logged.affected_table ? `${logged.affected_table}${logged.affected_row_id?'#'+logged.affected_row_id:''}` : '';
    summary.innerHTML = `<span class="aac-icon">${icon}</span>
      <span class="aac-tool">${logged.tool_name}</span>
      ${affected?'<span class="aac-target">'+affected+'</span>':''}
      <span class="aac-expand">▾</span>`;
    card.appendChild(summary);

    // Detail panel (hidden by default)
    const detail = document.createElement('div');
    detail.className = 'aac-detail';
    detail.style.display = 'none';

    const addRow = (label, value, mono) => {
      if(value === undefined || value === null || value === '') return;
      const row = document.createElement('div');
      row.className = 'aac-row';
      const pretty = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      row.innerHTML = `<div class="aac-label">${label}</div><div class="aac-value${mono?' mono':''}">${escapeHtml(pretty)}</div>`;
      detail.appendChild(row);
    };

    addRow('Tool', `${logged.tool_name} (tier ${logged.tool_tier||'?'})`);
    addRow('Status', logged.result_status);
    if(logged.error_message) addRow('Error', logged.error_message);
    addRow('Reasoning', logged.reasoning);
    addRow('Params', logged.params, true);
    if(logged.result_data) addRow('Result', logged.result_data, true);
    if(logged.affected_table) addRow('Affected', `${logged.affected_table} row ${logged.affected_row_id}`);
    addRow('SQL', logged.sql_equivalent, true);
    if(logged.execution_duration_ms) addRow('Duration', logged.execution_duration_ms + 'ms');
    addRow('Logged at', new Date(logged.created_at).toLocaleString());
    addRow('Conversation', `${logged.conversation_id} (#${logged.conversation_position})`);
    addRow('Audit ID', logged.id, true);

    // Action buttons
    const btns = document.createElement('div');
    btns.className = 'aac-btns';
    if(logged.result_status === 'success' && logged.inverse_tool && !logged.reverted){
      const undoBtn = document.createElement('button');
      undoBtn.className = 'aac-btn aac-undo';
      undoBtn.textContent = '↶ Undo';
      undoBtn.addEventListener('click', async () => {
        undoBtn.textContent = '…';
        undoBtn.disabled = true;
        const r = await undo(logged.id);
        if(r.ok){
          undoBtn.textContent = '✓ Undone';
          card.classList.add('reverted');
          logged.reverted = true;
        }else{
          undoBtn.textContent = '✕ ' + (r.error || 'Failed');
          setTimeout(() => { undoBtn.disabled = false; undoBtn.textContent = '↶ Undo'; }, 3000);
        }
      });
      btns.appendChild(undoBtn);
    }
    if(logged.reverted){
      const marker = document.createElement('span');
      marker.className = 'aac-reverted-marker';
      marker.textContent = '✓ Reverted';
      btns.appendChild(marker);
    }
    detail.appendChild(btns);
    card.appendChild(detail);

    // Toggle expand on summary tap
    summary.addEventListener('click', () => {
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : 'block';
      summary.querySelector('.aac-expand').textContent = open ? '▾' : '▴';
    });

    return card;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ────────────────────────────────────────────────────────────────────
  // UI — ACTIVITY PANEL (full audit log view)
  // ────────────────────────────────────────────────────────────────────
  async function openActivityPanel(){
    // Create or reuse panel
    let panel = document.getElementById('aiActivityPanel');
    if(panel){ panel.classList.add('open'); await refreshActivityPanel(); return; }

    panel = document.createElement('div');
    panel.id = 'aiActivityPanel';
    panel.className = 'ai-activity-panel open';
    panel.innerHTML = `
      <div class="aap-header">
        <div class="aap-title">AI Activity</div>
        <button class="aap-close">✕</button>
      </div>
      <div class="aap-filters">
        <button class="aap-filter active" data-filter="all">All</button>
        <button class="aap-filter" data-filter="success">Success</button>
        <button class="aap-filter" data-filter="error">Errors</button>
        <button class="aap-filter" data-filter="blocked">Blocked</button>
        <button class="aap-filter" data-filter="reverted">Reverted</button>
      </div>
      <div class="aap-list" id="aapList">Loading…</div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.aap-close').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelectorAll('.aap-filter').forEach(b => {
      b.addEventListener('click', () => {
        panel.querySelectorAll('.aap-filter').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        refreshActivityPanel(b.dataset.filter);
      });
    });
    await refreshActivityPanel();
  }

  async function refreshActivityPanel(filter){
    filter = filter || 'all';
    const list = document.getElementById('aapList');
    if(!list) return;
    list.innerHTML = 'Loading…';
    let query = NX.sb.from('ai_actions').select('*').order('created_at', {ascending:false}).limit(200);
    if(filter === 'success') query = query.eq('result_status', 'success');
    if(filter === 'error') query = query.eq('result_status', 'error');
    if(filter === 'blocked') query = query.eq('result_status', 'blocked');
    if(filter === 'reverted') query = query.eq('reverted', true);
    const {data, error} = await query;
    if(error){ list.innerHTML = 'Error loading: ' + error.message; return; }
    if(!data || !data.length){ list.innerHTML = '<div class="aap-empty">No actions yet.</div>'; return; }

    list.innerHTML = '';
    for(const action of data){
      const card = renderActionCard(action);
      card.classList.add('aap-item');
      list.appendChild(card);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────────────────────────
  window.NX = window.NX || {};
  NX.aiWriter = {
    TOOLS: WRITE_TOOLS,
    execute,
    undo,
    renderActionCard,
    openActivityPanel,
    refreshActivityPanel,
    getToolPromptSection,
    newConversation,
    getConversationId,
    checkBudget
  };

  console.log('[aiWriter] Loaded with', WRITE_TOOLS.length, 'tools');
})();
