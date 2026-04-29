/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Board v4 — Restaurant Operations Board

   Trello-level project management, adapted for physical restaurant ops.
   Every card can link to:
     • equipment (what's broken)
     • location (which restaurant)
     • priority (urgent/high/normal/low — with colored bar)
     • photos (snap-and-attach from phone)
     • dispatch event (which contractor call was made)

   Mobile-first: tap-to-move via column picker (drag is fragile on touch).
   Desktop still supports drag-and-drop as a secondary affordance.

   Exports (used by other modules):
     NX.modules.board.init() / .show()
     NX.modules.board.createFromEquipment(equipment, issue) — used by equipment.js
     NX.modules.board.getOpenCardsForEquipment(id) — used by equipment.js
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────
const PRIORITIES = {
  urgent: { label: 'Urgent', color: '#d45858', rank: 4 },
  high:   { label: 'High',   color: '#e8a830', rank: 3 },
  normal: { label: 'Normal', color: '',        rank: 2 },
  low:    { label: 'Low',    color: '#5b9bd5', rank: 1 },
};

const LOCATIONS = [
  { key: 'suerte', label: 'Suerte', color: '#c8a44e' },
  { key: 'este',   label: 'Este',   color: '#a88fd8' },
  { key: 'toti',   label: 'Toti',   color: '#5bba5f' },
];

const LABEL_COLORS = ['#d45858','#e8a830','#5bba5f','#5b9bd5','#a88fd8','#d4a44e','#6b9bf0','#a49c94'];

// Default list structure when a brand-new board is created
const DEFAULT_LISTS = [
  { name: 'Reported',          position: 0 },
  { name: 'Triaged',           position: 1 },
  { name: 'Dispatched',        position: 2 },
  { name: 'In Progress',       position: 3 },
  { name: 'Waiting on Parts',  position: 4 },
  { name: 'Resolved',          position: 5 },
  { name: 'Closed',            position: 6 },
];

// ─────────────────────────────────────────────────────────────────────────
// STYLES (injected once into <head>)
// ─────────────────────────────────────────────────────────────────────────
const STYLES = `
  /* boardWrap is now a flex column filling the active view area, so the
     b-lists row inside can flex:1 down to the bottom of the viewport.
     Previously the wrap was content-sized — columns floated in upper-left.
     min-height:0 is critical for the inner overflow to work in flex. */
  #boardWrap{padding:0 8px 80px;font-family:inherit;display:flex;flex-direction:column;min-height:calc(100vh - 120px)}
  /* Active view container should also be a flex column on desktop */
  .view#boardView.active{display:flex;flex-direction:column}
  .b-summary{display:flex;gap:10px;padding:12px 12px 8px;font-size:12px;flex-wrap:wrap;align-items:center;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:8px}
  .b-summary-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:var(--text,#d4c8a5)}
  .b-summary-chip.alert{background:rgba(212,88,88,0.15);color:#e88;border:1px solid rgba(212,88,88,0.3)}
  .b-summary-chip.ok{background:rgba(91,186,95,0.10);color:#8fd492}
  .b-summary-chip.tap{cursor:pointer;user-select:none}
  .b-summary-chip.tap:active{transform:scale(0.97)}

  /* ── REALTIME PIP + TOAST STACK ──────────────────────────────
     Pip: small pill with connection dot + presence count. Sits
     leftmost in the summary strip so it's always visible.
     Toast stack: bottom-right corner, stacks up to 3, auto-dismiss.
     Separate from global NX.toast so bulk moves don't spam main UI. */
  .b-rt-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);font-size:11px;color:var(--text-dim,#a49c94);font-variant-numeric:tabular-nums}
  .b-rt-dot{width:7px;height:7px;border-radius:50%;background:var(--text-faint,#746c5e);flex-shrink:0;transition:background .3s,box-shadow .3s}
  .b-rt-dot.is-live{background:#5bba5f;box-shadow:0 0 6px rgba(91,186,95,.6);animation:bRtPulse 2.4s ease-in-out infinite}
  @keyframes bRtPulse{0%,100%{opacity:1}50%{opacity:.55}}
  .b-rt-toast-stack{position:fixed;bottom:80px;right:10px;display:flex;flex-direction:column;gap:6px;z-index:999;pointer-events:none;max-width:min(320px,calc(100vw - 20px))}
  .b-rt-toast{background:rgba(20,18,14,0.95);border:1px solid rgba(200,164,78,0.25);border-left:3px solid #5bba5f;color:var(--text,#d4c8a5);padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:bRtToastIn .22s cubic-bezier(0.2,0.8,0.2,1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .b-rt-toast.is-leaving{animation:bRtToastOut .3s ease forwards}
  @keyframes bRtToastIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
  @keyframes bRtToastOut{to{transform:translateX(20px);opacity:0}}
  .b-summary-stats-btn{margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text,#d4c8a5);padding:5px 12px;border-radius:12px;font-size:11px;cursor:pointer}

  .board-header{display:flex;align-items:center;gap:4px;overflow-x:auto;padding:4px 0 12px;scrollbar-width:none}
  .board-header::-webkit-scrollbar{display:none}
  .board-tab{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--text,#d4c8a5);padding:6px 12px;border-radius:14px;font-size:12px;cursor:pointer;white-space:nowrap;border-left-width:3px}
  .board-tab.active{background:rgba(200,164,78,0.12);border-color:#c8a44e}
  .board-add-tab{font-weight:bold;padding:6px 10px}

  .b-filters{display:flex;gap:6px;padding:0 4px 8px;overflow-x:auto;scrollbar-width:none}
  .b-filters::-webkit-scrollbar{display:none}
  .b-filter{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:var(--text-dim,#a49c94);padding:4px 10px;border-radius:10px;font-size:11px;cursor:pointer;white-space:nowrap}
  .b-filter.active{background:rgba(200,164,78,0.15);color:#c8a44e;border-color:#c8a44e}

  .b-lists{display:flex;gap:10px;overflow-x:auto;padding-bottom:20px;scrollbar-width:thin;flex:1;min-height:0;align-items:stretch}
  /* Columns now fill the available vertical space rather than collapsing
     to their content height. min-height ensures empty columns don't
     vanish; flex:1 makes the column body grow to use whatever's left
     after summary + filter strips. The earlier max-height calc was
     leaving a giant void below short columns on desktop. */
  .b-list{flex:0 0 300px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:10px;display:flex;flex-direction:column;min-height:240px;max-height:calc(100vh - 200px)}
  /* Wider on desktop where there's room */
  @media(min-width:900px){
    .b-list{flex:0 0 320px}
  }
  .b-list-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:2px 2px 6px;border-bottom:1px solid rgba(255,255,255,0.05)}
  .b-list-name{font-weight:600;font-size:13px;flex:1;color:var(--text,#d4c8a5)}
  .b-list-count{font-size:11px;color:var(--text-dim,#a49c94);background:rgba(255,255,255,0.05);padding:2px 7px;border-radius:8px}
  .b-list-cards{flex:1;overflow-y:auto;min-height:30px;margin:0 -2px;padding:0 2px;scrollbar-width:thin}
  .b-list-cards.drag-over{background:rgba(200,164,78,0.05);border-radius:6px}
  /* Add card button — was a wispy dashed rectangle. Now a calm solid
     affordance that stands out as "press here" without screaming. */
  .b-list-add{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);color:var(--text-dim,#a49c94);padding:10px;border-radius:8px;cursor:pointer;margin-top:6px;width:100%;font-size:12.5px;font-family:inherit;transition:all .15s}
  .b-list-add:hover{background:rgba(200,164,78,0.06);border-color:rgba(200,164,78,0.25);color:var(--accent,#c8a44e)}
  .b-list-add:active{transform:scale(0.99)}

  /* Terminal list collapse — Done/Closed/Resolved/Complete/Archived default
     to a single-line summary. Tap the header to expand. Saves screen real
     estate on mobile by hiding completed work. */
  .b-list.is-terminal{background:rgba(20,18,14,0.4);opacity:.85}
  .b-list.is-terminal .b-list-head{color:var(--text-dim,#a49c94)}
  .b-list-collapse-icon{display:inline-block;margin-right:6px;color:var(--text-dim,#a49c94);font-size:10px;transition:transform .15s;user-select:none}
  .b-list.is-collapsed{min-height:auto}
  .b-list.is-collapsed .b-list-cards,
  .b-list.is-collapsed .b-list-add{display:none}

  /* ═══════════════════════════════════════════════════════════════════
     CARD — Trello-style
     cover (image, bleeds to edges) → strip (label color bar) → body
     ═══════════════════════════════════════════════════════════════════ */
  .b-card{position:relative;background:rgba(20,18,14,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin-bottom:8px;cursor:pointer;overflow:hidden;transition:transform .15s,box-shadow .15s,border-color .15s}
  .b-card:active{transform:scale(0.98)}
  .b-card:hover{border-color:rgba(200,164,78,0.2);box-shadow:0 4px 14px rgba(0,0,0,0.3)}
  /* Cover — bleed image at top, like Trello */
  .b-card-cover{width:100%;height:140px;overflow:hidden;background:rgba(255,255,255,0.02);position:relative}
  .b-card-cover img{width:100%;height:100%;object-fit:cover;display:block}
  /* Category color strip — instant visual grouping by label */
  .b-card-strip{height:3px;width:100%;background:transparent;flex-shrink:0}
  /* Body padding separate from cover so cover bleeds edge-to-edge */
  .b-card-body{padding:10px 12px 10px 12px;position:relative}
  .b-card-title{font-size:13px;font-weight:500;color:var(--text,#d4c8a5);margin-bottom:6px;line-height:1.35}
  .b-card-labels{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
  .b-card-label{font-size:10px;padding:2px 7px;border-radius:8px;color:#1a1408;font-weight:600}
  .b-card-badges{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px}
  .b-card-badge{display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.05);color:var(--text-dim,#a49c94)}
  .b-card-badge.pri-urgent{background:rgba(212,88,88,0.15);color:#e88;font-weight:600}
  .b-card-badge.pri-high{background:rgba(232,168,48,0.15);color:#e8a830}
  .b-card-badge.loc{font-weight:500}
  .b-card-badge.eq{background:rgba(200,164,78,0.10);color:#c8a44e}
  .b-card-badge.overdue{background:rgba(212,88,88,0.20);color:#e88;font-weight:600}
  .b-card-meta{display:flex;gap:8px;font-size:10px;color:var(--text-faint,#746c5e);margin-top:4px;align-items:center;flex-wrap:wrap}
  /* Meta sub-variants — age + due date urgency coloring */
  .b-card-meta-due-soon{color:#e88;font-weight:600}
  .b-card-meta-due-warn{color:#e8a830;font-weight:500}
  .b-card-meta-age{color:#746c5e}
  .b-card-meta-age-warn{color:#e8a830;font-weight:500}
  .b-card-meta-age-old{color:#e88;font-weight:600}
  .b-card-meta-progress{color:#e8a830}
  .b-card-meta-done{color:#5bba5f}
  .b-card-meta-assignee{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(200,164,78,0.2);color:#c8a44e;font-size:9px;font-weight:700;margin-right:-2px}
  /* Done card — fade + strike title. Cards stay visible in their terminal
     list but read as archived-in-place rather than active work. */
  .b-card.is-done{opacity:.55}
  .b-card.is-done .b-card-title{text-decoration:line-through;color:var(--text-dim,#a49c94)}
  .b-card.is-done .b-card-cover img{filter:grayscale(.6)}
  .b-card-move-btn{position:absolute;top:6px;right:6px;background:rgba(255,255,255,0.06);border:0;color:var(--text-dim,#a49c94);padding:3px 8px;border-radius:10px;font-size:10px;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
  .b-card:hover .b-card-move-btn,.b-card.show-move .b-card-move-btn{opacity:1}
  @media(hover:none){.b-card-move-btn{opacity:1}}

  /* Detail modal */
  .b-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:20px 10px;overflow-y:auto;animation:bfade .15s ease}
  @keyframes bfade{from{opacity:0}to{opacity:1}}
  .b-modal{background:#1a1408;border:1px solid rgba(200,164,78,0.2);border-radius:12px;width:100%;max-width:600px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6)}
  .b-modal-head{display:flex;align-items:flex-start;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02)}
  .b-modal-title{flex:1;background:transparent;border:0;color:var(--text,#d4c8a5);font-size:15px;font-weight:600;outline:none;font-family:inherit}
  .b-modal-close{background:transparent;border:0;color:var(--text-dim,#a49c94);font-size:18px;cursor:pointer;padding:4px 8px}
  .b-modal-body{padding:14px 16px;max-height:70vh;overflow-y:auto}
  .b-section{margin-bottom:16px}
  .b-section-label{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-faint,#746c5e);margin-bottom:4px}
  .b-field{width:100%;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:var(--text,#d4c8a5);padding:8px 10px;border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box}
  .b-field:focus{outline:none;border-color:rgba(200,164,78,0.4)}
  textarea.b-field{resize:vertical;min-height:60px}
  select.b-field{cursor:pointer}
  .b-field-row{display:flex;gap:8px}
  .b-field-row > *{flex:1;min-width:0}

  .b-eq-embed{background:rgba(200,164,78,0.06);border:1px solid rgba(200,164,78,0.2);border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;cursor:pointer}
  .b-eq-embed:active{background:rgba(200,164,78,0.10)}
  .b-eq-embed-icon{font-size:20px}
  .b-eq-embed-body{flex:1;min-width:0}
  .b-eq-embed-name{font-weight:600;font-size:13px;color:#c8a44e;margin-bottom:2px}
  .b-eq-embed-meta{font-size:11px;color:var(--text-dim,#a49c94)}
  .b-eq-embed-chev{color:var(--text-faint,#746c5e)}

  .b-photos{display:flex;gap:6px;flex-wrap:wrap}
  .b-photo{width:80px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04)}
  .b-photo-add{width:80px;height:80px;border:1px dashed rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-dim,#a49c94);font-size:20px;cursor:pointer;background:transparent}

  .b-check{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:var(--text,#d4c8a5)}
  .b-check input[type=checkbox]{accent-color:#c8a44e;width:16px;height:16px;cursor:pointer}
  .b-check.done span{text-decoration:line-through;color:var(--text-faint,#746c5e)}
  .b-check-add{display:flex;gap:6px;margin-top:6px}
  .b-check-add input{flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:var(--text,#d4c8a5);padding:5px 8px;border-radius:4px;font-size:12px}
  .b-check-add button{background:rgba(200,164,78,0.15);border:1px solid rgba(200,164,78,0.3);color:#c8a44e;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px}

  .b-comment{padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:4px;margin-bottom:4px;font-size:12px}
  .b-comment-by{color:#c8a44e;font-weight:600;margin-right:6px}
  .b-comment-time{color:var(--text-faint,#746c5e);font-size:10px}

  /* Translate button on the description label + its rendered output.
     Button is a subtle pill; output is a cream-background blockquote
     styled to clearly mark "this is machine-translated, not the real
     stored value you're editing above". */
  .b-tr-btn{float:right;background:transparent;border:1px solid rgba(200,164,78,0.35);color:#c8a44e;font-size:10px;padding:3px 8px;border-radius:10px;cursor:pointer;font-family:inherit;letter-spacing:0.3px}
  .b-tr-btn:active{transform:scale(0.96)}
  .b-tr-out{margin-top:8px;padding:10px 12px;background:rgba(200,164,78,0.05);border-left:2px solid rgba(200,164,78,0.4);border-radius:4px;color:var(--text,#d4c8a5);font-size:12.5px;line-height:1.5;white-space:pre-wrap}

  .b-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);margin-top:10px}
  .b-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--text,#d4c8a5);padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}
  .b-btn:active{background:rgba(255,255,255,0.08)}
  .b-btn-primary{background:linear-gradient(135deg,#c8a44e,#d4b86a);color:#1a1408;border-color:#c8a44e}
  .b-btn-danger{background:rgba(212,88,88,0.1);color:#e88;border-color:rgba(212,88,88,0.3)}

  /* Move picker */
  .b-move-modal{max-width:360px}
  .b-move-list{display:flex;flex-direction:column;gap:6px;padding:14px}
  .b-move-item{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:var(--text,#d4c8a5);padding:12px 14px;border-radius:8px;cursor:pointer;font-size:13px;text-align:left;display:flex;align-items:center;gap:8px}
  .b-move-item.current{opacity:0.45;cursor:default}
  .b-move-item:not(.current):active{background:rgba(200,164,78,0.1);border-color:#c8a44e}

  /* Stats modal */
  .b-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
  .b-stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px}
  .b-stat-num{font-size:22px;font-weight:700;color:var(--text,#d4c8a5);margin-bottom:2px}
  .b-stat-num.alert{color:#e88}
  .b-stat-num.ok{color:#8fd492}
  .b-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-faint,#746c5e)}
`;

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────
let boards = [], activeBoard = null, lists = [], cards = [], stats = null;
let equipmentCache = [];     // for the equipment picker in the card modal
let filters = { priority:null, location:null, equipment:null };
let dragCard = null, dragOverListId = null;

// ── REALTIME + PERF STATE ────────────────────────────────────────────
// rtChannel:      Supabase Realtime channel, one per active board. Torn
//                 down on tab-switch-away or visibilitychange(hidden).
// rtConnected:    UI indicator — does the header dot glow or not.
// lastFetchAt:    Used by stale-while-revalidate. show() skips refetch
//                 if subscription is alive and data was pulled recently.
// pendingRender:  Debounce timer. Rapid bursts of realtime events
//                 (e.g. bulk moves) collapse to one render per ~80ms.
// presenceCount:  Other active users on this board (from Realtime
//                 presence). Rendered as a small pip in the header.
// optimisticSet:  IDs of cards with a locally-applied change we're
//                 waiting to confirm. If realtime echoes our own write
//                 back, we don't double-render flash.
let rtChannel = null;
let rtConnected = false;
let lastFetchAt = 0;
let pendingRender = null;
let presenceCount = 0;
const optimisticSet = new Set();

// ─────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────
function esc(s){ if(s==null)return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function injectStyles(){
  if(document.getElementById('nexus-board-v4-styles'))return;
  const s=document.createElement('style');
  s.id='nexus-board-v4-styles';
  s.textContent=STYLES;
  document.head.appendChild(s);
}

function priorityInfo(key){ return PRIORITIES[key] || PRIORITIES.normal; }
function locationInfo(key){ return LOCATIONS.find(l => l.key === key) || null; }

function timeAgo(ts){
  if(!ts)return '';
  const diff = Date.now() - new Date(ts).getTime();
  if(diff < 60000) return 'now';
  if(diff < 3600000) return Math.floor(diff/60000)+'m';
  if(diff < 86400000) return Math.floor(diff/3600000)+'h';
  if(diff < 30*86400000) return Math.floor(diff/86400000)+'d';
  return Math.floor(diff/(30*86400000))+'mo';
}

// A card is "done" if its current list is a terminal state. Matches any
// reasonable naming: Done, Closed, Resolved, Complete, Completed, Archive.
// Terminal cards shouldn't count in open/urgent/overdue summaries, and
// they should read visually as archived-in-place rather than active work.
function isDone(card){
  const cname = (card.column_name || '').toLowerCase();
  if(cname) return /^(done|closed|resolved|complete|completed|archived?)$/.test(cname);
  // Fallback — look up the card's list and check its name
  const list = lists.find(l => l.id === card.list_id);
  if(!list) return false;
  const n = (list.name || '').toLowerCase();
  return /(done|closed|resolved|complete|archived?)/.test(n);
}

function isOverdue(card){
  // Terminal-state cards are never overdue regardless of due_date. A ticket
  // marked done yesterday with a due_date last week is resolved, not overdue.
  if (isDone(card)) return false;
  return card.due_date && new Date(card.due_date) < new Date(new Date().toDateString());
}

// Sanitize for tel: / href injection
function safeAttr(s){ return String(s||'').replace(/[<>"'`\n]/g,''); }

// ─────────────────────────────────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────────────────────────────────
async function loadBoards(){
  try{
    const { data } = await NX.sb.from('boards').select('*').eq('archived', false).order('position');
    boards = data || [];
    if(!boards.length){
      // Create default "Operations" board with the restaurant-ops column structure
      const { data: nb } = await NX.sb.from('boards')
        .insert({ name: 'Operations', color: '#c8a44e', position: 0 })
        .select().single();
      if(nb){
        boards = [nb];
        await NX.sb.from('board_lists').insert(
          DEFAULT_LISTS.map(l => ({ ...l, board_id: nb.id }))
        );
      }
    }
    if(!activeBoard && boards.length) activeBoard = boards[0];
  }catch(e){ console.error('[board] loadBoards:', e); }
}

async function loadLists(){
  if(!activeBoard) return;
  try{
    const { data } = await NX.sb.from('board_lists')
      .select('*').eq('board_id', activeBoard.id).order('position');
    lists = data || [];
  }catch(e){ console.error('[board] loadLists:', e); lists = []; }
}

async function loadCards(){
  if(!activeBoard) return;
  try{
    const { data } = await NX.sb.from('kanban_cards')
      .select('*')
      .eq('board_id', activeBoard.id)
      .eq('archived', false)
      .order('position');
    cards = data || [];
    lastFetchAt = Date.now();
  }catch(e){ console.error('[board] loadCards:', e); cards = []; }
}

// ── REALTIME + EFFICIENCY LAYER ──────────────────────────────────────
// Debounced render — collapses rapid bursts of events (bulk moves, a
// colleague opening a card modal that nudges updated_at) into one paint
// at ~80ms cadence. Keeps scroll + drag stable during noisy periods.
function renderSoon(){
  if(pendingRender) return;
  pendingRender = setTimeout(() => {
    pendingRender = null;
    render();
  }, 80);
}

// Apply a postgres_changes event from Supabase Realtime to local state.
// We keep mutations surgical: splice the affected card in/out of `cards`
// rather than re-fetching the whole board. Debounced render then paints.
function applyRealtimeChange(payload){
  const ev = payload.eventType || payload.event;
  const row = payload.new || payload.old;
  if(!row) return;
  // If this is an echo of our own optimistic update, skip the re-render
  // flash. We already put the UI in the right state locally.
  if(optimisticSet.has(row.id)){
    // Reconcile in case the server coerced fields (default, trigger).
    if(ev === 'UPDATE' || ev === 'INSERT'){
      const idx = cards.findIndex(c => c.id === row.id);
      if(idx >= 0) cards[idx] = row;
    }
    optimisticSet.delete(row.id);
    return;
  }
  if(ev === 'INSERT'){
    // Only add if it belongs to our active board + isn't archived
    if(row.board_id !== activeBoard?.id) return;
    if(row.archived) return;
    // Dedupe — if we already have it (e.g. local creation), skip
    if(cards.some(c => c.id === row.id)) return;
    cards.push(row);
    toastRealtime(`+ "${truncate(row.title, 36)}"`);
    renderSoon();
  }else if(ev === 'UPDATE'){
    const idx = cards.findIndex(c => c.id === row.id);
    if(idx === -1){
      // Wasn't in our set — maybe un-archived, maybe board switched here
      if(row.board_id === activeBoard?.id && !row.archived){
        cards.push(row);
        renderSoon();
      }
      return;
    }
    // Archive = remove
    if(row.archived){
      cards.splice(idx, 1);
      renderSoon();
      return;
    }
    // Detect a column move for the toast — "Ana moved X to In Progress"
    const old = cards[idx];
    if(old.list_id !== row.list_id){
      const targetList = lists.find(l => l.id === row.list_id);
      toastRealtime(`→ "${truncate(row.title, 28)}" → ${targetList?.name || 'moved'}`);
    }
    cards[idx] = row;
    renderSoon();
  }else if(ev === 'DELETE'){
    const idx = cards.findIndex(c => c.id === row.id);
    if(idx >= 0){ cards.splice(idx, 1); renderSoon(); }
  }
}

// Subscribe to live changes on kanban_cards for the active board. One
// channel per board; torn down on tab-away or visibility-hidden so we
// don't accumulate subscriptions across sessions.
function subscribeRealtime(){
  if(!activeBoard || !NX.sb?.channel) return;
  if(rtChannel) return; // already subscribed
  try{
    rtChannel = NX.sb.channel(`board:${activeBoard.id}`, {
      config: { presence: { key: NX.currentUser?.name || 'anon' } }
    })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kanban_cards',
        filter: `board_id=eq.${activeBoard.id}`,
      }, applyRealtimeChange)
      // Presence — who else is viewing this board right now.
      .on('presence', { event: 'sync' }, () => {
        const state = rtChannel.presenceState();
        // Total presence keys minus ourselves = others
        const keys = Object.keys(state);
        presenceCount = Math.max(0, keys.length - 1);
        updatePresenceIndicator();
      })
      .subscribe(async (status) => {
        if(status === 'SUBSCRIBED'){
          rtConnected = true;
          updatePresenceIndicator();
          // Announce ourselves
          try{ await rtChannel.track({ user: NX.currentUser?.name || 'anon', at: new Date().toISOString() }); }catch(_){}
        }else{
          rtConnected = false;
          updatePresenceIndicator();
        }
      });
  }catch(e){
    console.warn('[board] realtime subscribe failed:', e);
    rtConnected = false;
  }
}

function unsubscribeRealtime(){
  if(!rtChannel) return;
  try{ NX.sb.removeChannel(rtChannel); }catch(_){}
  rtChannel = null;
  rtConnected = false;
  presenceCount = 0;
}

// Small corner toast for realtime events — separate from the global
// NX.toast to avoid spamming the main toast stack on busy boards.
// Stacks up to 3 messages, auto-dismiss after 2.5s each.
let rtToastContainer = null;
function toastRealtime(msg){
  if(!rtToastContainer){
    rtToastContainer = document.createElement('div');
    rtToastContainer.className = 'b-rt-toast-stack';
    document.body.appendChild(rtToastContainer);
  }
  const t = document.createElement('div');
  t.className = 'b-rt-toast';
  t.textContent = msg;
  rtToastContainer.appendChild(t);
  // Cap stack at 3 so bulk operations don't flood the screen
  while(rtToastContainer.children.length > 3) rtToastContainer.removeChild(rtToastContainer.firstChild);
  setTimeout(() => { t.classList.add('is-leaving'); }, 2200);
  setTimeout(() => t.remove(), 2500);
}

function truncate(s, n){ s = String(s||''); return s.length > n ? s.slice(0,n-1)+'…' : s; }

// Paint the presence indicator into the header strip. Called by both
// the renderer and by subscribe callbacks. Safe to call if header DOM
// isn't present yet (gated by existence check).
function updatePresenceIndicator(){
  const dot = document.getElementById('bRtDot');
  const lbl = document.getElementById('bRtLabel');
  if(!dot || !lbl) return;
  if(rtConnected){
    dot.className = 'b-rt-dot is-live';
    if(presenceCount === 0) lbl.textContent = 'Live';
    else if(presenceCount === 1) lbl.textContent = '+1 live';
    else lbl.textContent = `+${presenceCount} live`;
  }else{
    dot.className = 'b-rt-dot';
    lbl.textContent = 'Offline';
  }
}

async function loadStats(){
  try{
    const { data } = await NX.sb.from('board_stats').select('*').single();
    stats = data || null;
  }catch(e){ /* view may not exist until SQL migration run */ stats = null; }
}

async function loadEquipmentCache(){
  if(equipmentCache.length) return equipmentCache;
  try{
    const { data } = await NX.sb.from('equipment')
      .select('id, name, location')
      .order('name').limit(500);
    equipmentCache = data || [];
  }catch(e){ equipmentCache = []; }
  return equipmentCache;
}

// ─────────────────────────────────────────────────────────────────────────
// FILTERING
// ─────────────────────────────────────────────────────────────────────────
function applyFilters(cardList){
  return cardList.filter(c => {
    if(filters.priority && c.priority !== filters.priority) return false;
    if(filters.location && c.location !== filters.location) return false;
    if(filters.equipment && c.equipment_id !== filters.equipment) return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — top-level
// ─────────────────────────────────────────────────────────────────────────
function render(){
  injectStyles();
  const wrap = document.getElementById('boardWrap');
  if(!wrap) return;
  wrap.innerHTML = '';
  wrap.appendChild(renderSummaryStrip());
  wrap.appendChild(renderBoardHeader());
  wrap.appendChild(renderFilterBar());
  wrap.appendChild(renderLists());
  // Paint the live pip AFTER the DOM is in place — the renderer writes
  // #bRtDot / #bRtLabel placeholders, we update their class+text now.
  updatePresenceIndicator();
}

function renderSummaryStrip(){
  const strip = document.createElement('div');
  strip.className = 'b-summary';

  // Open = cards not in a terminal list. Previously this counted EVERY
  // non-archived card, so moving a ticket to Done still showed it in
  // "3 open" — confusing. Now: done cards don't count toward active
  // workload, they're still visible in their column but grayed out.
  const openCards = cards.filter(c => !isDone(c));
  const doneCards = cards.filter(c => isDone(c));
  const open = openCards.length;
  const overdue = openCards.filter(isOverdue).length;
  const urgent = openCards.filter(c => c.priority === 'urgent').length;

  // Cards closed in the last 7 days — derive from updated_at on done cards
  // if the board_stats view isn't around. Gives same "closed this week"
  // feedback without depending on that SQL view existing.
  const weekAgo = Date.now() - 7*24*60*60*1000;
  const closedThisWeek = doneCards.filter(c => {
    const ts = c.updated_at || c.created_at;
    return ts && new Date(ts).getTime() >= weekAgo;
  }).length;

  let html = '';
  // Realtime pip — leftmost, shows connection state + presence count
  html += `<span class="b-rt-chip"><span class="b-rt-dot" id="bRtDot"></span><span id="bRtLabel">—</span></span>`;
  html += `<span class="b-summary-chip ${open>0?'':'ok'}"><strong>${open}</strong> open</span>`;
  if(overdue > 0) html += `<span class="b-summary-chip alert"><strong>${overdue}</strong> overdue</span>`;
  if(urgent > 0) html += `<span class="b-summary-chip alert">🚨 <strong>${urgent}</strong> urgent</span>`;
  if(stats && stats.avg_close_days_30d != null){
    html += `<span class="b-summary-chip">avg close <strong>${Number(stats.avg_close_days_30d).toFixed(1)}d</strong></span>`;
  }
  if(closedThisWeek > 0){
    html += `<span class="b-summary-chip ok">✓ ${closedThisWeek} done this week</span>`;
  }
  // Clean Up button only appears when there's meaningful backlog
  if(open > 30){
    html += `<button class="b-summary-stats-btn" id="bCleanUpBtn" style="background:rgba(212,88,88,0.15);border-color:rgba(212,88,88,0.3);color:#e88">🧹 Clean Up</button>`;
  }
  html += `<button class="b-summary-stats-btn" id="bStatsBtn">📊 Stats</button>`;
  strip.innerHTML = html;
  strip.querySelector('#bStatsBtn').addEventListener('click', openStatsModal);
  const cleanBtn = strip.querySelector('#bCleanUpBtn');
  if(cleanBtn) cleanBtn.addEventListener('click', openTriageModal);
  return strip;
}

function renderBoardHeader(){
  const header = document.createElement('div');
  header.className = 'board-header';
  header.innerHTML = boards.map(b => {
    const active = b.id === activeBoard?.id ? ' active' : '';
    return `<button class="board-tab${active}" data-bid="${b.id}" style="border-left-color:${b.color||'#c8a44e'}">${esc(b.name)}</button>`;
  }).join('') + '<button class="board-tab board-add-tab" id="bAddBoard">+</button>';

  header.querySelectorAll('.board-tab[data-bid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Switching boards — tear down current subscription, load new
      // board's data, subscribe to its channel.
      unsubscribeRealtime();
      activeBoard = boards.find(b => b.id == btn.dataset.bid);
      await loadLists(); await loadCards();
      render();
      subscribeRealtime();
    });
  });
  header.querySelector('#bAddBoard').addEventListener('click', promptNewBoard);
  return header;
}

function renderFilterBar(){
  const bar = document.createElement('div');
  bar.className = 'b-filters';
  const mk = (key, val, label, color) => {
    const active = filters[key] === val ? ' active' : '';
    const style = color ? `style="border-color:${color}"` : '';
    return `<button class="b-filter${active}" data-key="${key}" data-val="${val||''}" ${style}>${label}</button>`;
  };
  let html = '';
  html += mk('priority', null, 'All', null);
  html += mk('priority', 'urgent', '🚨 Urgent', '#d45858');
  html += mk('priority', 'high',   '⚠ High',   '#e8a830');
  html += mk('priority', 'low',    'Low',      '#5b9bd5');
  html += `<span style="width:8px"></span>`;
  LOCATIONS.forEach(l => {
    html += mk('location', l.key, l.label, l.color);
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.b-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key, v = btn.dataset.val || null;
      filters[k] = (filters[k] === v) ? null : v;
      render();
    });
  });
  return bar;
}

function renderLists(){
  const wrapper = document.createElement('div');
  wrapper.className = 'b-lists';

  const visibleCards = applyFilters(cards);

  lists.forEach(list => {
    const listEl = document.createElement('div');
    listEl.className = 'b-list';

    const listCards = visibleCards
      .filter(c => c.list_id === list.id)
      .sort((a,b) => (a.position||0) - (b.position||0));

    // Terminal lists (Done/Closed/Resolved/Complete/Archived) collapse to
    // a single summary line by default — matches Trello's "show done"
    // pattern. User taps the header to expand. Persists per-board.
    const listNameLC = (list.name || '').toLowerCase();
    const isTerminal = /(done|closed|resolved|complete|archived?)/.test(listNameLC);
    const collapseKey = `nx_board_collapse_${activeBoard?.id || 0}_${list.id}`;
    const userCollapsed = localStorage.getItem(collapseKey);
    // Default: terminal lists start collapsed, non-terminal start expanded
    const collapsed = userCollapsed !== null
      ? userCollapsed === '1'
      : isTerminal;
    if(collapsed) listEl.classList.add('is-collapsed');
    if(isTerminal) listEl.classList.add('is-terminal');

    const head = document.createElement('div');
    head.className = 'b-list-head';
    const collapseIcon = isTerminal ? `<span class="b-list-collapse-icon">${collapsed ? '▸' : '▾'}</span>` : '';
    head.innerHTML = `${collapseIcon}<div class="b-list-name">${esc(list.name)}</div>
      <div class="b-list-count">${listCards.length}</div>`;
    // Click header on terminal list → toggle collapse
    if(isTerminal){
      head.style.cursor = 'pointer';
      head.addEventListener('click', (e) => {
        // Don't trigger on count badge tap etc. — only on the list-head itself
        if(e.target.closest('button')) return;
        const nowCollapsed = !listEl.classList.contains('is-collapsed');
        listEl.classList.toggle('is-collapsed', nowCollapsed);
        localStorage.setItem(collapseKey, nowCollapsed ? '1' : '0');
        // Update chevron
        const ci = head.querySelector('.b-list-collapse-icon');
        if(ci) ci.textContent = nowCollapsed ? '▸' : '▾';
      });
    }
    listEl.appendChild(head);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'b-list-cards';
    cardsWrap.dataset.listId = list.id;

    // Desktop drag support (mobile uses Move button)
    cardsWrap.addEventListener('dragover', e => {
      e.preventDefault();
      cardsWrap.classList.add('drag-over');
      dragOverListId = list.id;
    });
    cardsWrap.addEventListener('dragleave', () => cardsWrap.classList.remove('drag-over'));
    cardsWrap.addEventListener('drop', async e => {
      e.preventDefault();
      cardsWrap.classList.remove('drag-over');
      if(dragCard && dragCard.list_id !== list.id){
        await moveCard(dragCard, list);
      }
      dragCard = null;
    });

    listCards.forEach(c => cardsWrap.appendChild(createCardEl(c)));
    listEl.appendChild(cardsWrap);

    const addBtn = document.createElement('button');
    addBtn.className = 'b-list-add';
    addBtn.textContent = '+ Add card';
    addBtn.addEventListener('click', () => promptNewCard(list.id));
    listEl.appendChild(addBtn);

    wrapper.appendChild(listEl);
  });

  // Add list button
  const addListEl = document.createElement('div');
  addListEl.className = 'b-list';
  addListEl.style.background = 'transparent';
  addListEl.style.border = '1px dashed rgba(255,255,255,0.1)';
  addListEl.innerHTML = `<button class="b-list-add" style="margin:0">+ Add list</button>`;
  addListEl.querySelector('button').addEventListener('click', promptNewList);
  wrapper.appendChild(addListEl);

  return wrapper;
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — single card (Trello-style)
// ─────────────────────────────────────────────────────────────────────────
function createCardEl(card){
  const el = document.createElement('div');
  el.className = 'b-card';
  if(isDone(card)) el.classList.add('is-done');
  el.draggable = true;
  el.dataset.cardId = card.id;

  const pri = priorityInfo(card.priority);
  const loc = locationInfo(card.location);
  const overdue = isOverdue(card);
  const done = isDone(card);

  // Cover image — Trello-style bleed at top of card. First photo in
  // photo_urls wins. On done cards we still show it but dimmed.
  const cover = (card.photo_urls || [])[0];
  let html = '';
  if(cover){
    html += `<div class="b-card-cover"><img src="${esc(cover)}" loading="lazy" alt=""></div>`;
  }

  // Category color strip — a 4px bar at the top of the card body,
  // colored by the first label. Gives instant visual grouping across
  // columns the way Trello uses label strips. If there's no label and
  // no priority color, fall back to a faint neutral so the strip never
  // vanishes entirely (vanishing strips made cards look broken).
  const firstLabel = (card.labels || [])[0];
  const stripColor = firstLabel?.color || pri.color || 'rgba(200,164,78,0.18)';
  html += `<div class="b-card-strip" style="background:${stripColor}"></div>`;

  // Body (padded content — separate from cover so cover bleeds to edges)
  html += '<div class="b-card-body">';

  // Move button (visible on mobile always, on desktop on hover)
  html += `<button class="b-card-move-btn" data-move="${card.id}">→ Move</button>`;

  // Labels (small chips, more Trello-ish — already exists, just more compact)
  if((card.labels||[]).length){
    html += `<div class="b-card-labels">${
      card.labels.map(l => `<span class="b-card-label" style="background:${l.color||'#a49c94'}">${esc(l.name||'')}</span>`).join('')
    }</div>`;
  }

  // Title
  html += `<div class="b-card-title">${esc(card.title||'')}</div>`;

  // Badges row — priority, location, equipment, overdue
  const badges = [];
  if(card.priority === 'urgent') badges.push(`<span class="b-card-badge pri-urgent">🚨 URGENT</span>`);
  else if(card.priority === 'high') badges.push(`<span class="b-card-badge pri-high">⚠ HIGH</span>`);
  if(loc) badges.push(`<span class="b-card-badge loc" style="color:${loc.color}">📍 ${esc(loc.label)}</span>`);
  if(card.equipment_id) badges.push(`<span class="b-card-badge eq">🔧 Equipment</span>`);
  if(overdue) badges.push(`<span class="b-card-badge overdue">📅 OVERDUE</span>`);
  if(badges.length) html += `<div class="b-card-badges">${badges.join('')}</div>`;

  // Meta row: checklist progress, comments, due, assignee, age
  const meta = [];
  const cl = card.checklist || [];
  if(cl.length){
    const doneChecks = cl.filter(c=>c.done).length;
    const pct = doneChecks/cl.length;
    const cls = pct===1 ? 'b-card-meta-done' : (pct>=0.5 ? 'b-card-meta-progress' : '');
    meta.push(`<span class="${cls}">☐ ${doneChecks}/${cl.length}</span>`);
  }
  const cm = card.comments || [];
  if(cm.length) meta.push(`💬 ${cm.length}`);
  if(card.due_date && !overdue){
    // Urgency color by proximity: today=red, tomorrow=amber, this week=neutral
    const dueD = new Date(card.due_date);
    const daysOut = Math.ceil((dueD - Date.now())/86400000);
    const dueCls = daysOut <= 0 ? 'b-card-meta-due-soon'
                 : daysOut === 1 ? 'b-card-meta-due-warn'
                 : '';
    const dueLbl = daysOut === 0 ? 'today'
                 : daysOut === 1 ? 'tomorrow'
                 : dueD.toLocaleDateString([], {month:'short', day:'numeric'});
    meta.push(`<span class="${dueCls}">📅 ${dueLbl}</span>`);
  }
  if(card.assignee) meta.push(`<span class="b-card-meta-assignee">${initials(card.assignee)}</span> ${esc(card.assignee)}`);
  if(card.cost_estimate) meta.push(`$${Number(card.cost_estimate).toFixed(0)} est`);
  // Age indicator — only for open cards. Silent under 3d, amber at 7d, red at 14d.
  if(!done && card.created_at){
    const ageDays = Math.floor((Date.now() - new Date(card.created_at).getTime())/86400000);
    if(ageDays >= 14) meta.push(`<span class="b-card-meta-age-old">⏱ ${ageDays}d old</span>`);
    else if(ageDays >= 7) meta.push(`<span class="b-card-meta-age-warn">⏱ ${ageDays}d old</span>`);
    else if(ageDays >= 3) meta.push(`<span class="b-card-meta-age">${ageDays}d</span>`);
  }
  if(meta.length) html += `<div class="b-card-meta">${meta.join(' · ')}</div>`;

  html += '</div>'; // close b-card-body

  el.innerHTML = html;

  // Auto-translate card title if it's written in a language different
  // from the viewer's preferred language. This is the single highest-
  // value surface for translation in the whole app — it's where a
  // bilingual team reads each other's work every shift.
  //
  // NX.tr.auto silently no-ops when detected language matches target,
  // so same-language content is untouched. When it does translate, it
  // inserts a small "Translated from X · show original" badge above
  // the title.
  if (window.NX?.tr) {
    const titleEl = el.querySelector('.b-card-title');
    if (titleEl) { try { NX.tr.auto(titleEl); } catch(_) {} }
  }

  // Tap card → detail
  el.addEventListener('click', e => {
    if(e.target.dataset.move) return; // handled below
    if(e.target.closest('.nx-tr-btn')) return; // don't open detail on translate tap
    openCardDetail(card);
  });

  // Move button
  el.querySelector('.b-card-move-btn').addEventListener('click', e => {
    e.stopPropagation();
    openMovePicker(card);
  });

  // Desktop drag
  el.addEventListener('dragstart', e => {
    dragCard = card;
    el.style.opacity = '0.5';
  });
  el.addEventListener('dragend', () => {
    el.style.opacity = '1';
  });

  return el;
}

// Produce initials from a name like "Ana Maria" → "AM". Used for the
// inline assignee chip in card meta. Safe for emojis and unicode.
function initials(name){
  return String(name||'').trim().split(/\s+/).slice(0,2).map(p => p[0]||'').join('').toUpperCase() || '•';
}

// ─────────────────────────────────────────────────────────────────────────
// MOVE PICKER — mobile-friendly
// ─────────────────────────────────────────────────────────────────────────
function openMovePicker(card){
  const bg = document.createElement('div');
  bg.className = 'b-modal-bg';
  bg.innerHTML = `<div class="b-modal b-move-modal">
    <div class="b-modal-head"><div style="flex:1;font-size:13px;font-weight:600">Move to…</div>
      <button class="b-modal-close">✕</button></div>
    <div class="b-move-list">
      ${lists.map(l => {
        const isCurrent = l.id === card.list_id;
        return `<button class="b-move-item${isCurrent?' current':''}" data-list="${l.id}">
          ${isCurrent?'✓ ':''}${esc(l.name)}
        </button>`;
      }).join('')}
    </div>
  </div>`;
  const close = ()=>{ bg.remove(); };
  bg.addEventListener('click', e => { if(e.target===bg) close(); });
  bg.querySelector('.b-modal-close').addEventListener('click', close);
  bg.querySelectorAll('.b-move-item').forEach(btn => {
    if(btn.classList.contains('current')) return;
    btn.addEventListener('click', async () => {
      const targetList = lists.find(l => l.id == btn.dataset.list);
      if(targetList){
        await moveCard(card, targetList);
        close();
      }
    });
  });
  document.body.appendChild(bg);
}

async function moveCard(card, targetList){
  // Optimistic: update local state + re-render IMMEDIATELY, then fire
  // the server write in the background. User sees the card move with
  // zero latency. On error, we revert and toast. This is the single
  // biggest perceived-speed improvement because it decouples the UI
  // responsiveness from network round-trip time (typically 150-500ms
  // on mobile). Combined with realtime, other users see our change as
  // soon as the server confirms — not after our UI update.
  const statusMap = {
    'closed':'closed', 'done':'closed',
    'resolved':'resolved',
    'waiting on parts':'waiting_parts',
    'in progress':'in_progress',
    'dispatched':'dispatched',
    'triaged':'triaged',
    'reported':'reported',
  };
  const targetColName = targetList.name.toLowerCase().replace(/\s+/g,'_');
  const wasNotDone = !isDone(card);
  const movingToDone = /(done|closed|resolved|complete|archived?)/.test(targetList.name.toLowerCase());
  const status = statusMap[targetList.name.toLowerCase()] || targetList.name.toLowerCase().replace(/\s+/g,'_');

  // Snapshot for rollback
  const prev = { list_id: card.list_id, status: card.status, column_name: card.column_name };

  // Apply optimistically
  card.list_id = targetList.id;
  card.status = status;
  card.column_name = targetColName;
  optimisticSet.add(card.id);
  render();

  // Fire server write in background
  try{
    const { error } = await NX.sb.from('kanban_cards').update({
      list_id: targetList.id,
      column_name: targetColName,
      status,
    }).eq('id', card.id);
    if(error) throw error;

    // ── CROSS-SYSTEM CLOSE-OUT ────────────────────────────────────
    // If this card just moved to Done and is linked to equipment
    // that isn't currently Operational, offer to mark the equipment
    // repaired. One confirm, one update, one toast — saves switching
    // to the Equip tab to manually flip the status.
    if (movingToDone && wasNotDone && card.equipment_id) {
      offerEquipmentRepaired(card);
    }
  }catch(e){
    console.error('[board] moveCard:', e);
    // Revert
    card.list_id = prev.list_id;
    card.status = prev.status;
    card.column_name = prev.column_name;
    optimisticSet.delete(card.id);
    render();
    NX.toast && NX.toast('Failed to move card — reverted', 'error');
  }
}

/* Offer to mark the equipment linked to this card as Operational.
   Only fires when equipment is currently NOT operational (otherwise
   nothing to change). Silent if equipment row isn't found. */
async function offerEquipmentRepaired(card) {
  try {
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, status')
      .eq('id', card.equipment_id)
      .maybeSingle();
    if (!eq) return;
    if (eq.status === 'operational') return;  // already good, nothing to offer

    if (!confirm(`Mark "${eq.name}" as Operational?\n\nThis card is about that equipment. If it's resolved, the equipment should reflect that too.`)) return;

    const { error } = await NX.sb.from('equipment')
      .update({ status: 'operational' })
      .eq('id', eq.id);
    if (error) throw error;
    NX.toast && NX.toast(`${eq.name} → Operational ✓`, 'success');
    // Fire brain sync so the AI + galaxy reflect the change
    if (NX.eqBrainSync?.syncOne) {
      try { await NX.eqBrainSync.syncOne(eq.id); } catch (_) {}
    }
    if (NX.homeGalaxyPulse) try { NX.homeGalaxyPulse(); } catch (_) {}
  } catch (err) {
    console.error('[offerEquipmentRepaired]', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CARD DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────
async function openCardDetail(card){
  // Refresh equipment cache in background for the picker
  loadEquipmentCache();

  const bg = document.createElement('div');
  bg.className = 'b-modal-bg';
  bg.innerHTML = `<div class="b-modal">
    <div class="b-modal-head">
      <input class="b-modal-title" id="bTitle" value="${esc(card.title||'')}" placeholder="Card title">
      <button class="b-modal-close">✕</button>
    </div>
    <div class="b-modal-body">

      <div class="b-section">
        <div class="b-section-label">
          Description
          <button type="button" class="b-tr-btn" id="bTrDesc" title="Translate to your language" style="display:none">🌐 Translate</button>
        </div>
        <textarea class="b-field" id="bDesc" placeholder="Details, steps to reproduce, what was tried…" rows="3">${esc(card.description||'')}</textarea>
        <div class="b-tr-out" id="bDescTrOut" style="display:none"></div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Priority · Location</div>
        <div class="b-field-row">
          <select class="b-field" id="bPri">
            ${Object.entries(PRIORITIES).map(([k,v]) =>
              `<option value="${k}"${card.priority===k?' selected':''}>${v.label}</option>`
            ).join('')}
          </select>
          <select class="b-field" id="bLoc">
            <option value="">— no location —</option>
            ${LOCATIONS.map(l =>
              `<option value="${l.key}"${card.location===l.key?' selected':''}>${l.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="b-section" id="bEqSection">
        <div class="b-section-label">Linked Equipment</div>
        <div id="bEqEmbed"><!-- populated async --></div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Photos</div>
        <div class="b-photos" id="bPhotos">
          ${(card.photo_urls||[]).map((u,i) =>
            `<img class="b-photo" src="${esc(u)}" data-idx="${i}">`
          ).join('')}
          <button class="b-photo-add" id="bPhotoAdd">+</button>
        </div>
        <input type="file" id="bPhotoInput" accept="image/*" capture="environment" style="display:none">
      </div>

      <div class="b-section">
        <div class="b-section-label">Checklist</div>
        <div id="bChecklist">
          ${(card.checklist||[]).map((c,i) =>
            `<div class="b-check${c.done?' done':''}"><input type="checkbox" data-idx="${i}"${c.done?' checked':''}><span>${esc(c.text||'')}</span></div>`
          ).join('')}
        </div>
        <div class="b-check-add">
          <input id="bCheckInput" placeholder="Add a step…">
          <button id="bCheckAdd">+</button>
        </div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Assignment · Due</div>
        <div class="b-field-row">
          <input class="b-field" id="bAssignee" value="${esc(card.assignee||'')}" placeholder="Assignee">
          <input type="date" class="b-field" id="bDue" value="${esc(card.due_date||'')}">
        </div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Parts Needed · Cost</div>
        <input class="b-field" id="bParts" value="${esc(card.parts_needed||'')}" placeholder="e.g. compressor seal, gasket" style="margin-bottom:6px">
        <div class="b-field-row">
          <input class="b-field" id="bCostEst" type="number" step="0.01" value="${esc(card.cost_estimate||'')}" placeholder="Est $">
          <input class="b-field" id="bCostAct" type="number" step="0.01" value="${esc(card.cost_actual||'')}" placeholder="Actual $">
        </div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Comments (${(card.comments||[]).length})</div>
        <div id="bComments">
          ${(card.comments||[]).map(c =>
            `<div class="b-comment"><span class="b-comment-by">${esc(c.by||'?')}</span><span class="b-comment-time">${c.at?new Date(c.at).toLocaleDateString():''}</span><div class="b-comment-text">${esc(c.text||'')}</div></div>`
          ).join('')}
        </div>
        <div class="b-check-add" style="margin-top:8px">
          <input id="bCommentInput" placeholder="Add a comment…">
          <button id="bCommentAdd">Post</button>
        </div>
      </div>

      <div class="b-actions">
        <button class="b-btn b-btn-primary" id="bSave">Save</button>
        ${card.equipment_id ? `<button class="b-btn" id="bCall">📞 Call Service</button>` : ''}
        <button class="b-btn" id="bMoveBtn">→ Move</button>
        <button class="b-btn b-btn-danger" id="bArchive">Archive</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(bg);

  // ── TRANSLATION ───────────────────────────────────────────────
  // The description lives in a textarea (editable). We can't swap
  // text inline without losing the edit buffer, so we show a
  // "Translate" button that renders a read-only translation below
  // the textarea. Comments render as static divs, so we use the
  // simpler NX.tr.auto inline pattern.
  if (window.NX?.tr) {
    const descEl = bg.querySelector('#bDesc');
    const trBtn = bg.querySelector('#bTrDesc');
    const trOut = bg.querySelector('#bDescTrOut');
    if (descEl && trBtn && trOut && descEl.value.trim().length > 10) {
      trBtn.style.display = '';
      let shown = false;
      let cached = null;
      trBtn.addEventListener('click', async () => {
        if (shown) {
          trOut.style.display = 'none';
          trBtn.textContent = '🌐 Translate';
          shown = false;
          return;
        }
        trBtn.textContent = '…';
        trBtn.disabled = true;
        try {
          if (!cached) cached = await NX.tr.text(descEl.value);
          trOut.textContent = cached;
          trOut.style.display = '';
          trBtn.textContent = '✕ Hide translation';
          shown = true;
        } catch (_) {
          trBtn.textContent = '⚠ retry';
        } finally {
          trBtn.disabled = false;
        }
      });
    }
    // Auto-translate existing comments (posted by others, possibly
    // in a different language).
    bg.querySelectorAll('.b-comment-text').forEach(el => {
      try { NX.tr.auto(el); } catch (_) {}
    });
  }

  // Close handlers
  const close = ()=>bg.remove();
  bg.addEventListener('click', e => { if(e.target===bg) saveCard(card, bg, true); });
  bg.querySelector('.b-modal-close').addEventListener('click', ()=>saveCard(card, bg, true));

  // Equipment embed (async — fetches the equipment row)
  renderEquipmentEmbed(card, bg.querySelector('#bEqEmbed'));

  // Photo: on click, enlarge
  bg.querySelectorAll('.b-photo').forEach(img => {
    img.addEventListener('click', () => {
      const fs = document.createElement('div');
      fs.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer';
      fs.innerHTML = `<img src="${img.src}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      fs.addEventListener('click', ()=>fs.remove());
      document.body.appendChild(fs);
    });
  });

  // Photo add
  bg.querySelector('#bPhotoAdd').addEventListener('click', () => {
    bg.querySelector('#bPhotoInput').click();
  });
  bg.querySelector('#bPhotoInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const url = await uploadPhoto(file, card.id);
    if(url){
      card.photo_urls = [...(card.photo_urls||[]), url];
      // Re-open with fresh data
      await saveCard(card, bg, false);
      bg.remove();
      openCardDetail(card);
    }
  });

  // Checklist check toggles
  bg.querySelectorAll('#bChecklist input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = +cb.dataset.idx;
      if(!card.checklist) card.checklist = [];
      card.checklist[i].done = cb.checked;
      cb.parentElement.classList.toggle('done', cb.checked);
    });
  });
  // Checklist add
  const addCheck = () => {
    const inp = bg.querySelector('#bCheckInput');
    const t = inp.value.trim(); if(!t) return;
    if(!card.checklist) card.checklist = [];
    card.checklist.push({ text:t, done:false });
    const cl = bg.querySelector('#bChecklist');
    const i = card.checklist.length - 1;
    cl.insertAdjacentHTML('beforeend',
      `<div class="b-check"><input type="checkbox" data-idx="${i}"><span>${esc(t)}</span></div>`);
    cl.lastElementChild.querySelector('input').addEventListener('change', e => {
      card.checklist[i].done = e.target.checked;
      e.target.parentElement.classList.toggle('done', e.target.checked);
    });
    inp.value = '';
  };
  bg.querySelector('#bCheckAdd').addEventListener('click', addCheck);
  bg.querySelector('#bCheckInput').addEventListener('keydown', e => {
    if(e.key==='Enter'){ e.preventDefault(); addCheck(); }
  });

  // Comment add
  const addComment = () => {
    const inp = bg.querySelector('#bCommentInput');
    const t = inp.value.trim(); if(!t) return;
    if(!card.comments) card.comments = [];
    const c = { text:t, by: NX.currentUser?.name || '?', at: new Date().toISOString() };
    card.comments.push(c);
    bg.querySelector('#bComments').insertAdjacentHTML('beforeend',
      `<div class="b-comment"><span class="b-comment-by">${esc(c.by)}</span><span class="b-comment-time">${new Date().toLocaleDateString()}</span><div class="b-comment-text">${esc(c.text)}</div></div>`);
    inp.value = '';
  };
  bg.querySelector('#bCommentAdd').addEventListener('click', addComment);
  bg.querySelector('#bCommentInput').addEventListener('keydown', e => {
    if(e.key==='Enter'){ e.preventDefault(); addComment(); }
  });

  // Actions
  bg.querySelector('#bSave').addEventListener('click', () => saveCard(card, bg, true));
  bg.querySelector('#bMoveBtn').addEventListener('click', () => {
    saveCard(card, bg, false).then(() => {
      bg.remove();
      openMovePicker(card);
    });
  });
  bg.querySelector('#bArchive').addEventListener('click', async () => {
    if(!confirm('Archive this card?')) return;
    await NX.sb.from('kanban_cards').update({ archived: true }).eq('id', card.id);
    bg.remove();
    await loadCards(); render();
    NX.toast && NX.toast('Card archived', 'info');
    // Stage R: pulse the mini-galaxy — ops state just shifted
    if (NX.homeGalaxyPulse) NX.homeGalaxyPulse();
  });
  const callBtn = bg.querySelector('#bCall');
  if(callBtn){
    callBtn.addEventListener('click', async () => {
      await saveCard(card, bg, false);
      bg.remove();
      // Delegate to equipment module's call flow
      if(card.equipment_id && NX.modules?.equipment?.callService){
        NX.modules.equipment.callService(card.equipment_id);
        // After dispatch, the card should move to "Dispatched". The equipment call flow
        // inserts into dispatch_events; we'll watch for the new row and link it.
        setTimeout(() => moveCardToStatusColumn(card.id, 'Dispatched'), 2500);
      }
    });
  }
}

// Auto-move card to a column by name (fuzzy match)
async function moveCardToStatusColumn(cardId, nameContains){
  if(!lists.length) await loadLists();
  const target = lists.find(l => l.name.toLowerCase().includes(nameContains.toLowerCase()));
  if(!target) return;
  const card = cards.find(c => c.id == cardId);
  if(!card) return;
  await moveCard(card, target);
}

async function renderEquipmentEmbed(card, container){
  if(!container) return;
  if(!card.equipment_id){
    container.innerHTML = `
      <select class="b-field" id="bEqPicker">
        <option value="">— Link equipment —</option>
      </select>`;
    const pick = container.querySelector('#bEqPicker');
    await loadEquipmentCache();
    equipmentCache.forEach(eq => {
      const o = document.createElement('option');
      o.value = eq.id;
      o.textContent = eq.name + (eq.location ? ` (${eq.location})` : '');
      pick.appendChild(o);
    });
    pick.addEventListener('change', () => {
      card.equipment_id = pick.value || null;
      // Auto-fill location from equipment
      if(card.equipment_id){
        const eq = equipmentCache.find(e => e.id === card.equipment_id);
        if(eq && eq.location && !card.location){
          card.location = eq.location;
          const locSel = document.querySelector('#bLoc');
          if(locSel) locSel.value = eq.location;
        }
        renderEquipmentEmbed(card, container);
      }
    });
    return;
  }
  // We have equipment_id — fetch full equipment + render embed
  try{
    const { data: eq } = await NX.sb.from('equipment')
      .select('id, name, location, category, manufacturer, model, health_score')
      .eq('id', card.equipment_id).single();
    if(!eq){
      container.innerHTML = '<div style="font-size:11px;color:var(--text-faint,#746c5e)">Equipment not found</div>';
      return;
    }
    const meta = [eq.category, eq.manufacturer, eq.model].filter(Boolean).join(' · ');
    const health = (eq.health_score != null)
      ? `<span style="color:${eq.health_score>=70?'#8fd492':eq.health_score>=40?'#e8a830':'#e88'}">${eq.health_score}%</span>`
      : '—';
    container.innerHTML = `
      <div class="b-eq-embed" id="bEqGo">
        <div class="b-eq-embed-icon">🔧</div>
        <div class="b-eq-embed-body">
          <div class="b-eq-embed-name">${esc(eq.name)}</div>
          <div class="b-eq-embed-meta">${esc(meta)}${meta?' · ':''}Health ${health}</div>
        </div>
        <div class="b-eq-embed-chev">›</div>
      </div>
      <button class="b-btn" id="bEqUnlink" style="margin-top:6px;font-size:11px">Unlink equipment</button>`;
    container.querySelector('#bEqGo').addEventListener('click', () => {
      if(NX.modules?.equipment?.openDetail){
        NX.modules.equipment.openDetail(eq.id);
        // close this modal
        const modal = container.closest('.b-modal-bg');
        if(modal) modal.remove();
      }
    });
    container.querySelector('#bEqUnlink').addEventListener('click', () => {
      card.equipment_id = null;
      renderEquipmentEmbed(card, container);
    });
  }catch(e){
    console.error('[board] equipment embed:', e);
    container.innerHTML = '<div style="font-size:11px;color:var(--text-faint,#746c5e)">Could not load equipment</div>';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SAVE
// ─────────────────────────────────────────────────────────────────────────
async function saveCard(card, modal, closeAfter){
  try{
    const title = modal.querySelector('#bTitle').value.trim() || card.title || '(untitled)';
    const description = modal.querySelector('#bDesc').value.trim();
    const priority = modal.querySelector('#bPri').value;
    const location = modal.querySelector('#bLoc').value || null;
    const assignee = modal.querySelector('#bAssignee').value.trim() || null;
    const due_date = modal.querySelector('#bDue').value || null;
    const parts_needed = modal.querySelector('#bParts').value.trim() || null;
    const costEstRaw = modal.querySelector('#bCostEst').value;
    const costActRaw = modal.querySelector('#bCostAct').value;
    const cost_estimate = costEstRaw ? Number(costEstRaw) : null;
    const cost_actual = costActRaw ? Number(costActRaw) : null;

    const patch = {
      title, description, priority, location,
      assignee, due_date,
      parts_needed, cost_estimate, cost_actual,
      equipment_id: card.equipment_id || null,
      checklist: card.checklist || [],
      comments: card.comments || [],
      labels: card.labels || [],
      photo_urls: card.photo_urls || [],
    };

    await NX.sb.from('kanban_cards').update(patch).eq('id', card.id);
    if(closeAfter){
      modal.remove();
      await loadCards(); render();
    }
  }catch(e){
    console.error('[board] saveCard:', e);
    NX.toast && NX.toast('Save failed', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PHOTO UPLOAD
// ─────────────────────────────────────────────────────────────────────────
async function uploadPhoto(file, cardId){
  try{
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `cards/${cardId}/${Date.now()}.${ext}`;
    const { error } = await NX.sb.storage.from('nexus-files').upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if(error) throw error;
    const { data } = NX.sb.storage.from('nexus-files').getPublicUrl(path);
    return data?.publicUrl || null;
  }catch(e){
    console.error('[board] uploadPhoto:', e);
    NX.toast && NX.toast('Photo upload failed', 'error');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE CARD / LIST / BOARD
// ─────────────────────────────────────────────────────────────────────────
async function promptNewCard(listId, prefill){
  const title = prefill?.title || prompt('Card title:');
  if(!title) return;
  try{
    const { data: created } = await NX.sb.from('kanban_cards').insert({
      title,
      description: prefill?.description || null,
      board_id: activeBoard.id,
      list_id: listId,
      column_name: '',
      position: cards.filter(c=>c.list_id===listId).length,
      priority: prefill?.priority || 'normal',
      location: prefill?.location || null,
      equipment_id: prefill?.equipment_id || null,
      reported_by: NX.currentUser?.name || null,
      checklist: [], comments: [], labels: [],
      photo_urls: [],
      archived: false,
    }).select().single();
    await loadCards(); render();
    NX.toast && NX.toast('Card created', 'success');
    // Fire push notification — every new card = every new report = buzzes
    // the managers/admins who need to know. Fire-and-forget.
    if (created && NX.notifyCardCreated) NX.notifyCardCreated(created);
    // If created with prefill, open it immediately
    if(prefill && created) openCardDetail(created);
  }catch(e){
    console.error('[board] promptNewCard:', e);
    NX.toast && NX.toast('Could not create card', 'error');
  }
}

async function promptNewList(){
  const name = prompt('List name:');
  if(!name) return;
  try{
    await NX.sb.from('board_lists').insert({
      board_id: activeBoard.id, name, position: lists.length
    });
    await loadLists(); render();
  }catch(e){ console.error('[board] promptNewList:', e); }
}

async function promptNewBoard(){
  const name = prompt('Board name:');
  if(!name) return;
  try{
    const { data: nb } = await NX.sb.from('boards').insert({
      name, color: '#c8a44e', position: boards.length
    }).select().single();
    if(nb){
      await NX.sb.from('board_lists').insert(
        DEFAULT_LISTS.map(l => ({ ...l, board_id: nb.id }))
      );
      boards.push(nb);
      activeBoard = nb;
      await loadLists(); await loadCards();
      render();
    }
  }catch(e){ console.error('[board] promptNewBoard:', e); }
}

// ─────────────────────────────────────────────────────────────────────────
// STATS MODAL
// ─────────────────────────────────────────────────────────────────────────
async function openStatsModal(){
  await loadStats();

  // Also compute inline stats from what's loaded
  const open = cards.length;
  const overdue = cards.filter(isOverdue).length;
  const urgent = cards.filter(c => c.priority === 'urgent').length;
  const waitingParts = cards.filter(c => (c.status||'').toLowerCase().includes('wait')).length;
  const byLocation = LOCATIONS.map(l => ({
    ...l,
    count: cards.filter(c => c.location === l.key).length,
  }));

  const avgClose = stats?.avg_close_days_30d != null
    ? Number(stats.avg_close_days_30d).toFixed(1) + 'd' : '—';
  const closed7 = stats?.closed_last_7d ?? '—';
  const closed30 = stats?.closed_last_30d ?? '—';
  const spend30 = stats?.spend_30d ? '$' + Number(stats.spend_30d).toFixed(0) : '—';
  const spend365 = stats?.spend_365d ? '$' + Number(stats.spend_365d).toFixed(0) : '—';

  const bg = document.createElement('div');
  bg.className = 'b-modal-bg';
  bg.innerHTML = `<div class="b-modal">
    <div class="b-modal-head">
      <div style="flex:1;font-size:14px;font-weight:600">📊 Board Stats</div>
      <button class="b-modal-close">✕</button>
    </div>
    <div class="b-modal-body">

      <div class="b-stats-grid">
        <div class="b-stat"><div class="b-stat-num">${open}</div><div class="b-stat-label">Open</div></div>
        <div class="b-stat"><div class="b-stat-num ${overdue>0?'alert':''}">${overdue}</div><div class="b-stat-label">Overdue</div></div>
        <div class="b-stat"><div class="b-stat-num ${urgent>0?'alert':''}">${urgent}</div><div class="b-stat-label">Urgent open</div></div>
        <div class="b-stat"><div class="b-stat-num">${waitingParts}</div><div class="b-stat-label">Waiting parts</div></div>
        <div class="b-stat"><div class="b-stat-num ok">${closed7}</div><div class="b-stat-label">Closed 7d</div></div>
        <div class="b-stat"><div class="b-stat-num ok">${closed30}</div><div class="b-stat-label">Closed 30d</div></div>
        <div class="b-stat"><div class="b-stat-num">${avgClose}</div><div class="b-stat-label">Avg close 30d</div></div>
        <div class="b-stat"><div class="b-stat-num">${spend30}</div><div class="b-stat-label">Spend 30d</div></div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Open by location</div>
        <div class="b-stats-grid">
          ${byLocation.map(l =>
            `<div class="b-stat"><div class="b-stat-num" style="color:${l.color}">${l.count}</div><div class="b-stat-label">${l.label}</div></div>`
          ).join('')}
        </div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Yearly spend</div>
        <div class="b-stat"><div class="b-stat-num">${spend365}</div><div class="b-stat-label">Last 365 days</div></div>
      </div>

    </div>
  </div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if(e.target===bg) close(); });
  bg.querySelector('.b-modal-close').addEventListener('click', close);
  document.body.appendChild(bg);
}

// ─────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// TRIAGE MODAL — bulk clean-up walkthrough
// One card at a time, oldest-stuck first, three-button decide.
// ─────────────────────────────────────────────────────────────────────────
async function openTriageModal(){
  // Load ALL open cards across all boards, sorted by oldest last_status_change_at
  // (cards stuck for longest → shown first)
  let allOpen = [];
  try {
    const { data } = await NX.sb.from('kanban_cards')
      .select('*')
      .eq('archived', false)
      .not('status', 'in', '(closed,done)')
      .order('last_status_change_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(2000);
    allOpen = data || [];
  } catch(e) {
    console.error('[board] triage load:', e);
    NX.toast && NX.toast('Could not load cards', 'error');
    return;
  }

  if (!allOpen.length) {
    NX.toast && NX.toast('Nothing to clean up — you are caught up ✨', 'success');
    return;
  }

  let idx = 0;
  const total = allOpen.length;
  let archivedCount = 0, closedCount = 0, skippedCount = 0;
  let lastAction = null; // { card, prevState } for undo

  const bg = document.createElement('div');
  bg.className = 'b-modal-bg';
  bg.innerHTML = `<div class="b-modal" id="bTriageModal">
    <div class="b-modal-head">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600">🧹 Clean Up</div>
        <div id="bTriageProgress" style="font-size:11px;color:var(--text-dim,#a49c94);margin-top:2px"></div>
      </div>
      <button class="b-modal-close">✕ Done</button>
    </div>
    <div class="b-modal-body" id="bTriageBody"></div>
    <div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:8px;flex-wrap:wrap;background:rgba(255,255,255,0.02)">
      <button class="b-btn b-btn-danger" id="bTArchive" style="flex:1;min-width:100px">📦 Archive</button>
      <button class="b-btn" id="bTClose" style="flex:1;min-width:100px;background:rgba(91,186,95,0.12);color:#8fd492;border-color:rgba(91,186,95,0.3)">✓ Close</button>
      <button class="b-btn" id="bTSkip" style="flex:1;min-width:100px">⏭ Skip</button>
    </div>
    <div style="padding:6px 16px 14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="b-btn" id="bTUndo" style="font-size:11px;flex:1" disabled>↶ Undo last</button>
      <button class="b-btn b-btn-danger" id="bTArchiveAll" style="font-size:11px;flex:1">Archive ALL remaining</button>
    </div>
  </div>`;

  document.body.appendChild(bg);

  const progressEl = bg.querySelector('#bTriageProgress');
  const bodyEl = bg.querySelector('#bTriageBody');
  const undoBtn = bg.querySelector('#bTUndo');

  const finish = () => {
    bg.remove();
    loadCards().then(() => {
      render();
      const msg = [];
      if (archivedCount) msg.push(`${archivedCount} archived`);
      if (closedCount) msg.push(`${closedCount} closed`);
      if (skippedCount) msg.push(`${skippedCount} skipped`);
      NX.toast && NX.toast(msg.length ? `✓ ${msg.join(' · ')}` : 'All done', 'success');
    });
  };

  const renderCurrent = () => {
    if (idx >= allOpen.length) {
      bodyEl.innerHTML = `<div style="padding:40px 20px;text-align:center">
        <div style="font-size:48px;margin-bottom:10px">✨</div>
        <div style="font-size:16px;color:#c8a44e;margin-bottom:8px;font-weight:600">All done!</div>
        <div style="font-size:13px;color:var(--text-dim,#a49c94)">
          ${archivedCount} archived · ${closedCount} closed · ${skippedCount} skipped
        </div>
      </div>`;
      return;
    }
    const c = allOpen[idx];
    const pri = priorityInfo(c.priority);
    const loc = locationInfo(c.location);
    const created = c.created_at ? new Date(c.created_at) : null;
    const lastChange = c.last_status_change_at ? new Date(c.last_status_change_at) : null;
    const ageDays = created ? Math.floor((Date.now() - created.getTime())/86400000) : null;
    const stuckDays = lastChange ? Math.floor((Date.now() - lastChange.getTime())/86400000) : null;
    const overdue = isOverdue(c);

    progressEl.textContent = `Card ${idx + 1} of ${total}`;

    const badges = [];
    if (c.priority === 'urgent') badges.push('<span class="b-card-badge pri-urgent">🚨 URGENT</span>');
    else if (c.priority === 'high') badges.push('<span class="b-card-badge pri-high">⚠ HIGH</span>');
    if (loc) badges.push(`<span class="b-card-badge loc" style="color:${loc.color}">📍 ${esc(loc.label)}</span>`);
    if (c.equipment_id) badges.push('<span class="b-card-badge eq">🔧 Equipment</span>');
    if (overdue) badges.push('<span class="b-card-badge overdue">📅 OVERDUE</span>');
    if (stuckDays != null && stuckDays > 30) badges.push(`<span class="b-card-badge overdue">⏳ Stuck ${stuckDays}d</span>`);

    const photoHtml = (c.photo_urls||[]).length
      ? `<img src="${esc(c.photo_urls[0])}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;margin-bottom:8px">`
      : '';

    bodyEl.innerHTML = `
      <div style="position:relative;padding-left:8px;border-left:4px solid ${pri.color||'transparent'};margin-bottom:12px">
        <div style="font-size:15px;font-weight:600;color:var(--text,#d4c8a5);line-height:1.3;margin-bottom:8px">${esc(c.title||'(untitled)')}</div>
        ${badges.length ? `<div class="b-card-badges">${badges.join('')}</div>` : ''}
      </div>
      ${photoHtml}
      ${c.description ? `<div style="font-size:13px;color:var(--text,#d4c8a5);margin-bottom:10px;line-height:1.4;white-space:pre-wrap">${esc(c.description)}</div>` : ''}
      <div style="font-size:11px;color:var(--text-dim,#a49c94);line-height:1.6">
        ${created ? `Created ${ageDays}d ago (${created.toLocaleDateString()})<br>` : ''}
        ${lastChange ? `Last status change ${stuckDays}d ago<br>` : ''}
        ${c.status ? `Status: <strong>${esc((c.status||'').replace(/_/g,' '))}</strong><br>` : ''}
        ${c.assignee ? `Assigned: ${esc(c.assignee)}<br>` : ''}
        ${c.reported_by ? `Reported by: ${esc(c.reported_by)}<br>` : ''}
        ${c.due_date ? `Due: ${esc(c.due_date)}<br>` : ''}
      </div>
      ${(c.checklist && c.checklist.length) ? `<div style="margin-top:10px;font-size:11px;color:var(--text-dim,#a49c94)">Checklist: ${c.checklist.filter(x=>x.done).length}/${c.checklist.length} done</div>` : ''}
      ${(c.comments && c.comments.length) ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim,#a49c94)">💬 ${c.comments.length} comment${c.comments.length!==1?'s':''}</div>` : ''}
    `;

    undoBtn.disabled = !lastAction;
  };

  const doAction = async (action) => {
    if (idx >= allOpen.length) return;
    const c = allOpen[idx];
    lastAction = { card: c, action, prevArchived: c.archived, prevStatus: c.status };

    try {
      if (action === 'archive') {
        await NX.sb.from('kanban_cards').update({ archived: true }).eq('id', c.id);
        archivedCount++;
      } else if (action === 'close') {
        await NX.sb.from('kanban_cards').update({ status: 'closed' }).eq('id', c.id);
        closedCount++;
      } else if (action === 'skip') {
        skippedCount++;
      }
    } catch (e) {
      console.error('[triage] action failed:', e);
      NX.toast && NX.toast('Action failed', 'error');
      return;
    }

    idx++;
    renderCurrent();
  };

  bg.querySelector('#bTArchive').addEventListener('click', () => doAction('archive'));
  bg.querySelector('#bTClose').addEventListener('click', () => doAction('close'));
  bg.querySelector('#bTSkip').addEventListener('click', () => doAction('skip'));

  undoBtn.addEventListener('click', async () => {
    if (!lastAction) return;
    const { card, action, prevArchived, prevStatus } = lastAction;
    try {
      if (action === 'archive') {
        await NX.sb.from('kanban_cards').update({ archived: prevArchived }).eq('id', card.id);
        archivedCount--;
      } else if (action === 'close') {
        await NX.sb.from('kanban_cards').update({ status: prevStatus }).eq('id', card.id);
        closedCount--;
      } else if (action === 'skip') {
        skippedCount--;
      }
      idx--;
      lastAction = null;
      renderCurrent();
    } catch (e) { console.error('[triage] undo:', e); }
  });

  bg.querySelector('#bTArchiveAll').addEventListener('click', async () => {
    const remaining = allOpen.length - idx;
    if (!confirm(`Archive ALL ${remaining} remaining cards?\n\nThis bulk-archives everything you haven't triaged yet. The cards aren't deleted — you can find them later by filtering "archived" in the database.\n\nProceed?`)) return;
    const ids = allOpen.slice(idx).map(c => c.id);
    try {
      // Supabase caps batch updates; chunk into groups of 200
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await NX.sb.from('kanban_cards').update({ archived: true }).in('id', chunk);
      }
      archivedCount += remaining;
      idx = allOpen.length;
      renderCurrent();
    } catch (e) {
      console.error('[triage] archive all:', e);
      NX.toast && NX.toast('Bulk archive failed — some cards may be archived', 'error');
    }
  });

  bg.querySelector('.b-modal-close').addEventListener('click', finish);

  renderCurrent();
}

async function init(){
  await loadBoards();
  await loadLists();
  await loadCards();
  loadStats();
  render();
  subscribeRealtime();
  bindVisibilityHandler();
}

async function show(){
  // Stale-while-revalidate: if we have a live realtime subscription and
  // data pulled recently, render from memory NOW (instant), then kick
  // a silent refresh in the background. Tab switches become snappy.
  const isWarm = rtChannel && rtConnected && (Date.now() - lastFetchAt) < 10000;
  if(isWarm){
    render();
    // Silent background refresh — only re-renders if anything changed
    // (realtime should have caught mutations already, this is a safety
    // net against dropped events during reconnect windows).
    loadStats();
    return;
  }
  await loadCards();
  loadStats();
  render();
  // (Re)subscribe if we don't have an active channel
  if(!rtChannel) subscribeRealtime();
}

// Tear down realtime when the tab is backgrounded; re-sub on return.
// Saves Supabase connections when the phone screen is locked or the
// tab sits unused. Critical on mobile where backgrounded tabs can live
// for hours without closing.
let visibilityBound = false;
function bindVisibilityHandler(){
  if(visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden'){
      unsubscribeRealtime();
    }else if(document.visibilityState === 'visible'){
      // Only resubscribe if the Board view is the active one — no point
      // in keeping a board channel open when user's on Equipment etc.
      const boardActive = document.querySelector('.view[data-view="board"]')?.classList.contains('active');
      if(boardActive && activeBoard){
        // Pull latest (we may have missed events while hidden)
        loadCards().then(() => { render(); subscribeRealtime(); });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API — used by equipment.js integration
// ─────────────────────────────────────────────────────────────────────────
async function createFromEquipment(equipment, prefilledIssue){
  // Make sure the board system is initialized
  if(!boards.length) await loadBoards();
  if(!activeBoard) return;
  if(!lists.length) await loadLists();

  // Find the first list that looks like "Reported" (or just first list)
  const targetList = lists.find(l => l.name.toLowerCase().includes('report'))
                  || lists.find(l => l.name.toLowerCase().includes('todo'))
                  || lists[0];
  if(!targetList) return;

  // Switch to the Board view
  document.querySelector('.nav-tab[data-view="board"]')?.click();
  document.querySelector('.bnav-btn[data-view="board"]')?.click();

  await promptNewCard(targetList.id, {
    title: prefilledIssue
      ? `${prefilledIssue} — ${equipment.name}`
      : `Issue: ${equipment.name}`,
    description: prefilledIssue || '',
    priority: 'high',
    location: equipment.location || null,
    equipment_id: equipment.id,
  });
}

async function getOpenCardsForEquipment(equipmentId){
  try{
    const { data } = await NX.sb.from('kanban_cards')
      .select('id, title, priority, status, list_id, due_date, created_at')
      .eq('equipment_id', equipmentId)
      .eq('archived', false)
      .order('created_at', { ascending: false });
    return data || [];
  }catch(e){
    console.error('[board] getOpenCardsForEquipment:', e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────
if(!NX.modules) NX.modules = {};
NX.modules.board = {
  init,
  show,
  createFromEquipment,
  getOpenCardsForEquipment,
  // also expose loadCards so equipment-integration refreshes correctly
  reload: async () => { await loadCards(); render(); },
};

console.log('[board] v4 loaded — ' + Object.keys(NX.modules.board).length + ' exports');

})();
