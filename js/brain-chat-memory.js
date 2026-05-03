// ════════════════════════════════════════════════════════════════════════════════
// NEXUS BRAIN-CHAT — MEMORY ARCHITECTURE (WORKS WITHOUT EMBEDDINGS)
// 
// Replaces getCtx() bloat with simple filtered queries.
// Token reduction: 36K → 4K (92%)
// No external API needed. No embeddings. Pure Supabase queries.
// ════════════════════════════════════════════════════════════════════════════════

let CURRENT_PERSONA = (window.NX && NX.getActivePersona && NX.getActivePersona()) || 'providentia';
document.addEventListener('nx-persona-change', (e) => {
  const p = e && e.detail && e.detail.persona;
  if (p === 'providentia' || p === 'trajan') CURRENT_PERSONA = p;
});

// ════════════════════════════════════════════════════════════════════════════════
// Auto-tag room based on question keywords (mirrors SQL classification)
// ════════════════════════════════════════════════════════════════════════════════

function inferRoom(question, answer) {
  const text = (question + ' ' + (answer || '')).toLowerCase();
  if (text.includes('equipment') || text.includes('repair') || text.includes('maintenance')) return 'equipment';
  if (text.includes('schedule') || text.includes('staff') || text.includes('shift')) return 'operations';
  if (text.includes('suerte')) return 'suerte';
  if (text.includes('este')) return 'este';
  if (text.includes('bar toti') || text.includes('toti')) return 'toti';
  if (text.includes('cost') || text.includes('price') || text.includes('budget')) return 'finance';
  if (text.includes('event') || text.includes('reservation') || text.includes('booking')) return 'events';
  return 'general';
}

// ════════════════════════════════════════════════════════════════════════════════
// Build context for Claude — filtered by wing (persona) + recency
// ════════════════════════════════════════════════════════════════════════════════

async function memoryGetContext(q, sessionId) {
  /**
   * Builds focused context (~2-4K tokens) instead of bloated 36K context.
   * 
   * Strategy:
   * 1. Get last 6 messages from THIS session (current conversation context)
   * 2. Get top 3 messages from same room across all sessions (topic context)  
   * 3. Add current state summary
   * 
   * No embeddings required. No external API. Pure SQL.
   */
  
  if (!NX.sb || !NX.currentUser) {
    return 'CONTEXT: User session active. Restaurants: Suerte, Este, Bar Toti.';
  }

  let ctx = '';
  const room = inferRoom(q, '');

  // 1. Last 6 messages from THIS session (within current persona)
  try {
    const { data: sessionMsgs } = await NX.sb
      .from('chat_history')
      .select('question, answer, created_at')
      .eq('session_id', sessionId)
      .eq('wing', CURRENT_PERSONA)
      .order('created_at', { ascending: false })
      .limit(6);
    
    if (sessionMsgs?.length) {
      // Reverse to chronological order
      sessionMsgs.reverse();
      ctx += 'CURRENT CONVERSATION:\n';
      sessionMsgs.forEach((m, i) => {
        ctx += `[${i+1}] User: ${m.question?.slice(0, 200) || ''}\n`;
        ctx += `    You: ${m.answer?.slice(0, 200) || ''}\n`;
      });
      ctx += '\n';
    }
  } catch (err) {
    console.warn('[memory] session context failed:', err.message);
  }

  // 2. Top 3 messages from same room (cross-session topic memory)
  try {
    const { data: roomMsgs } = await NX.sb
      .from('chat_history')
      .select('question, answer, created_at')
      .eq('wing', CURRENT_PERSONA)
      .eq('room', room)
      .neq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (roomMsgs?.length) {
      ctx += `RELATED CONTEXT (${room} room, ${CURRENT_PERSONA} wing):\n`;
      roomMsgs.forEach((m, i) => {
        ctx += `[${i+1}] User: ${m.question?.slice(0, 150) || ''}\n`;
        ctx += `    You: ${m.answer?.slice(0, 150) || ''}\n`;
      });
      ctx += '\n';
    }
  } catch (err) {
    console.warn('[memory] room context failed:', err.message);
  }

  // 3. Current state — minimal, no FULL INDEX bloat
  ctx += 'STATE:\n';
  ctx += `User: ${NX.currentUser?.name || 'Unknown'}\n`;
  ctx += `Persona: ${CURRENT_PERSONA === 'providentia' ? 'Providentia (advisor)' : 'Trajan (emperor)'}\n`;
  ctx += `Room: ${room}\n`;
  
  // Top 10 most-accessed nodes (NOT all 2811)
  const topNodes = (NX.nodes || [])
    .filter(n => !n.is_private)
    .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
    .slice(0, 10)
    .map(n => `${n.name} (${n.category})`)
    .join(', ');
  
  if (topNodes) {
    ctx += `Top items: ${topNodes}\n`;
  }

  return ctx;
}

// ════════════════════════════════════════════════════════════════════════════════
// Save message with wing + room metadata
// ════════════════════════════════════════════════════════════════════════════════

async function memorySave(sessionId, question, answer) {
  /**
   * Saves a message to chat_history with wing (persona) and room (topic) metadata.
   * Auto-tags room based on keywords.
   */
  
  if (!NX.sb || !NX.currentUser) {
    console.warn('[memory] cannot save: no Supabase or user');
    return;
  }

  const room = inferRoom(question, answer);

  try {
    const { error } = await NX.sb.from('chat_history').insert({
      session_id: sessionId,
      question,
      answer,
      user_name: NX.currentUser.name || 'Unknown',
      persona: CURRENT_PERSONA,
      wing: CURRENT_PERSONA,
      room: room,
    });
    
    if (error) {
      console.warn('[memory] save error:', error.message);
    } else {
      console.log('[memory] saved to', CURRENT_PERSONA, '/', room);
    }
  } catch (err) {
    console.warn('[memory] save exception:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Export to global namespace for brain-chat.js to use
// ════════════════════════════════════════════════════════════════════════════════

window.MEMORY = {
  getContext: memoryGetContext,
  save: memorySave,
  inferRoom: inferRoom,
};

console.log('[memory] Initialized. Wings: providentia, trajan. Rooms: suerte, este, toti, equipment, operations, finance, events, general.');
