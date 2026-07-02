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
// ─── PALETTE ──────────────────────────────────────────────────────────
// Board uses the same editorial set everything else does:
//   gold   var(--accent)   primary brand, "high" priority
//   olive  var(--green)   "operational" green substitute, "Toti" location
//   oxblood var(--red)   urgent / overdue
//   plum   var(--purple)   muted royal — Este location
//   graphite var(--faint)  neutral, "low" priority (instead of out-of-place blue)
//   parchment var(--text)  warm secondary, optional label colors
//
// No screaming red, no candy blue, no kindergarten green. Two-and-a-half
// years of iteration says editorial > productivity-app default.
const PRIORITIES = {
  urgent: { label: 'Urgent', color: 'var(--red)', rank: 4 },  // oxblood
  high:   { label: 'High',   color: 'var(--accent)', rank: 3 },  // brand gold
  normal: { label: 'Normal', color: '',        rank: 2 },  // no strip
  low:    { label: 'Low',    color: 'var(--faint)', rank: 1 },  // graphite (was blue)
};

const LOCATIONS = [
  { key: 'suerte', label: 'Suerte', color: 'var(--accent)' },  // gold (lighter for light theme)
  { key: 'este',   label: 'Este',   color: 'var(--purple)' },  // muted plum (was bright purple)
  { key: 'toti',   label: 'Toti',   color: 'var(--green)' },  // olive
];

// Label color presets for cards. 8 distinct theme-aware slots.
// Each slot has dedicated dark + light values defined as --nx-label-N
// in nx-system.css, so labels stay distinguishable on both themes.
//   1 oxblood, 2 gold, 3 olive, 4 graphite, 5 plum, 6 parchment, 7 denim-slate, 8 taupe
const LABEL_COLORS = ['var(--nx-label-1)','var(--nx-label-2)','var(--nx-label-3)','var(--nx-label-4)','var(--nx-label-5)','var(--nx-label-6)','var(--nx-label-7)','var(--nx-label-8)'];

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
  .b-summary-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:var(--text)}
  .b-summary-chip.alert{background:rgba(168, 62, 62,0.15);color:var(--red);border:1px solid rgba(168, 62, 62,0.3)}
  .b-summary-chip.ok{background:rgba(156, 138, 62,0.10);color:var(--green)}
  .b-summary-chip.tap{cursor:pointer;user-select:none}
  .b-summary-chip.tap:active{transform:scale(0.97)}

  /* ── REALTIME PIP + TOAST STACK ──────────────────────────────
     Pip: small pill with connection dot + presence count. Sits
     leftmost in the summary strip so it's always visible.
     Toast stack: bottom-right corner, stacks up to 3, auto-dismiss.
     Separate from global NX.toast so bulk moves don't spam main UI. */
  .b-rt-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);font-size:11px;color:var(--text-dim);font-variant-numeric:tabular-nums}
  .b-rt-dot{width:7px;height:7px;border-radius:50%;background:var(--text-faint);flex-shrink:0;transition:background .3s,box-shadow .3s}
  .b-rt-dot.is-live{background:var(--green);box-shadow:0 0 6px rgba(156,138,62,.55);animation:bRtPulse 2.4s ease-in-out infinite}
  @keyframes bRtPulse{0%,100%{opacity:1}50%{opacity:.55}}
  .b-rt-toast-stack{position:fixed;bottom:80px;right:10px;display:flex;flex-direction:column;gap:6px;z-index:999;pointer-events:none;max-width:min(320px,calc(100vw - 20px))}
  .b-rt-toast{background:rgba(20,18,14,0.95);border:1px solid rgba(200,164,78,0.25);border-left:3px solid var(--green);color:var(--text);padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:bRtToastIn .22s cubic-bezier(0.2,0.8,0.2,1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .b-rt-toast.is-leaving{animation:bRtToastOut .3s ease forwards}
  @keyframes bRtToastIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
  @keyframes bRtToastOut{to{transform:translateX(20px);opacity:0}}
  .b-summary-stats-btn{margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:5px 12px;border-radius:12px;font-size:11px;cursor:pointer}

  .board-header{display:flex;align-items:center;gap:4px;overflow-x:auto;padding:4px 0 12px;scrollbar-width:none}
  .board-header::-webkit-scrollbar{display:none}
  .board-tab{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--text);padding:6px 12px;border-radius:14px;font-size:12px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
  .board-tab-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;display:inline-block}
  .board-tab.active{background:rgba(200,164,78,0.12);border-color:var(--accent)}
  .board-add-tab{font-weight:bold;padding:6px 10px}

  .b-filters{display:flex;gap:6px;padding:0 4px 8px;overflow-x:auto;scrollbar-width:none}
  .b-filters::-webkit-scrollbar{display:none}
  .b-filter{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:var(--text-dim);padding:4px 10px;border-radius:10px;font-size:11px;cursor:pointer;white-space:nowrap}
  .b-filter.active{background:rgba(200,164,78,0.15);color:var(--accent);border-color:var(--accent)}

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
  .b-list-name{font-weight:600;font-size:13px;flex:1;color:var(--text)}
  .b-list-count{font-size:11px;color:var(--text-dim);background:rgba(255,255,255,0.05);padding:2px 7px;border-radius:8px}
  .b-list-cards{flex:1;overflow-y:auto;min-height:30px;margin:0 -2px;padding:0 2px;scrollbar-width:thin}
  .b-list-cards.drag-over{background:rgba(200,164,78,0.05);border-radius:6px}
  /* Trello-style drag feedback. The picked-up card collapses to nothing
     (its clone floats under the finger) so only the live gap shows where
     it will land; the target list gets a soft ring; the placeholder is the
     gap itself, sized to a typical card so the layout doesn't jump. */
  .b-card.is-dragging{opacity:0;height:0;min-height:0;margin:0;padding:0;border:0;overflow:hidden;pointer-events:none}
  .b-list.drop-target{outline:2px solid rgba(200,164,78,0.35);outline-offset:-2px;border-radius:10px}
  .b-card-dragclone{opacity:.95;transform:rotate(1.5deg) scale(1.02);box-shadow:0 14px 34px rgba(0,0,0,0.55);border-color:rgba(200,164,78,0.4)!important;transition:none}
  .b-card-placeholder{height:44px;margin-bottom:8px;border-radius:10px;background:rgba(200,164,78,0.08);border:1px dashed rgba(200,164,78,0.35);flex-shrink:0;animation:bfade .12s ease}
  /* List (column) drag-to-reorder. The header is the grip; the original
     fades in place while its clone floats, and the target column that the
     dragged list will land next to gets a dashed ring. */
  .b-list-head{cursor:grab}
  .b-list.is-list-dragging{opacity:.35}
  .b-list.list-drop-target{outline:2px dashed rgba(200,164,78,0.45);outline-offset:-2px;border-radius:10px}
  .b-list-dragclone{opacity:.92;transform:rotate(1deg);box-shadow:0 18px 42px rgba(0,0,0,0.6);border-radius:10px;overflow:hidden;transition:none}
  /* Add card button — was a wispy dashed rectangle. Now a calm solid
     affordance that stands out as "press here" without screaming. */
  .b-list-add{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);color:var(--text-dim);padding:10px;border-radius:8px;cursor:pointer;margin-top:6px;width:100%;font-size:12.5px;font-family:inherit;transition:all .15s}
  .b-list-add:hover{background:rgba(200,164,78,0.06);border-color:rgba(200,164,78,0.25);color:var(--accent)}
  .b-list-add:active{transform:scale(0.99)}

  /* Terminal list collapse — Done/Closed/Resolved/Complete/Archived default
     to a single-line summary. Tap the header to expand. Saves screen real
     estate on mobile by hiding completed work. */
  .b-list.is-terminal{background:rgba(20,18,14,0.4);opacity:.85}
  .b-list.is-terminal .b-list-head{color:var(--text-dim)}
  .b-list-collapse-icon{display:inline-block;margin-right:6px;color:var(--text-dim);font-size:10px;transition:transform .15s;user-select:none}
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
  .b-card-title{font-size:13px;font-weight:500;color:var(--text);margin-bottom:6px;line-height:1.35}
  .b-card-labels{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
  .b-card-label{font-size:10px;padding:2px 7px;border-radius:8px;color:var(--nx-gold-on);font-weight:600}
  .b-card-badges{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px}
  .b-card-badge{display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.05);color:var(--text-dim)}
  .b-card-badge.pri-urgent{background:rgba(168, 62, 62,0.15);color:var(--red);font-weight:600}
  .b-card-badge.pri-high{background:rgba(212,164,78,0.15);color:var(--accent)}
  .b-card-badge.loc{font-weight:500}
  .b-card-badge.eq{background:rgba(200,164,78,0.10);color:var(--accent)}
  .b-card-badge.overdue{background:rgba(168,62,62,0.18);color:var(--red);font-weight:600}
  .b-card-meta{display:flex;gap:8px;font-size:10px;color:var(--text-faint);margin-top:4px;align-items:center;flex-wrap:wrap}
  /* Meta sub-variants — age + due date urgency coloring (palette-coherent) */
  .b-card-meta-due-soon{color:var(--red);font-weight:600}
  .b-card-meta-due-warn{color:var(--accent);font-weight:500}
  .b-card-meta-age{color:var(--faint)}
  .b-card-meta-age-warn{color:var(--accent);font-weight:500}
  .b-card-meta-age-old{color:var(--red);font-weight:600}
  .b-card-meta-progress{color:var(--accent)}
  .b-card-meta-done{color:var(--green)}
  .b-card-meta-assignee{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(200,164,78,0.2);color:var(--accent);font-size:9px;font-weight:700;margin-right:-2px}
  /* Done card — fade + strike title. Cards stay visible in their terminal
     list but read as archived-in-place rather than active work. */
  .b-card.is-done{opacity:.55}
  .b-card.is-done .b-card-title{text-decoration:line-through;color:var(--text-dim)}
  .b-card.is-done .b-card-cover img{filter:grayscale(.6)}
  .b-card-kebab{position:absolute;top:3px;right:3px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;color:var(--text-dim);font-size:18px;line-height:1;border-radius:8px;cursor:pointer;opacity:0;transition:opacity .15s,background .15s;z-index:2;-webkit-tap-highlight-color:transparent}
  .b-card:hover .b-card-kebab,.b-card.show-move .b-card-kebab{opacity:1}
  .b-card-kebab:hover,.b-card-kebab:active{background:rgba(255,255,255,0.08);color:var(--text)}
  @media(hover:none){.b-card-kebab{opacity:.8}}

  /* Detail modal */
  .b-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:20px 10px;overflow-y:auto;animation:bfade .15s ease}
  @keyframes bfade{from{opacity:0}to{opacity:1}}
  .b-modal{background:var(--nx-gold-on);border:1px solid rgba(200,164,78,0.2);border-radius:12px;width:100%;max-width:600px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6)}
  .b-modal-head{display:flex;align-items:flex-start;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02)}
  .b-modal-title{flex:1;background:transparent;border:0;color:var(--text);font-size:15px;font-weight:600;outline:none;font-family:inherit}
  .b-modal-close{background:transparent;border:0;color:var(--text-dim);font-size:18px;cursor:pointer;padding:4px 8px}
  .b-modal-body{padding:14px 16px;max-height:70vh;overflow-y:auto}
  .b-section{margin-bottom:16px}
  .b-section-label{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-faint);margin-bottom:4px}
  .b-field{width:100%;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:var(--text);padding:8px 10px;border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box}
  .b-field:focus{outline:none;border-color:rgba(200,164,78,0.4)}
  textarea.b-field{resize:vertical;min-height:60px}
  select.b-field{cursor:pointer}
  .b-field-row{display:flex;gap:8px}
  .b-field-row > *{flex:1;min-width:0}

  .b-eq-embed{background:rgba(200,164,78,0.06);border:1px solid rgba(200,164,78,0.2);border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;cursor:pointer}
  .b-eq-embed:active{background:rgba(200,164,78,0.10)}
  .b-eq-embed-icon{font-size:20px}
  .b-eq-embed-body{flex:1;min-width:0}
  .b-eq-embed-name{font-weight:600;font-size:13px;color:var(--accent);margin-bottom:2px}
  .b-eq-embed-meta{font-size:11px;color:var(--text-dim)}
  .b-eq-embed-chev{color:var(--text-faint)}

  .b-photos{display:flex;gap:6px;flex-wrap:wrap}
  .b-photo{width:80px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04)}
  .b-photo-add{width:80px;height:80px;border:1px dashed rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:20px;cursor:pointer;background:transparent}

  .b-check{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:var(--text)}
  .b-check input[type=checkbox]{accent-color:var(--accent);width:16px;height:16px;cursor:pointer}
  .b-check.done span{text-decoration:line-through;color:var(--text-faint)}
  .b-check-add{display:flex;gap:6px;margin-top:6px}
  .b-check-add input{flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:var(--text);padding:5px 8px;border-radius:4px;font-size:12px}
  .b-check-add button{background:rgba(200,164,78,0.15);border:1px solid rgba(200,164,78,0.3);color:var(--accent);padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px}

  .b-comment{padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:4px;margin-bottom:4px;font-size:12px}
  .b-comment-by{color:var(--accent);font-weight:600;margin-right:6px}
  .b-comment-time{color:var(--text-faint);font-size:10px}

  /* Translate button on the description label + its rendered output.
     Button is a subtle pill; output is a cream-background blockquote
     styled to clearly mark "this is machine-translated, not the real
     stored value you're editing above". */
  .b-tr-btn{float:right;background:transparent;border:1px solid rgba(200,164,78,0.35);color:var(--accent);font-size:10px;padding:3px 8px;border-radius:10px;cursor:pointer;font-family:inherit;letter-spacing:0.3px}
  .b-tr-btn:active{transform:scale(0.96)}
  .b-tr-out{margin-top:8px;padding:10px 12px;background:rgba(200,164,78,0.05);border-left:2px solid rgba(200,164,78,0.4);border-radius:4px;color:var(--text);font-size:12.5px;line-height:1.5;white-space:pre-wrap}

  .b-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);margin-top:10px}
  .b-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:var(--text);padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}
  .b-btn:active{background:rgba(255,255,255,0.08)}
  .b-btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent));color:var(--nx-gold-on);border-color:var(--accent)}
  .b-btn-danger{background:rgba(168, 62, 62,0.1);color:var(--red);border-color:rgba(168, 62, 62,0.3)}

  /* Move picker */
  .b-move-modal{max-width:360px}
  .b-move-list{display:flex;flex-direction:column;gap:6px;padding:14px}
  .b-move-item{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:var(--text);padding:12px 14px;border-radius:8px;cursor:pointer;font-size:13px;text-align:left;display:flex;align-items:center;gap:8px}
  .b-move-item.current{opacity:0.45;cursor:default}
  .b-move-item:not(.current):active{background:rgba(200,164,78,0.1);border-color:var(--accent)}

  /* Stats modal */
  .b-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
  .b-stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px}
  .b-stat-num{font-size:22px;font-weight:700;color:var(--text);margin-bottom:2px}
  .b-stat-num.alert{color:var(--red)}
  .b-stat-num.ok{color:var(--green)}
  .b-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-faint)}
`;

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────
let boards = [], activeBoard = null, lists = [], cards = [], stats = null;
let equipmentCache = [];     // for the equipment picker in the card modal
let filters = { priority:null, location:null, equipment:null, state:null };
let searchQuery = '';        // free-text title/description search
let boardIO = null;          // IntersectionObserver for the mobile list nav
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
// Same idea for list (column) rows — swallow the realtime echo of our own
// optimistic list reorder so it doesn't trigger a redundant reload.
const listOptimistic = new Set();

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
// Resolve any stored location value to its canonical LOCATIONS key.
// Tolerant of case and of label-vs-key (legacy cards were saved with the
// raw equipment.location string, e.g. "SUERTE", which never matched the
// lowercase canonical keys — so badges/filters/modal silently dropped it).
function locKey(v){
  if(v == null) return null;
  const s = String(v).trim().toLowerCase();
  if(!s) return null;
  const hit = LOCATIONS.find(l => l.key.toLowerCase() === s || l.label.toLowerCase() === s);
  return hit ? hit.key : null;
}
function locationInfo(key){ const k = locKey(key); return k ? LOCATIONS.find(l => l.key === k) : null; }

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
        .insert({ name: 'Operations', color: 'var(--accent)', position: 0 })
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
    // Moved to a different board = remove from this board's view
    if(activeBoard && row.board_id !== activeBoard.id){
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

// Live changes to the board's LISTS (columns) — add / rename / reorder /
// delete done by teammates. We reload the small board_lists set and
// re-render. Echoes of our own optimistic reorder writes are skipped via
// listOptimistic so we don't reload three times for one drag.
async function applyListChange(payload){
  const row = payload.new || payload.old;
  if(!row) return;
  if(activeBoard && row.board_id !== activeBoard.id) return;
  if(listOptimistic.has(row.id)){ listOptimistic.delete(row.id); return; }
  try{
    await loadLists();
    renderSoon();
  }catch(e){ console.warn('[board] applyListChange:', e); }
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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'board_lists',
        filter: `board_id=eq.${activeBoard.id}`,
      }, applyListChange)
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
  const q = searchQuery.trim().toLowerCase();
  const now = Date.now();
  const fortnight = 14 * 86400000;
  return cardList.filter(c => {
    if(filters.priority && c.priority !== filters.priority) return false;
    if(filters.location && locKey(c.location) !== filters.location) return false;
    if(filters.equipment && c.equipment_id !== filters.equipment) return false;
    if(filters.state === 'overdue'){
      if(isDone(c)) return false;
      if(!isOverdue(c)) return false;
    } else if(filters.state === 'stale'){
      if(isDone(c)) return false;
      const created = c.created_at ? new Date(c.created_at).getTime() : 0;
      if(!created || (now - created) < fortnight) return false;
    }
    if(q){
      const labelText = Array.isArray(c.labels) ? c.labels.join(' ') : '';
      const hay = `${c.title || ''} ${c.description || ''} ${labelText} ${c.reported_by || ''} ${c.location || ''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
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
  const navEl = renderListNav();
  if(navEl) wrap.appendChild(navEl);
  const listsEl = renderLists();
  wrap.appendChild(listsEl);
  if(navEl) wireListNav(navEl, listsEl);
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
  if(urgent > 0) html += `<span class="b-summary-chip alert"><strong>${urgent}</strong> urgent</span>`;
  if(stats && stats.avg_close_days_30d != null){
    html += `<span class="b-summary-chip">avg close <strong>${Number(stats.avg_close_days_30d).toFixed(1)}d</strong></span>`;
  }
  if(closedThisWeek > 0){
    html += `<span class="b-summary-chip ok">✓ ${closedThisWeek} done this week</span>`;
  }
  // Quick search — text filter across all card titles + descriptions on
  // this board. Empty by default; live filters as user types. Sits
  // before the action buttons so it's reachable but doesn't dominate.
  html += `<span class="b-search-wrap">
    <span class="b-search-icon">⌕</span>
    <input
      class="b-search-input"
      id="bSearchInput"
      type="search"
      placeholder="Search cards…"
      value="${esc(searchQuery)}"
      autocomplete="off"
      spellcheck="false"
    >
    ${searchQuery ? '<button class="b-search-clear" id="bSearchClear" title="Clear">✕</button>' : ''}
  </span>`;
  // Clean Up button only appears when there's meaningful backlog
  if(open > 30){
    html += `<button class="b-summary-stats-btn" id="bCleanUpBtn" style="background:rgba(168, 62, 62,0.15);border-color:rgba(168, 62, 62,0.3);color:var(--red)">Clean Up</button>`;
  }
  html += `<button class="b-summary-stats-btn" id="bStatsBtn"><i data-lucide="bar-chart-3" class="b-btn-icon"></i> Stats</button>`;
  strip.innerHTML = html;
  strip.querySelector('#bStatsBtn').addEventListener('click', openStatsModal);
  const cleanBtn = strip.querySelector('#bCleanUpBtn');
  if(cleanBtn) cleanBtn.addEventListener('click', openTriageModal);

  // Wire search — debounced re-render so typing isn't laggy on big boards.
  // Re-render the lists only (not the strip itself, to avoid stealing focus).
  const searchInput = strip.querySelector('#bSearchInput');
  if(searchInput){
    let t = null;
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value;
      if(t) clearTimeout(t);
      t = setTimeout(() => {
        // Re-render only the cards area; keep the input focused.
        const wrap = document.getElementById('boardWrap');
        if(!wrap) return;
        // Find the lists row and replace just it. The strip stays put,
        // input keeps focus + cursor position.
        const oldLists = wrap.querySelector('.b-lists');
        const newLists = renderLists();
        if(oldLists) oldLists.replaceWith(newLists);
        // Show/hide the clear button without losing focus
        const existingClear = strip.querySelector('#bSearchClear');
        if(searchQuery && !existingClear){
          const wrapEl = strip.querySelector('.b-search-wrap');
          if(wrapEl){
            const btn = document.createElement('button');
            btn.className = 'b-search-clear';
            btn.id = 'bSearchClear';
            btn.title = 'Clear';
            btn.textContent = '✕';
            btn.addEventListener('click', () => {
              searchQuery = '';
              searchInput.value = '';
              btn.remove();
              const oldL = wrap.querySelector('.b-lists');
              if(oldL) oldL.replaceWith(renderLists());
              searchInput.focus();
            });
            wrapEl.appendChild(btn);
          }
        } else if(!searchQuery && existingClear){
          existingClear.remove();
        }
      }, 120);
    });
    // Escape clears the search and blurs
    searchInput.addEventListener('keydown', e => {
      if(e.key === 'Escape'){
        searchQuery = '';
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
      }
    });
  }
  const initialClear = strip.querySelector('#bSearchClear');
  if(initialClear){
    initialClear.addEventListener('click', () => {
      searchQuery = '';
      const inp = strip.querySelector('#bSearchInput');
      if(inp){ inp.value = ''; inp.dispatchEvent(new Event('input')); inp.focus(); }
    });
  }
  return strip;
}

function renderBoardHeader(){
  const header = document.createElement('div');
  header.className = 'board-header';
  header.innerHTML = boards.map(b => {
    const active = b.id === activeBoard?.id ? ' active' : '';
    // Was: border-left:3px solid <color>. That made the pill look
    // sharp on the left. Replaced with an inline colored dot before
    // the label so the per-board color signal survives, but the pill
    // shape stays fully round. The dot is 6px and inherits the same
    // color the border used to.
    const dotColor = b.color || 'var(--accent)';
    return `<button class="board-tab${active}" data-bid="${b.id}"><span class="board-tab-dot" style="background:${dotColor}"></span>${esc(b.name)}</button>`;
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
  header.querySelector('#bAddBoard').addEventListener('click', (e) => promptNewBoard(e.currentTarget));
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
  html += mk('priority', 'urgent', 'Urgent', 'var(--red)');
  html += mk('priority', 'high',   'High',   'var(--accent)');
  html += mk('priority', 'low',    'Low',      'var(--faint)');
  html += `<span style="width:8px"></span>`;
  // State filters — Overdue (past due) and Stale (>14d old, no due date
  // or past due). These surface cards that have fallen through cracks
  // — the "weekly cleanup" pass any kitchen manager runs Monday morning.
  html += mk('state', 'overdue', 'Overdue', 'var(--red)');
  html += mk('state', 'stale',   'Stale 14d+', 'var(--muted)');
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

// Mobile list navigator — a horizontal pill row (one per list, with the
// filtered card count) shown only on narrow screens. Tapping a pill scrolls
// that column into view; the active pill tracks whichever column is centered.
// On desktop the CSS hides it (the multi-column layout doesn't need it).
function renderListNav(){
  if(!lists.length) return null;
  const vis = applyFilters(cards);
  const nav = document.createElement('div');
  nav.className = 'b-listnav';
  nav.innerHTML = lists.map(l => {
    const n = vis.filter(c => c.list_id === l.id).length;
    return `<button class="b-listnav-pill" data-target="${l.id}">${esc(l.name)}<span class="b-listnav-count">${n}</span></button>`;
  }).join('');
  return nav;
}

function wireListNav(navEl, listsEl){
  if(boardIO){ try{ boardIO.disconnect(); }catch(_){} boardIO = null; }
  const pills = Array.from(navEl.querySelectorAll('.b-listnav-pill'));
  const listEls = Array.from(listsEl.querySelectorAll('.b-list[data-list-id]'));
  if(!pills.length || !listEls.length) return;
  const byId = id => listEls.find(e => e.dataset.listId === id);
  const setActive = id => pills.forEach(p => {
    const on = p.dataset.target === id;
    p.classList.toggle('is-active', on);
    if(on) try{ p.scrollIntoView({ inline:'nearest', block:'nearest' }); }catch(_){}
  });
  pills.forEach(p => p.addEventListener('click', () => {
    const t = byId(p.dataset.target);
    if(t) t.scrollIntoView({ inline:'center', block:'nearest', behavior:'smooth' });
    setActive(p.dataset.target);
  }));
  if('IntersectionObserver' in window){
    boardIO = new IntersectionObserver(entries => {
      let best = null, bestRatio = 0;
      entries.forEach(e => { if(e.isIntersecting && e.intersectionRatio > bestRatio){ bestRatio = e.intersectionRatio; best = e.target; } });
      if(best && best.dataset.listId) setActive(best.dataset.listId);
    }, { root: listsEl, threshold: [0.25, 0.5, 0.75] });
    listEls.forEach(e => boardIO.observe(e));
  }
  pills[0].classList.add('is-active');
}

function renderLists(){
  const wrapper = document.createElement('div');
  wrapper.className = 'b-lists';

  const visibleCards = applyFilters(cards);
  const filtersActive = !!(searchQuery || filters.priority || filters.location || filters.equipment || filters.state);

  lists.forEach(list => {
    const listEl = document.createElement('div');
    listEl.className = 'b-list';
    listEl.dataset.listId = list.id;

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
        // Ignore the click that fires right after a drag-reorder ended on
        // this header, so reordering a terminal list doesn't also collapse it.
        if(listEl._suppressClick && Date.now() - listEl._suppressClick < 350) return;
        const nowCollapsed = !listEl.classList.contains('is-collapsed');
        listEl.classList.toggle('is-collapsed', nowCollapsed);
        localStorage.setItem(collapseKey, nowCollapsed ? '1' : '0');
        // Update chevron
        const ci = head.querySelector('.b-list-collapse-icon');
        if(ci) ci.textContent = nowCollapsed ? '▸' : '▾';
      });
    }
    listEl.appendChild(head);
    // Trello-style column reorder — drag the header to move a whole list.
    enableListDrag(head, listEl, list);

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

    const addBtn = document.createElement('button');
    addBtn.className = 'b-list-add';
    addBtn.textContent = '+ Add a card';
    addBtn.addEventListener('click', () => promptNewCard(list.id, addBtn));
    listEl.appendChild(addBtn);          // pinned under the header — Trello-style add-to-top

    listCards.forEach(c => cardsWrap.appendChild(createCardEl(c)));
    // Explicit empty state (replaces the desktop-only "Drop cards here"
    // :empty CSS). Distinguishes a genuinely empty column from one emptied
    // by an active search/filter so a filtered board doesn't look broken.
    if(listCards.length === 0){
      const empty = document.createElement('div');
      empty.className = 'b-list-empty';
      const hasAnyUnfiltered = cards.some(c => c.list_id === list.id && !c.archived);
      empty.textContent = filtersActive
        ? (hasAnyUnfiltered ? 'No cards match the filter' : 'No cards match')
        : 'No cards yet';
      cardsWrap.appendChild(empty);
    }
    listEl.appendChild(cardsWrap);

    wrapper.appendChild(listEl);
  });

  // Add list button
  const addListEl = document.createElement('div');
  addListEl.className = 'b-list b-list-new';
  addListEl.style.background = 'transparent';
  addListEl.style.border = '1px dashed rgba(255,255,255,0.1)';
  addListEl.innerHTML = `<button class="b-list-add" style="margin:0">+ Add another list</button>`;
  const addListBtn = addListEl.querySelector('button');
  addListBtn.addEventListener('click', () => promptNewList(addListBtn));
  wrapper.appendChild(addListEl);

  return wrapper;
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — single card (Trello-style)
// ─────────────────────────────────────────────────────────────────────────
// Labels come in two shapes: rich objects ({name,color}) from manual cards,
// and bare strings from the domain orchestrator (auto issue/call/PM cards).
// Map the known string labels to friendly names + colors, hide the internal
// `kind:uuid` sentinels entirely, and humanize anything unrecognized — so
// auto-generated cards read as intentional instead of showing blank chips.
const B_LABEL_META = {
  'dispatch-call':   { name: 'Call',      color: '#6c7bd0' },
  'equipment-issue': { name: 'Issue',     color: '#c2553f' },
  'pm-due':          { name: 'PM Due',    color: '#d4a44e' },
  'pm-review':       { name: 'PM Review', color: '#6cd09a' },
};
function normalizeCardLabel(l){
  if (l && typeof l === 'object') return { name: l.name || '', color: l.color || 'var(--muted)' };
  if (typeof l === 'string') {
    if (l.indexOf(':') !== -1) return null;            // internal sentinel — never shown
    if (B_LABEL_META[l]) return B_LABEL_META[l];
    return { name: l.replace(/[-_]/g, ' '), color: 'var(--muted)' };
  }
  return null;
}

// ─── Trello-style positional drag helpers ────────────────────────────────
// The dragged card carries a live "placeholder" — a gap that follows the
// finger and shows exactly where the card will land. We track which card
// we'd drop *before* (null = end of list) so the drop can compute a
// fractional position between neighbours.
function removePlaceholder(P){
  if (P && P._ph) { P._ph.remove(); P._ph = null; }
  else document.querySelectorAll('.b-card-placeholder').forEach(n => n.remove());
}

function positionPlaceholder(P, listEl, y){
  removePlaceholder(P);
  P.overBeforeId = null;
  if (!listEl) return;
  const wrap = listEl.querySelector('.b-list-cards');
  if (!wrap) return;
  // Only consider real cards that aren't the one being dragged.
  const siblings = [...wrap.querySelectorAll('.b-card:not(.is-dragging)')];
  let beforeEl = null;
  for (const c of siblings){
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2){ beforeEl = c; break; }
  }
  const ph = document.createElement('div');
  ph.className = 'b-card-placeholder';
  if (beforeEl){
    P.overBeforeId = beforeEl.dataset.cardId;
    wrap.insertBefore(ph, beforeEl);
  } else {
    // Drop at the end — before the empty-state note if present, else append.
    const empty = wrap.querySelector('.b-list-empty');
    if (empty) wrap.insertBefore(ph, empty); else wrap.appendChild(ph);
  }
  P._ph = ph;
}

// Compute the fractional position a card should take when dropped into a
// list before `beforeId` (null = end). Excludes the card being moved so its
// old slot never skews the math. Midpoint insertion means one row write.
function computeDropPosition(listId, beforeId, excludeId){
  const inDest = cards
    .filter(c => c.list_id === listId && String(c.id) !== String(excludeId))
    .sort((a,b) => (a.position||0) - (b.position||0));
  if (!inDest.length) return 0;
  if (!beforeId){
    return (inDest[inDest.length - 1].position || 0) + 1;
  }
  const idx = inDest.findIndex(c => String(c.id) === String(beforeId));
  if (idx <= 0){
    return (inDest[0].position || 0) - 1;   // lands above the first card
  }
  const prev = inDest[idx - 1].position || 0;
  const cur  = inDest[idx].position || 0;
  return (prev + cur) / 2;                    // midpoint between neighbours
}

// ─── List (column) drag-to-reorder ───────────────────────────────────────
// The list header is the grab handle. Mouse: move past a threshold to pick
// up. Touch: hold, then drag (a plain swipe stays a horizontal scroll). Drop
// next to another column to reorder. Lists are few, so on drop we just
// renumber 0..n and write the rows that changed.
function enableListDrag(head, listEl, list){
  let P = null;
  const HOLD_MS = 300, MOVE_THRESH = 8;
  const clearTargets = () => document.querySelectorAll('.b-list.list-drop-target').forEach(l => l.classList.remove('list-drop-target'));

  const pickUp = () => {
    P.dragging = true;
    head.style.cursor = 'grabbing';
    const r = listEl.getBoundingClientRect();
    const clone = listEl.cloneNode(true);
    clone.classList.remove('is-list-dragging');
    clone.classList.add('b-list-dragclone');
    clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${Math.min(r.height, window.innerHeight*0.6)}px;margin:0;pointer-events:none;z-index:3000`;
    document.body.appendChild(clone);
    listEl.classList.add('is-list-dragging');
    P.clone = clone; P.offX = P.startX - r.left; P.offY = P.startY - r.top;
    try { navigator.vibrate?.(6); } catch(_) {}
  };

  const dragTo = (x, y) => {
    if (P.clone) {
      P.clone.style.left = (x - P.offX) + 'px';
      P.clone.style.top  = (y - P.offY) + 'px';
      P.clone.style.visibility = 'hidden';
    }
    const under = document.elementFromPoint(x, y);
    if (P.clone) P.clone.style.visibility = '';
    const over = under && under.closest('.b-list:not(.b-list-new):not(.is-list-dragging)');
    clearTargets();
    P.overListId = null; P.dropAfter = false;
    if (over) {
      over.classList.add('list-drop-target');
      const r = over.getBoundingClientRect();
      P.overListId = over.dataset.listId;
      P.dropAfter = x > r.left + r.width / 2;   // right half → drop after
    }
    const sc = listEl.closest('.b-lists');
    if (sc) {
      const m = 52;
      if (x < m) sc.scrollLeft -= 18;
      else if (x > window.innerWidth - m) sc.scrollLeft += 18;
    }
  };

  const drop = async () => {
    const overId = P.overListId, after = P.dropAfter;
    if (P.clone) P.clone.remove();
    listEl.classList.remove('is-list-dragging');
    clearTargets();
    head.style.cursor = 'grab';
    if (overId && String(overId) !== String(list.id)) {
      await reorderList(list.id, overId, after);
    }
  };

  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    P = { startX: e.clientX, startY: e.clientY, dragging: false, moved: false, clone: null, ptr: e.pointerId, type: e.pointerType };
    if (e.pointerType !== 'mouse') {
      P.holdTimer = setTimeout(() => {
        if (P && !P.dragging && !P.moved) { pickUp(); try { head.setPointerCapture(P.ptr); } catch(_) {} }
      }, HOLD_MS);
    }
  });
  head.addEventListener('pointermove', e => {
    if (!P) return;
    const dx = Math.abs(e.clientX - P.startX), dy = Math.abs(e.clientY - P.startY);
    if (!P.dragging && (dx > MOVE_THRESH || dy > MOVE_THRESH)) {
      if (P.type === 'mouse') { P.moved = true; pickUp(); try { head.setPointerCapture(P.ptr); } catch(_) {} }
      else { clearTimeout(P.holdTimer); P.moved = true; }   // pre-hold move = scroll
    }
    if (P.dragging) { e.preventDefault(); dragTo(e.clientX, e.clientY); }
  });
  head.addEventListener('pointerup', async () => {
    if (!P) return;
    clearTimeout(P.holdTimer);
    const wasDragging = P.dragging;
    P = null;
    if (wasDragging) { listEl._suppressClick = Date.now(); await drop(); }
  });
  head.addEventListener('pointercancel', () => {
    if (!P) return;
    clearTimeout(P.holdTimer);
    if (P.clone) P.clone.remove();
    listEl.classList.remove('is-list-dragging');
    clearTargets();
    head.style.cursor = 'grab';
    P = null;
  });
}

async function reorderList(dragId, overId, after){
  const ordered = [...lists].sort((a,b) => (a.position||0) - (b.position||0));
  const dragIdx = ordered.findIndex(l => String(l.id) === String(dragId));
  if (dragIdx < 0) return;
  const [moved] = ordered.splice(dragIdx, 1);
  let overIdx = ordered.findIndex(l => String(l.id) === String(overId));
  if (overIdx < 0) { ordered.push(moved); }
  else { ordered.splice(after ? overIdx + 1 : overIdx, 0, moved); }

  // Renumber densely; write only the rows whose position actually changed.
  const prev = lists;
  const updates = [];
  ordered.forEach((l, i) => { if (l.position !== i) { l.position = i; updates.push({ id: l.id, position: i }); } });
  if (!updates.length) return;
  lists = ordered;
  render();
  updates.forEach(u => listOptimistic.add(u.id));
  try{
    for (const u of updates){
      const { error } = await NX.sb.from('board_lists').update({ position: u.position }).eq('id', u.id);
      if (error) throw error;
    }
    // Safety net: drop guards even if an echo never arrives, so a later
    // genuine remote reorder isn't swallowed.
    setTimeout(() => updates.forEach(u => listOptimistic.delete(u.id)), 4000);
  }catch(e){
    console.error('[board] reorderList:', e);
    updates.forEach(u => listOptimistic.delete(u.id));
    lists = prev; render();
    NX.toast && NX.toast('Failed to reorder list — reverted', 'error');
  }
}

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
  // The onerror handler hides the cover entirely if the URL 404s
  // (common when nexus-files bucket isn't public, when a path was
  // deleted, or during a Supabase storage outage). Without it, the OS
  // would render the broken-image icon — which looked like the card
  // itself was broken.
  const cover = (card.photo_urls || [])[0];
  let html = '';
  if(cover){
    html += `<div class="b-card-cover"><img src="${esc(cover)}" loading="lazy" alt="" onerror="this.parentElement.style.display='none'"></div>`;
  }

  // Category color strip — a 4px bar at the top of the card body,
  // colored by the first label. Gives instant visual grouping across
  // columns the way Trello uses label strips. If there's no label and
  // no priority color, fall back to a faint neutral so the strip never
  // vanishes entirely (vanishing strips made cards look broken).
  const visibleLabels = (card.labels || []).map(normalizeCardLabel).filter(Boolean);
  const stripColor = visibleLabels[0]?.color || pri.color || 'rgba(200,164,78,0.18)';
  html += `<div class="b-card-strip" style="background:${stripColor}"></div>`;

  // Body (padded content — separate from cover so cover bleeds to edges)
  html += '<div class="b-card-body">';

  // Kebab (⋯) — opens the quick-actions sheet (priority, due, move, archive).
  // Replaces the old "→ Move" button: declutters the card and surfaces the
  // previously hidden long-press menu with a visible, tappable affordance.
  html += `<button class="b-card-kebab" data-kebab="${card.id}" aria-label="Card actions">⋯</button>`;

  // Labels (small chips, more Trello-ish — already exists, just more compact)
  if(visibleLabels.length){
    html += `<div class="b-card-labels">${
      visibleLabels.map(l => `<span class="b-card-label" style="background:${l.color}">${esc(l.name)}</span>`).join('')
    }</div>`;
  }

  // Title
  html += `<div class="b-card-title">${esc(card.title||'')}</div>`;

  // Badges row — priority, location, equipment, overdue
  const badges = [];
  if(card.priority === 'urgent') badges.push(`<span class="b-card-badge pri-urgent">URGENT</span>`);
  else if(card.priority === 'high') badges.push(`<span class="b-card-badge pri-high">HIGH</span>`);
  if(loc) badges.push(`<span class="b-card-badge loc loc-${loc.key}"><i data-lucide="map-pin" class="badge-icon"></i> ${esc(loc.label)}</span>`);
  if(card.equipment_id) badges.push(`<span class="b-card-badge eq"><i data-lucide="wrench" class="badge-icon"></i> Equipment</span>`);
  if(overdue) badges.push(`<span class="b-card-badge overdue">OVERDUE</span>`);
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
  if(cm.length) meta.push(`<i data-lucide="message-square" class="meta-icon"></i> ${cm.length}`);
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
    meta.push(`<span class="${dueCls}">${dueLbl}</span>`);
  }
  if(card.assignee) meta.push(`<span class="b-card-meta-assignee">${initials(card.assignee)}</span> ${esc(card.assignee)}`);
  // Show the ACTUAL cost on the face when set (the meaningful number on closed
  // cards) — previously only the estimate showed, so real repair costs were
  // invisible without reopening the card. Fall back to the estimate.
  if(card.cost_actual != null && card.cost_actual !== '') meta.push(`<span class="b-card-meta-cost">$${Number(card.cost_actual).toFixed(0)}</span>`);
  else if(card.cost_estimate) meta.push(`$${Number(card.cost_estimate).toFixed(0)} est`);
  // Age indicator — only for open cards. Silent under 3d, amber at 7d, red at 14d.
  if(!done && card.created_at){
    const ageDays = Math.floor((Date.now() - new Date(card.created_at).getTime())/86400000);
    if(ageDays >= 14) meta.push(`<span class="b-card-meta-age-old">${ageDays}d old</span>`);
    else if(ageDays >= 7) meta.push(`<span class="b-card-meta-age-warn">${ageDays}d old</span>`);
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

  // ── Unified pointer interaction ──────────────────────────────────────
  // HTML5 drag never fires on touch, which is why dragging "didn't work" on
  // the phone. This uses pointer events: tap → open detail; hold → pick up &
  // drag (touch); press-move → drag (mouse). Drop on a list to move. The
  // kebab opens a bottom sheet (the no-drag path, always reliable).
  el.draggable = false;
  let P = null;
  const HOLD_MS = 320, MOVE_THRESH = 8;
  const clearDropTargets = () => document.querySelectorAll('.b-list.drop-target').forEach(l => l.classList.remove('drop-target'));

  const pickUp = () => {
    P.dragging = true;
    dragCard = card;
    try { navigator.vibrate?.(6); } catch(_) {}
    // Measure + clone while the card is still at full size — THEN collapse
    // the original. (Order matters: `.is-dragging` now shrinks the card to a
    // zero-height gap, so cloning after collapse would produce an invisible
    // clone and a zero-height rect.)
    const r = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    clone.classList.remove('is-dragging');
    clone.classList.add('b-card-dragclone');
    clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;pointer-events:none;z-index:3000`;
    document.body.appendChild(clone);
    P.clone = clone; P.offX = P.startX - r.left; P.offY = P.startY - r.top;
    el.classList.add('is-dragging');
  };
  const dragTo = (x, y) => {
    if (P.clone) {
      P.clone.style.left = (x - P.offX) + 'px';
      P.clone.style.top  = (y - P.offY) + 'px';
      P.clone.style.visibility = 'hidden';
    }
    const under = document.elementFromPoint(x, y);
    if (P.clone) P.clone.style.visibility = '';
    const listEl = under && under.closest('.b-list');
    clearDropTargets();
    // Don't offer the "add another list" tile as a drop target.
    const dropList = listEl && !listEl.classList.contains('b-list-new') ? listEl : null;
    if (dropList) dropList.classList.add('drop-target');
    P.overListId = dropList ? dropList.dataset.listId : null;
    // Position the live gap where the card would land, and remember which
    // card we'd drop before (null = end of list). This is what makes
    // ordering feel like Trello — you drop into a slot, not just onto a list.
    positionPlaceholder(P, dropList, y);
    // Edge auto-scroll the horizontal lists container so you can drag across
    // columns even when only one is on screen (mobile snap layout).
    const sc = el.closest('.b-lists');
    if (sc) {
      const m = 52;
      if (x < m) sc.scrollLeft -= 16;
      else if (x > window.innerWidth - m) sc.scrollLeft += 16;
    }
  };
  const drop = async () => {
    const overId = P.overListId;
    const beforeId = P.overBeforeId || null;
    removePlaceholder(P);
    if (P.clone) P.clone.remove();
    el.classList.remove('is-dragging');
    clearDropTargets();
    dragCard = null;
    if (overId) {
      const target = lists.find(l => String(l.id) === String(overId));
      // Move even when the target list is the same one — that's an in-list
      // reorder. moveCard reads beforeId to compute the exact drop position.
      if (target) await moveCard(card, target, { beforeId });
    }
  };

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.b-card-kebab') || e.target.closest('.nx-tr-btn')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    P = { startX: e.clientX, startY: e.clientY, dragging: false, moved: false, clone: null, overListId: null, type: e.pointerType, ptr: e.pointerId };
    if (e.pointerType !== 'mouse') {
      P.holdTimer = setTimeout(() => {
        if (P && !P.dragging && !P.moved) { pickUp(); try { el.setPointerCapture(P.ptr); } catch(_) {} }
      }, HOLD_MS);
    }
  });
  el.addEventListener('pointermove', e => {
    if (!P) return;
    const dx = Math.abs(e.clientX - P.startX), dy = Math.abs(e.clientY - P.startY);
    if (!P.dragging && (dx > MOVE_THRESH || dy > MOVE_THRESH)) {
      P.moved = true;
      if (P.type === 'mouse') { pickUp(); try { el.setPointerCapture(P.ptr); } catch(_) {} }
      else { clearTimeout(P.holdTimer); }   // touch move before hold = scroll, not a drag
    }
    if (P.dragging) { e.preventDefault(); dragTo(e.clientX, e.clientY); }
  });
  el.addEventListener('pointerup', async () => {
    if (!P) return;
    clearTimeout(P.holdTimer);
    const wasDragging = P.dragging, moved = P.moved;
    if (wasDragging) await drop();
    P = null;
    if (!wasDragging && !moved) openCardDetail(card);   // clean tap
  });
  el.addEventListener('pointercancel', () => {
    if (!P) return;
    clearTimeout(P.holdTimer);
    removePlaceholder(P);
    if (P.clone) P.clone.remove();
    el.classList.remove('is-dragging');
    clearDropTargets();
    dragCard = null; P = null;
  });

  // Kebab + right-click → bottom sheet (reliable no-drag path)
  el.querySelector('.b-card-kebab').addEventListener('click', e => { e.stopPropagation(); openQuickActions(card, el); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); openQuickActions(card, el); });

  return el;
}

// Quick-actions menu — anchored to a card, shows priority chips,
// due-date picker, and Archive. Tap any action → write + render +
// close. Tap outside → close.
// Themed confirm sheet — replaces native confirm(), which looked jarringly
// out-of-place (and on Android shows the "github.io says" chrome) next to
// the styled quick-action sheets. Reuses the proven b-qa-sheet classes so
// it inherits the board's look in both themes; awaitable: resolves boolean.
function nxConfirm(message, opts = {}) {
  return new Promise(resolve => {
    document.querySelectorAll('.b-confirm-bg').forEach(m => m.remove());
    const bg = document.createElement('div');
    bg.className = 'b-qa-sheet-bg b-confirm-bg';
    const msgHtml = esc(String(message)).replace(/\n/g, '<br>');
    bg.innerHTML = `
      <div class="b-qa-sheet">
        <div class="b-qa-grip"></div>
        <div class="b-qa-cardtitle">${esc(opts.title || 'Are you sure?')}</div>
        <div style="font-size:13.5px;line-height:1.55;color:var(--muted,#9a8f7d);padding:2px 2px 14px">${msgHtml}</div>
        <div style="display:flex;gap:10px">
          <button class="b-qa-movechip" data-c="0" style="flex:1;justify-content:center">Cancel</button>
          <button class="b-qa-movechip" data-c="1" style="flex:1;justify-content:center;font-weight:600;${opts.danger ? 'color:var(--red,#e5484d);border-color:var(--red,#e5484d)' : 'color:var(--accent,#d4a44e);border-color:var(--accent,#d4a44e)'}">${esc(opts.okLabel || 'Confirm')}</button>
        </div>
      </div>`;
    const done = v => { bg.remove(); resolve(v); };
    bg.addEventListener('click', e => { if (e.target === bg) done(false); });
    bg.querySelector('[data-c="0"]').addEventListener('click', () => done(false));
    bg.querySelector('[data-c="1"]').addEventListener('click', () => done(true));
    document.body.appendChild(bg);
  });
}

function openQuickActions(card, anchorEl){
  // Close any existing sheet first (only one open at a time)
  document.querySelectorAll('.b-qa-sheet-bg').forEach(m => m.remove());

  const moveChips = lists.map(l => {
    const cur = l.id === card.list_id;
    return `<button class="b-qa-movechip${cur ? ' current' : ''}" data-move-list="${esc(l.id)}"${cur ? ' disabled' : ''}>${cur ? '✓ ' : ''}${esc(l.name)}</button>`;
  }).join('');

  const bg = document.createElement('div');
  bg.className = 'b-qa-sheet-bg';
  bg.innerHTML = `
    <div class="b-qa-sheet">
      <div class="b-qa-grip"></div>
      <div class="b-qa-cardtitle">${esc(card.title || 'Card')}</div>
      <div class="b-qa-section">
        <div class="b-qa-label">Move to</div>
        <div class="b-qa-moves">${moveChips}</div>
      </div>
      <div class="b-qa-section">
        <div class="b-qa-label">Priority</div>
        <div class="b-qa-row">
          <button class="b-qa-pri ${card.priority==='urgent'?'active':''}" data-pri="urgent" style="--c:var(--red)">Urgent</button>
          <button class="b-qa-pri ${card.priority==='high'?'active':''}"   data-pri="high"   style="--c:var(--accent)">High</button>
          <button class="b-qa-pri ${(card.priority==='normal'||!card.priority)?'active':''}" data-pri="normal" style="--c:var(--muted)">Normal</button>
          <button class="b-qa-pri ${card.priority==='low'?'active':''}"    data-pri="low"    style="--c:var(--faint)">Low</button>
        </div>
      </div>
      <div class="b-qa-section">
        <div class="b-qa-label">Due date</div>
        <div class="b-qa-row">
          <input class="b-qa-due" type="date" value="${esc(card.due_date||'')}">
          ${card.due_date ? '<button class="b-qa-due-clear">Clear</button>' : ''}
        </div>
      </div>
      <div class="b-qa-section b-qa-actions">
        <button class="b-qa-action b-qa-detail">Open card</button>
        <button class="b-qa-action b-qa-archive">Archive</button>
      </div>
      <button class="b-qa-cancel">Cancel</button>
    </div>`;
  const menu = bg.querySelector('.b-qa-sheet');   // downstream handlers query within this
  const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 180); };
  bg.addEventListener('click', e => { if(e.target === bg) close(); });
  bg.querySelector('.b-qa-cancel').addEventListener('click', close);
  // Move chips → move + close (the primary, reliable move path)
  bg.querySelectorAll('[data-move-list]').forEach(btn => {
    if(btn.disabled) return;
    btn.addEventListener('click', async () => {
      const target = lists.find(l => String(l.id) === btn.dataset.moveList);
      close();
      if(target) await moveCard(card, target);
    });
  });
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('open'));

  // Priority chips
  menu.querySelectorAll('.b-qa-pri').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newPri = btn.dataset.pri;
      const prev = card.priority;
      card.priority = newPri;
      optimisticSet.add(card.id);
      render();
      close();
      try{
        await NX.sb.from('kanban_cards').update({ priority: newPri }).eq('id', card.id);
        NX.toast && NX.toast(`Priority: ${newPri}`, 'success');
      }catch(e){
        card.priority = prev;
        optimisticSet.delete(card.id);
        render();
        NX.toast && NX.toast('Failed — reverted', 'error');
      }
    });
  });

  // Due-date input
  const dueInput = menu.querySelector('.b-qa-due');
  dueInput.addEventListener('change', async () => {
    const newDue = dueInput.value || null;
    const prev = card.due_date;
    card.due_date = newDue;
    optimisticSet.add(card.id);
    render();
    close();
    try{
      await NX.sb.from('kanban_cards').update({ due_date: newDue }).eq('id', card.id);
      NX.toast && NX.toast(newDue ? `Due ${newDue}` : 'Due date cleared', 'success');
    }catch(e){
      card.due_date = prev;
      optimisticSet.delete(card.id);
      render();
      NX.toast && NX.toast('Failed — reverted', 'error');
    }
  });
  // Clear date button
  const clearBtn = menu.querySelector('.b-qa-due-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', async () => {
      const prev = card.due_date;
      card.due_date = null;
      optimisticSet.add(card.id);
      render();
      close();
      try{
        await NX.sb.from('kanban_cards').update({ due_date: null }).eq('id', card.id);
        NX.toast && NX.toast('Due date cleared', 'success');
      }catch(e){
        card.due_date = prev;
        optimisticSet.delete(card.id);
        render();
        NX.toast && NX.toast('Failed — reverted', 'error');
      }
    });
  }

  // Open detail (modal) — escape hatch when quick actions aren't enough
  menu.querySelector('.b-qa-detail').addEventListener('click', () => {
    close();
    openCardDetail(card);
  });

  // Archive
  menu.querySelector('.b-qa-archive').addEventListener('click', async () => {
    if(!(await nxConfirm(`Archive "${card.title}"?`, { title: 'Archive card', okLabel: 'Archive', danger: true }))){ return; }
    close();
    const prev = card.archived;
    card.archived = true;
    optimisticSet.add(card.id);
    // Remove from local state since loadCards filters by archived=false
    const idx = cards.findIndex(c => c.id === card.id);
    if(idx >= 0) cards.splice(idx, 1);
    render();
    try{
      await NX.sb.from('kanban_cards').update({ archived: true }).eq('id', card.id);
      closeMirrorTicket(card);
      NX.toast && NX.toast('Card archived', 'success');
    }catch(e){
      card.archived = prev;
      optimisticSet.delete(card.id);
      cards.push(card);
      render();
      NX.toast && NX.toast('Archive failed', 'error');
    }
  });
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
  // The move targets now live in the bottom sheet alongside priority/due,
  // so this just opens that — one reliable, big-target surface.
  openQuickActions(card, null);
}

// Archiving a card files its mirrored ticket too — otherwise the ticket
// stays open forever and quietly inflates Duties + the Home "Open Tickets"
// count (the unified model closes both sides together). Best-effort.
function closeMirrorTicket(card){
  const tid = card && card.ticket_id;
  if (!tid || !NX.sb) return;
  try {
    if (NX.work && NX.work.syncTicketToCard) {
      NX.work.syncTicketToCard({ ticketId: tid, closed: true });
    } else {
      NX.sb.from('tickets').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', tid)
        .then(r => { if (r && r.error) console.warn('[board] mirror ticket close failed — Duties may still show it open:', r.error.message); });
    }
  } catch (_) {}
}

async function moveCard(card, targetList, opts){
  const beforeId = opts && opts.beforeId ? opts.beforeId : null;

  // ── SAME-LIST REORDER ────────────────────────────────────────────────
  // Dropping a card back into its own list is a pure position change — no
  // status/column churn, no done-side-effects. Compute the fractional slot
  // and write only `position`. Bail if the slot didn't actually change.
  if (String(card.list_id) === String(targetList.id)){
    const newPos = computeDropPosition(targetList.id, beforeId, card.id);
    const prevPos = card.position;
    if (newPos === prevPos) { render(); return; }   // re-render clears drag state
    card.position = newPos;
    optimisticSet.add(card.id);
    render();
    try{
      const { error } = await NX.sb.from('kanban_cards').update({ position: newPos }).eq('id', card.id);
      if (error) throw error;
      setTimeout(() => optimisticSet.delete(card.id), 4000);
    }catch(e){
      console.error('[board] reorder:', e);
      card.position = prevPos;
      optimisticSet.delete(card.id);
      render();
      NX.toast && NX.toast('Failed to reorder — reverted', 'error');
    }
    return;
  }

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
    // v18.33 — stamp closed_at when entering a done lane, clear it when
    // leaving one. The daily log's "closed today" bucket reads this.
    const updatePayload = {
      list_id: targetList.id,
      column_name: targetColName,
      status,
    };
    // Position in the destination list. A drag (opts present) lands in the
    // exact slot the user dropped into — fractional midpoint between
    // neighbours, or top/end. A menu/programmatic move (no opts) keeps the
    // long-standing add-to-top convention.
    {
      let newPos;
      if (opts) {
        newPos = computeDropPosition(targetList.id, beforeId, card.id);
      } else {
        const inDest = cards.filter(c => c.list_id === targetList.id && c.id !== card.id);
        newPos = inDest.length
          ? Math.min(...inDest.map(c => (typeof c.position === 'number' ? c.position : 0))) - 1
          : 0;
      }
      updatePayload.position = newPos;
      card.position = newPos;
    }
    if (movingToDone && wasNotDone) {
      updatePayload.closed_at = new Date().toISOString();
    } else if (!movingToDone && isDone({ column_name: prev.column_name, list_id: prev.list_id })) {
      // Moving OUT of a done lane — clear the close timestamp so a
      // reopened card doesn't carry a stale closed_at.
      updatePayload.closed_at = null;
    }
    const { error } = await NX.sb.from('kanban_cards').update(updatePayload).eq('id', card.id);
    if(error){
      // v18.33 — tolerate the pre-migration window where closed_at
      // doesn't exist yet. Retry the move without the closed_at field
      // so card moves never break. (Run sql/kanban_cards_closed_at.sql
      // to enable "closed today" tracking in the daily log.)
      if(error.code === '42703' && 'closed_at' in updatePayload){
        const { closed_at, ...rest } = updatePayload;
        const retry = await NX.sb.from('kanban_cards').update(rest).eq('id', card.id);
        if(retry.error) throw retry.error;
        if(!window._kanbanClosedAtWarned){
          window._kanbanClosedAtWarned = true;
          console.warn('[board] kanban_cards.closed_at missing — card moved without it. Run sql/kanban_cards_closed_at.sql.');
        }
      } else {
        throw error;
      }
    } else {
      // Keep the in-memory card consistent with what we wrote
      if ('closed_at' in updatePayload) card.closed_at = updatePayload.closed_at;
    }
    // ── CROSS-SYSTEM CLOSE-OUT ────────────────────────────────────
    // Keep the mirrored ticket (Duties / home counts / biweekly) in step
    // with the card's lane so the two surfaces never drift.
    if (card.ticket_id && NX.work && NX.work.syncTicketToCard) {
      if (movingToDone && wasNotDone) {
        NX.work.syncTicketToCard({ ticketId: card.ticket_id, closed: true });
      } else if (!movingToDone && isDone({ column_name: prev.column_name, list_id: prev.list_id })) {
        NX.work.syncTicketToCard({ ticketId: card.ticket_id, closed: false });
      }
    }
    // If this card just moved to Done and is linked to equipment
    // that isn't currently Operational, offer to mark the equipment
    // repaired. One confirm, one update, one toast — saves switching
    // to the Equip tab to manually flip the status.
    if (movingToDone && wasNotDone && card.equipment_id) {
      offerEquipmentRepaired(card);
    }
    // If this card was escalated from a cleaning section, completing
    // it writes "done today" records to cleaning_logs for every task
    // in that section. The cleaning view's OVERDUE pill clears next
    // load. The card itself stays around as the system-of-record for
    // the work (photos, comments, costs, contractor).
    if (movingToDone && wasNotDone && card.cleaning_link_location && card.cleaning_link_section) {
      closeOutCleaningSection(card);
    }
    // If this card is linked to an equipment_issues row (via the
    // labels sentinel `issue:<uuid>`), mark that issue as repaired so
    // the equipment detail's issue tracker reflects reality. Fully
    // handled inside the domain layer — fire-and-forget here.
    if (movingToDone && wasNotDone && NX.domain?.resolveEquipmentIssue) {
      NX.domain.resolveEquipmentIssue({ card }).catch(e => {
        console.warn('[board] resolveEquipmentIssue hook failed:', e);
      });
    }
    // If this is a 'PM Due' card (label `sched:<uuid>`), completing it on the
    // board now completes the SCHEDULE — same path as the /pm "Done" button:
    // roll next_due_at forward, log the PM, restart the equipment health bar,
    // and archive the card. Previously dragging a PM-due card to Done just
    // archived it and did nothing to the schedule or equipment.
    if (movingToDone && wasNotDone && NX.domain?.completePMSchedule) {
      const schedId = (Array.isArray(card.labels) ? card.labels : [])
        .map(l => (typeof l === 'string' && l.startsWith('sched:')) ? l.slice(6) : null)
        .find(Boolean);
      if (schedId) {
        NX.domain.completePMSchedule({ scheduleId: schedId, equipmentId: card.equipment_id })
          .catch(e => console.warn('[board] completePMSchedule hook failed:', e));
      }
    }
    // Safety net: clear the optimistic guard even if the realtime echo never
    // arrives, so a later genuine remote move isn't silently swallowed.
    setTimeout(() => optimisticSet.delete(card.id), 4000);
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

/* When a card escalated from a cleaning section is moved to Done,
   write completion records to cleaning_logs for every task index in
   that section. We can't query cleaning's DEFAULTS table from here
   (it's hard-coded in cleaning.js), so we count the tasks via the
   logs themselves: any task_index that has EVER been recorded for
   this section gets a fresh "done today" entry.
   
   For sections that have never been logged before, we fall back to
   logging task_index 0 only. The cleaning view treats "any task done
   today" in a section as evidence the section was worked on, and its
   `oldestDays` recompute will reflect that. Not perfect — but the
   user's actual fallback is to open cleaning and tap "All ✓" on the
   section, which is one extra tap. */
async function closeOutCleaningSection(card) {
  const location = card.cleaning_link_location;
  const section = card.cleaning_link_section;
  const today = new Date().toISOString().slice(0, 10);
  const completedAt = new Date().toISOString();
  try {
    // Find all task_indices that have ever existed for this section.
    // De-dupe in JS since Supabase doesn't have a clean DISTINCT in
    // its query builder for arbitrary columns.
    const { data } = await NX.sb.from('cleaning_logs')
      .select('task_index')
      .eq('location', location)
      .eq('section', section)
      .limit(500);
    const indices = Array.from(new Set((data || []).map(r => r.task_index)));
    if (!indices.length) indices.push(0);  // fallback: at least mark task_index 0

    // Upsert one row per task_index for today's date, marking done.
    const rows = indices.map(idx => ({
      location,
      log_date: today,
      task_index: idx,
      section,
      done: true,
      completed_at: completedAt,
    }));
    // Supabase upsert with onConflict — handles re-runs if the user
    // moves the card to Done, back to In Progress, then to Done again.
    const { error } = await NX.sb.from('cleaning_logs').upsert(rows, {
      onConflict: 'location,log_date,task_index,section'
    });
    if (error) throw error;
    NX.toast && NX.toast(`${section} marked done in Cleaning · ${location}`, 'success');
  } catch (err) {
    console.error('[closeOutCleaningSection]', err);
    // Don't toast error — the card move itself succeeded, this is
    // a secondary effect. Silent failure is OK; user can manually
    // tap All ✓ on the section in Cleaning.
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

    if (!(await nxConfirm(`This card is about ${eq.name}. If it's resolved, the equipment should reflect that too.`, { title: `Mark "${eq.name}" Operational?`, okLabel: 'Mark Operational' }))) return;

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
// Stable id for checklist items / comments so atomic merges can match
// them across concurrent edits (legacy rows have none — stamped on open).
function genId(){
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch(_) {}
  return 'x_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Atomic single-column read-modify-write. Re-fetches the current value so
// we merge against the latest server state instead of clobbering it with a
// stale snapshot (the old whole-row save lost concurrent comments/photos).
// Updates the in-memory card + cards[] entry and guards the realtime echo.
async function patchCardField(card, field, mutator){
  let current = card[field];
  try{
    const { data } = await NX.sb.from('kanban_cards').select(field).eq('id', card.id).single();
    if(data && data[field] != null) current = data[field];
  }catch(_){ /* fall back to local copy */ }
  const base = Array.isArray(current) ? [...current] : (current || []);
  const next = mutator(base);
  optimisticSet.add(card.id);
  try{
    const { error } = await NX.sb.from('kanban_cards').update({ [field]: next }).eq('id', card.id);
    if(error) throw error;
  }catch(e){
    optimisticSet.delete(card.id);
    console.error('[board] patchCardField', field, e);
    NX.toast && NX.toast('Save failed', 'error');
    throw e;
  }
  card[field] = next;
  const idx = cards.findIndex(c => c.id === card.id);
  if(idx >= 0) cards[idx][field] = next;
  // Safety net: clear the optimistic guard even if the realtime echo never
  // arrives (offline / dropped socket), so later genuine remote edits aren't
  // silently swallowed.
  setTimeout(() => optimisticSet.delete(card.id), 4000);
  return next;
}

// Filename shown for an attached invoice (best-effort from the storage URL).
function invoiceFileName(u){
  try { return decodeURIComponent(String(u).split('/').pop().split('?')[0]) || 'Invoice'; }
  catch(_) { return 'Invoice'; }
}
function invoiceRowHtml(u){
  return `<div class="b-invoice-row" data-invoice="${esc(u)}">
    <a class="b-invoice-link" href="${esc(u)}" target="_blank" rel="noopener"><i data-lucide="file-text"></i><span>${esc(invoiceFileName(u))}</span></a>
    <button type="button" class="b-invoice-del" data-delinvoice="${esc(u)}" aria-label="Remove invoice">×</button>
  </div>`;
}

async function openCardDetail(card){
  // Refresh equipment cache in background for the picker
  loadEquipmentCache();

  // Stamp stable ids on checklist items that lack them (legacy rows) so
  // toggles/merges can match by id. If we stamped any, persist once so the
  // DB copy carries the ids too.
  let _needIdStamp = false;
  (card.checklist || []).forEach(it => { if(it && !it.id){ it.id = genId(); _needIdStamp = true; } });
  if(_needIdStamp){
    try{ await NX.sb.from('kanban_cards').update({ checklist: card.checklist }).eq('id', card.id); }catch(_){}
  }

  const bg = document.createElement('div');
  bg.className = 'b-modal-bg';
  bg.innerHTML = `<div class="b-modal">
    <div class="b-modal-head">
      <input class="b-modal-title" id="bTitle" value="${esc(card.title||'')}" placeholder="Card title">
      <button class="b-modal-close">✕</button>
    </div>
    <div class="b-modal-body">

      ${card.cleaning_link_section ? `
      <div class="b-cleaning-link">
        <span class="b-cleaning-link-icon"><i data-lucide="sparkles"></i></span>
        <div class="b-cleaning-link-body">
          <div class="b-cleaning-link-title">Linked to Cleaning</div>
          <div class="b-cleaning-link-meta">${esc(card.cleaning_link_section)} · ${esc(card.cleaning_link_location||'')}</div>
        </div>
        <div class="b-cleaning-link-hint">Marking this card Done will timestamp the section as completed today.</div>
      </div>` : ''}

      <div class="b-section">
        <div class="b-section-label">
          Description
          <button type="button" class="b-tr-btn" id="bTrDesc" title="Translate to your language" style="display:none"><i data-lucide="languages" class="b-btn-icon"></i> Translate</button>
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
              `<option value="${l.key}"${locKey(card.location)===l.key?' selected':''}>${l.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="b-section" id="bEqSection">
        <div class="b-section-label">Linked Equipment</div>
        <div id="bEqEmbed"><!-- populated async --></div>
      </div>

      <!-- Unified progress timeline (v19): merges calls/dispatches, PM &
           service logs (with photos), status changes, and comments into one
           chronological "full progress" view. Populated by renderProgressTimeline(). -->
      <div class="b-section" id="bProgressSection" style="display:none">
        <div class="b-section-label">Progress</div>
        <div id="bProgress"><!-- populated async --></div>
      </div>

      <!-- ── Issue Lifecycle (v18.5) ────────────────────────────────
           Shown only when the card has an issue:UUID label, i.e.
           it's linked to an equipment_issues row. Surfaces the same
           timeline equipment view shows, but lets you drive it from
           the board. Populated async by renderIssueTimeline(). -->
      <div class="b-section" id="bIssueSection" style="display:none">
        <div class="b-section-label" id="bIssueLabel">Issue Lifecycle</div>
        <div id="bIssueTimeline"><!-- populated async --></div>
      </div>

      <!-- ── Repair Attempts (v18.5) ────────────────────────────────
           Shown when the card has an equipment_id. Lists dispatch_events
           for the equipment with method, contractor, outcome, notes,
           and per-attempt action buttons. Populated async by
           renderRepairAttempts(). -->
      <div class="b-section" id="bAttemptsSection" style="display:none">
        <div class="b-section-label">
          Repair Attempts
          <button type="button" class="b-tr-btn" id="bAddAttempt" title="Log a new repair attempt"><i data-lucide="plus" class="b-btn-icon"></i> Add</button>
        </div>
        <div id="bAttempts"><!-- populated async --></div>
      </div>

      <div class="b-section">
        <div class="b-section-label">Photos</div>
        <div class="b-photos" id="bPhotos">
          ${(card.photo_urls||[]).map((u) =>
            `<span class="b-photo-wrap"><img class="b-photo" src="${esc(u)}" data-url="${esc(u)}" onerror="this.style.display='none'"><button type="button" class="b-photo-del" data-delphoto="${esc(u)}" aria-label="Remove photo">×</button></span>`
          ).join('')}
          <button class="b-photo-add" id="bPhotoAdd">+</button>
        </div>
        <input type="file" id="bPhotoInput" accept="image/*" capture="environment" style="display:none">
      </div>

      <div class="b-section">
        <div class="b-section-label">Invoices</div>
        <div class="b-invoices" id="bInvoices">
          ${(card.invoice_urls||[]).map((u) => invoiceRowHtml(u)).join('')}
        </div>
        <button class="b-invoice-add" id="bInvoiceAdd" type="button"><i data-lucide="file-text"></i> Add invoice</button>
        <input type="file" id="bInvoiceInput" accept="application/pdf,image/*" style="display:none">
      </div>

      <div class="b-section">
        <div class="b-section-label">Checklist</div>
        <div id="bChecklist">
          ${(card.checklist||[]).map((c) =>
            `<div class="b-check${c.done?' done':''}"><input type="checkbox" data-id="${esc(c.id||'')}"${c.done?' checked':''}><span>${esc(c.text||'')}</span></div>`
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
        <div class="b-parts-bom" id="bPartsBom" style="display:none">
          <!-- populated when card.equipment_id exists; shows BOM as
               tappable chips with auto-populating prices from the
               preferred vendor of each part -->
        </div>
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
        ${card.equipment_id ? `<button class="b-btn" id="bCall"><i data-lucide="phone" class="b-btn-icon"></i> Call Service</button>` : ''}
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
          trBtn.innerHTML = '<i data-lucide="languages" class="b-btn-icon"></i> Translate'; if(window.lucide)lucide.createIcons();
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
          trBtn.textContent = 'retry';
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

  // Close handlers — only write if a scalar field actually changed (or the
  // equipment link changed). Array fields (checklist/comments/photos) are
  // already persisted atomically as they're edited, so a plain close — or an
  // accidental backdrop tap — no longer issues a full-row write that could
  // clobber a concurrent edit.
  const readScalars = () => ({
    title:         (bg.querySelector('#bTitle').value || '').trim(),
    description:   (bg.querySelector('#bDesc').value || '').trim(),
    priority:      bg.querySelector('#bPri').value,
    location:      bg.querySelector('#bLoc').value || '',
    assignee:      (bg.querySelector('#bAssignee').value || '').trim(),
    due_date:      bg.querySelector('#bDue').value || '',
    parts_needed:  (bg.querySelector('#bParts').value || '').trim(),
    cost_estimate: bg.querySelector('#bCostEst').value || '',
    cost_actual:   bg.querySelector('#bCostAct').value || '',
    equipment_id:  card.equipment_id || '',
  });
  const _initialScalars = JSON.stringify(readScalars());
  const closeDetail = () => {
    if(JSON.stringify(readScalars()) !== _initialScalars){ saveCard(card, bg, true); }
    else { bg.remove(); }
  };
  bg.addEventListener('click', e => { if(e.target===bg) closeDetail(); });
  bg.querySelector('.b-modal-close').addEventListener('click', closeDetail);

  // Equipment embed (async — fetches the equipment row)
  renderEquipmentEmbed(card, bg.querySelector('#bEqEmbed'));

  // Issue lifecycle timeline (v18.5 — only if card links to an
  // equipment_issue via `issue:<uuid>` label). Loads the issue row
  // and renders the 6-step ordering-style timeline. Tap a step to
  // advance; "Reopen" button appears once status === 'repaired'.
  renderIssueTimeline(card, bg);

  // Repair Attempts (v18.5 — dispatch_events for the linked equipment).
  // Each row shows method, contractor, outcome, notes, photos +
  // per-row "Mark resolved" / "Mark failed" buttons.
  renderRepairAttempts(card, bg);

  // Unified Progress timeline (v19) — the "full progress, pictures along the
  // way" view. Merges calls, PM/service logs, status changes and comments.
  renderProgressTimeline(card, bg);

  // Parts BOM picker (async — fetches the equipment's bill of
  // materials so the user can quick-pick from real parts instead of
  // typing free-text. Each chip shows the part name and the
  // preferred vendor's price; tapping a chip appends the part to
  // the parts input and adds the price to Est $.)
  renderPartsBomPicker(card, bg);

  // ── Photos: fullscreen, add, remove ──
  const openFullscreen = (url) => {
    const fs = document.createElement('div');
    fs.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer';
    fs.innerHTML = `<img src="${esc(url)}" style="max-width:100%;max-height:100%;object-fit:contain">`;
    fs.addEventListener('click', () => fs.remove());
    document.body.appendChild(fs);
  };
  const wirePhotoWrap = (wrap) => {
    const img = wrap.querySelector('.b-photo');
    const del = wrap.querySelector('.b-photo-del');
    if(img) img.addEventListener('click', () => openFullscreen(img.dataset.url || img.src));
    if(del) del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = del.dataset.delphoto;
      try{ await patchCardField(card, 'photo_urls', arr => arr.filter(x => x !== url)); wrap.remove(); }catch(_){}
    });
  };
  bg.querySelectorAll('#bPhotos .b-photo-wrap').forEach(wirePhotoWrap);

  // Photo add
  bg.querySelector('#bPhotoAdd').addEventListener('click', () => bg.querySelector('#bPhotoInput').click());
  bg.querySelector('#bPhotoInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const url = await uploadPhoto(file, card.id);
    if(!url) return;
    try{
      await patchCardField(card, 'photo_urls', arr => [...arr, url]);
      // Live-append the thumbnail (no teardown, so unsaved edits aren't lost).
      const wrap = bg.querySelector('#bPhotos');
      const addBtn = wrap.querySelector('#bPhotoAdd');
      const span = document.createElement('span');
      span.className = 'b-photo-wrap';
      span.innerHTML = `<img class="b-photo" src="${esc(url)}" data-url="${esc(url)}" onerror="this.style.display='none'"><button type="button" class="b-photo-del" data-delphoto="${esc(url)}" aria-label="Remove photo">×</button>`;
      if(addBtn) wrap.insertBefore(span, addBtn); else wrap.appendChild(span);
      wirePhotoWrap(span);
    }catch(_){ /* toast already shown */ }
  });

  // ── Invoices: add (PDF/image), view, remove ──
  const wireInvoiceRow = (row) => {
    const del = row.querySelector('.b-invoice-del');
    if(del) del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = del.dataset.delinvoice;
      try{ await patchCardField(card, 'invoice_urls', arr => arr.filter(x => x !== url)); row.remove(); }catch(_){}
    });
  };
  bg.querySelectorAll('#bInvoices .b-invoice-row').forEach(wireInvoiceRow);
  bg.querySelector('#bInvoiceAdd').addEventListener('click', () => bg.querySelector('#bInvoiceInput').click());
  bg.querySelector('#bInvoiceInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const url = await uploadPhoto(file, card.id);   // generic upload — handles PDFs too
    if(!url) return;
    try{
      await patchCardField(card, 'invoice_urls', arr => [...arr, url]);
      const wrap = bg.querySelector('#bInvoices');
      wrap.insertAdjacentHTML('beforeend', invoiceRowHtml(url));
      wireInvoiceRow(wrap.lastElementChild);
      if(window.lucide?.createIcons) window.lucide.createIcons();
    }catch(_){}
  });

  // Checklist toggle — persists immediately, merging against latest DB
  // state (matched by item id) so a concurrent add/toggle isn't lost.
  const toggleCheck = async (id, cb) => {
    cb.parentElement.classList.toggle('done', cb.checked);
    try{
      await patchCardField(card, 'checklist', arr => arr.map(it => (it && it.id === id) ? { ...it, done: cb.checked } : it));
    }catch(_){
      cb.checked = !cb.checked;
      cb.parentElement.classList.toggle('done', cb.checked);
    }
  };
  bg.querySelectorAll('#bChecklist input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => toggleCheck(cb.dataset.id, cb));
  });
  // Checklist add
  const addCheck = async () => {
    const inp = bg.querySelector('#bCheckInput');
    const t = inp.value.trim(); if(!t) return;
    const item = { id: genId(), text: t, done: false };
    inp.value = '';
    try{
      await patchCardField(card, 'checklist', arr => [...arr, item]);
      const cl = bg.querySelector('#bChecklist');
      cl.insertAdjacentHTML('beforeend',
        `<div class="b-check"><input type="checkbox" data-id="${item.id}"><span>${esc(t)}</span></div>`);
      cl.lastElementChild.querySelector('input').addEventListener('change', e => toggleCheck(item.id, e.target));
    }catch(_){ inp.value = t; }
  };
  bg.querySelector('#bCheckAdd').addEventListener('click', addCheck);
  bg.querySelector('#bCheckInput').addEventListener('keydown', e => {
    if(e.key==='Enter'){ e.preventDefault(); addCheck(); }
  });

  // Comment add — append-only, persisted immediately against latest DB.
  const addComment = async () => {
    const inp = bg.querySelector('#bCommentInput');
    const t = inp.value.trim(); if(!t) return;
    const c = { id: genId(), text:t, by: NX.currentUser?.name || '?', at: new Date().toISOString() };
    inp.value = '';
    try{
      await patchCardField(card, 'comments', arr => [...arr, c]);
      bg.querySelector('#bComments').insertAdjacentHTML('beforeend',
        `<div class="b-comment"><span class="b-comment-by">${esc(c.by)}</span><span class="b-comment-time">${new Date(c.at).toLocaleDateString()}</span><div class="b-comment-text">${esc(c.text)}</div></div>`);
    }catch(_){ inp.value = t; }
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
    if(!(await nxConfirm('Archive this card?', { title: 'Archive card', okLabel: 'Archive', danger: true }))) return;
    await NX.sb.from('kanban_cards').update({ archived: true }).eq('id', card.id);
    closeMirrorTicket(card);
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
          const k = locKey(eq.location) || eq.location;
          card.location = k;
          const locSel = document.querySelector('#bLoc');
          if(locSel) locSel.value = locKey(eq.location) || '';
        }
        renderEquipmentEmbed(card, container);
        // Refresh the parts BOM picker for the newly-linked equipment
        const modal = container.closest('.b-modal-bg');
        if (modal) renderPartsBomPicker(card, modal);
      }
    });
    return;
  }
  // We have equipment_id — fetch full equipment + render embed
  try{
    const { data: eq } = await NX.sb.from('equipment')
      .select('*')
      .eq('id', card.equipment_id).single();
    if(!eq){
      container.innerHTML = '<div style="font-size:11px;color:var(--text-faint)">Equipment not found</div>';
      return;
    }
    const meta = [eq.category, eq.manufacturer, eq.model].filter(Boolean).join(' · ');
    const health = (eq.health_score != null)
      ? `<span style="color:${eq.health_score>=70?'var(--green)':eq.health_score>=40?'var(--accent)':'var(--red)'}">${eq.health_score}%</span>`
      : '—';
    // Vendor(s) responsible for this equipment — deep-link into the vendor
    // profile (cross-module). Show repair separately only if it differs.
    const vlinks = [];
    if (eq.service_vendor_id) vlinks.push({ id: eq.service_vendor_id, name: eq.service_contractor_name || 'Service vendor', role: 'Serviced by' });
    if (eq.repair_vendor_id && String(eq.repair_vendor_id) !== String(eq.service_vendor_id)) vlinks.push({ id: eq.repair_vendor_id, name: eq.repair_contractor_name || 'Repair vendor', role: 'Repairs by' });
    const vlinksHtml = vlinks.map(vl =>
      `<button class="b-btn b-vendor-go" data-vendor-id="${esc(String(vl.id))}" style="margin-top:6px;font-size:11px;display:flex;align-items:center;gap:6px;width:100%;justify-content:flex-start;text-align:left"><i data-lucide="briefcase" class="b-btn-icon"></i><span style="opacity:.55">${esc(vl.role)}</span>&nbsp;${esc(vl.name)} →</button>`
    ).join('');
    container.innerHTML = `
      <div class="b-eq-embed" id="bEqGo">
        <div class="b-eq-embed-icon"><i data-lucide="wrench"></i></div>
        <div class="b-eq-embed-body">
          <div class="b-eq-embed-name">${esc(eq.name)}</div>
          <div class="b-eq-embed-meta">${esc(meta)}${meta?' · ':''}Health ${health}</div>
        </div>
        <div class="b-eq-embed-chev">›</div>
      </div>
      ${vlinksHtml}
      <button class="b-btn" id="bEqUnlink" style="margin-top:6px;font-size:11px">Unlink equipment</button>`;
    container.querySelector('#bEqGo').addEventListener('click', () => {
      // Robust cross-view jump — lazy-loads equipment if it isn't in yet (the
      // old NX.modules?.equipment?.openDetail guard silently no-op'd from the
      // board when equipment hadn't been opened). Focus the linked issue when
      // this card came from one (issue:<id> label).
      const issueId = (card.labels || [])
        .map(l => typeof l === 'string' ? l : (l && l.name) || '')
        .map(s => /^issue:(.+)$/.exec(s)).filter(Boolean).map(m => m[1])[0] || null;
      const go = window.eqOpenDetail || (NX.modules && NX.modules.equipment && NX.modules.equipment.openDetail);
      if (go) {
        go(eq.id, issueId ? { focusIssue: issueId } : undefined);
        const modal = container.closest('.b-modal-bg');
        if (modal) modal.remove();
      }
    });
    container.querySelector('#bEqUnlink').addEventListener('click', () => {
      card.equipment_id = null;
      renderEquipmentEmbed(card, container);
      // BOM is meaningless without a linked equipment; clear it
      const bom = document.getElementById('bPartsBom');
      if (bom) { bom.innerHTML = ''; bom.style.display = 'none'; }
    });
    container.querySelectorAll('.b-vendor-go').forEach(b => {
      b.addEventListener('click', () => {
        const vid = b.getAttribute('data-vendor-id');
        if (vid && NX.modules?.vendors?.openVendor) {
          NX.modules.vendors.openVendor(vid);
          const modal = container.closest('.b-modal-bg');
          if (modal) modal.remove();
        }
      });
    });
  }catch(e){
    console.error('[board] equipment embed:', e);
    container.innerHTML = '<div style="font-size:11px;color:var(--text-faint)">Could not load equipment</div>';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PARTS BOM QUICK-PICKER
// When a card is linked to an equipment, fetch that equipment's parts
// (bill of materials) and render them as tappable chips below the
// "Parts Needed" input. Tapping a chip:
//   1. Appends the part name to the input (comma-separated, no dupes)
//   2. Adds the preferred vendor's price to the Est $ field
//   3. Toggles a "selected" visual state
// This is faster than typing part names by hand AND cheaper to estimate
// because the prices come from real vendor data already in the system.
// ─────────────────────────────────────────────────────────────────────────
async function renderPartsBomPicker(card, modal){
  const bom = modal.querySelector('#bPartsBom');
  if (!bom) return;
  if (!card.equipment_id){
    bom.innerHTML = '';
    bom.style.display = 'none';
    return;
  }

  try {
    const { data: parts, error } = await NX.sb
      .from('equipment_parts')
      .select('id, part_name, oem_part_number, vendors, supplier, last_price, assembly_path')
      .eq('equipment_id', card.equipment_id)
      .order('assembly_path', { ascending: true })
      .order('part_name',     { ascending: true });
    if (error) throw error;
    if (!parts || !parts.length){
      bom.innerHTML = '';
      bom.style.display = 'none';
      return;
    }

    // For each part, find the preferred vendor's price (or fall back to
    // last_price if the legacy single-vendor schema is in use).
    const enriched = parts.map(p => {
      let price = null;
      const vendors = Array.isArray(p.vendors) ? p.vendors : [];
      const preferred = vendors.find(v => v && v.is_preferred);
      const anyPriced = vendors.find(v => v && v.price != null && v.price !== '');
      if (preferred && preferred.price != null && preferred.price !== '') {
        price = parseFloat(preferred.price);
      } else if (anyPriced) {
        price = parseFloat(anyPriced.price);
      } else if (p.last_price != null && p.last_price !== '') {
        price = parseFloat(p.last_price);
      }
      return { id: p.id, name: p.part_name, oem: p.oem_part_number, price: isNaN(price) ? null : price };
    });

    // Render chips
    bom.style.display = 'block';
    bom.innerHTML = `
      <div class="b-parts-bom-label">Quick-pick from this equipment</div>
      <div class="b-parts-bom-chips">
        ${enriched.map(p => `
          <button type="button" class="b-parts-bom-chip" data-part-id="${esc(p.id)}" data-price="${p.price ?? ''}" data-name="${esc(p.name || '')}">
            <span class="b-parts-bom-chip-name">${esc(p.name || 'Unnamed')}</span>
            ${p.price != null ? `<span class="b-parts-bom-chip-price">$${p.price.toFixed(2)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;

    // Helper: rebuild the parts input + est cost from the currently
    // selected chips. Selected chips are tracked via .is-selected
    // class. Plus any free-text the user typed that doesn't match a
    // BOM part name is preserved at the end.
    const partsInput = modal.querySelector('#bParts');
    const estInput   = modal.querySelector('#bCostEst');
    const knownNames = new Set(enriched.map(p => (p.name || '').toLowerCase()));

    function rebuildFromChips(){
      const selected = bom.querySelectorAll('.b-parts-bom-chip.is-selected');
      const names = [];
      let priceSum = 0;
      selected.forEach(c => {
        names.push(c.dataset.name);
        const pr = parseFloat(c.dataset.price);
        if (!isNaN(pr)) priceSum += pr;
      });
      // Preserve any free-text the user added that isn't a known BOM
      // part — split by comma, drop matches, keep the rest.
      const existing = (partsInput.value || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s && !knownNames.has(s.toLowerCase()));
      const combined = [...names, ...existing].join(', ');
      partsInput.value = combined;
      // Only auto-fill Est if the user hasn't entered a value, OR the
      // current value matches our running total (i.e. we're updating
      // our own number). Don't stomp on a manually-typed estimate.
      const currentEst = parseFloat(estInput.value);
      if (!estInput.value || estInput._bomManaged) {
        estInput.value = priceSum > 0 ? priceSum.toFixed(2) : '';
        estInput._bomManaged = true;
      } else if (!isNaN(currentEst) && Math.abs(currentEst - (estInput._lastBomSum || 0)) < 0.005) {
        // Was at our last computed sum — safe to update
        estInput.value = priceSum > 0 ? priceSum.toFixed(2) : '';
        estInput._bomManaged = true;
      }
      estInput._lastBomSum = priceSum;
    }

    // If the existing parts_needed text already matches some chip
    // names, pre-select those chips so the visual state reflects
    // what was already saved.
    const existingTokens = (card.parts_needed || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    bom.querySelectorAll('.b-parts-bom-chip').forEach(chip => {
      if (existingTokens.includes((chip.dataset.name || '').toLowerCase())){
        chip.classList.add('is-selected');
      }
      chip.addEventListener('click', () => {
        chip.classList.toggle('is-selected');
        rebuildFromChips();
      });
    });
  } catch (e) {
    console.error('[board] parts BOM picker:', e);
    bom.innerHTML = '';
    bom.style.display = 'none';
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
    const numOrNull = (v) => (v !== '' && v != null && !isNaN(Number(v))) ? Number(v) : null;
    const cost_estimate = numOrNull(costEstRaw);
    const cost_actual = numOrNull(costActRaw);

    // SCALAR fields only. checklist / comments / photo_urls / labels are
    // persisted atomically via patchCardField as they're edited, so we never
    // blind-write those arrays from a possibly-stale modal snapshot (that was
    // the lost-update bug — a concurrent comment would be overwritten).
    const patch = {
      title, description, priority, location,
      assignee, due_date,
      parts_needed, cost_estimate, cost_actual,
      equipment_id: card.equipment_id || null,
    };

    optimisticSet.add(card.id);
    const { error } = await NX.sb.from('kanban_cards').update(patch).eq('id', card.id);
    if(error){ optimisticSet.delete(card.id); throw error; }
    // Keep in-memory state in step so a re-render doesn't flash stale values.
    Object.assign(card, patch);
    const idx = cards.findIndex(c => c.id === card.id);
    if(idx >= 0) Object.assign(cards[idx], patch);
    setTimeout(() => optimisticSet.delete(card.id), 4000);

    if(closeAfter){
      modal.remove();
      render();
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
// INLINE COMPOSER — replaces native prompt() for new cards/lists/boards
//
// Trello has had inline composition for a decade: type in the column,
// press Enter, card appears. Native browser prompt() is jarring on
// mobile (system dialog) and ugly on desktop. This helper takes a
// "trigger" element (the + Add button) and swaps it for a small
// textarea + submit/cancel pair. Calls onSubmit(text) when committed.
//
// Usage:
//   startInlineComposer(triggerEl, {
//     placeholder: 'Enter a title…',
//     buttonLabel: 'Add card',
//     onSubmit: async (text) => { ... },
//   });
//
// Behavior:
//   • Focus textarea immediately
//   • Enter submits (Shift+Enter newline)
//   • Escape cancels
//   • Cancel button (✕) cancels
//   • On submit, the textarea clears and stays open for fast batch entry
//   • Click outside the composer also cancels
// ─────────────────────────────────────────────────────────────────────────
function startInlineComposer(triggerEl, opts){
  if(!triggerEl) return;
  const placeholder = opts?.placeholder || 'Enter a title…';
  const buttonLabel = opts?.buttonLabel || 'Add';
  const onSubmit = opts?.onSubmit;
  const minRows = opts?.minRows || 2;
  const wantLoc = !!(opts && opts.locationPicker);

  // Build the composer
  const composer = document.createElement('div');
  composer.className = 'b-composer';
  composer.innerHTML = `
    <textarea class="b-composer-input" rows="${minRows}" placeholder="${esc(placeholder)}"></textarea>
    ${wantLoc ? `<select class="b-composer-loc" style="width:100%;box-sizing:border-box;margin-top:6px;padding:9px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:var(--surface-2,#1b1b1d);color:var(--text);font-family:inherit;font-size:12.5px"><option value="">— Location (required) —</option></select>` : ''}
    <div class="b-composer-actions">
      <button type="button" class="b-composer-submit">${esc(buttonLabel)}</button>
      <button type="button" class="b-composer-cancel" title="Cancel" aria-label="Cancel">✕</button>
    </div>
  `;

  // Hide the trigger, insert composer in its place
  const parent = triggerEl.parentElement;
  if(!parent) return;
  triggerEl.style.display = 'none';
  parent.insertBefore(composer, triggerEl.nextSibling);

  const ta = composer.querySelector('.b-composer-input');
  const submitBtn = composer.querySelector('.b-composer-submit');
  const cancelBtn = composer.querySelector('.b-composer-cancel');
  const locSel = composer.querySelector('.b-composer-loc');

  // Populate the location dropdown from the canonical LOCATIONS list so the
  // stored value is always a canonical key (suerte/este/toti). Previously this
  // used raw distinct equipment.location strings ("SUERTE"), which saved a
  // value that no badge/filter/modal could match — the location vanished from
  // the card even though it was stored. Default to the last-used location.
  if (locSel) {
    let last = '';
    try { last = localStorage.getItem('nexus.board.lastLocation') || ''; } catch (_) {}
    last = locKey(last) || '';
    LOCATIONS.forEach(l => {
      const o = document.createElement('option');
      o.value = l.key; o.textContent = l.label;
      if (l.key === last) o.selected = true;
      locSel.appendChild(o);
    });
  }

  // Focus immediately. requestAnimationFrame ensures the element is in
  // the layout tree before iOS Safari accepts focus.
  requestAnimationFrame(() => ta.focus());

  let closed = false;
  const close = () => {
    if(closed) return;
    closed = true;
    composer.remove();
    triggerEl.style.display = '';
    document.removeEventListener('mousedown', onOutside, true);
  };
  const submit = async () => {
    const text = ta.value.trim();
    if(!text){
      // Empty submit = cancel
      close();
      return;
    }
    let location;
    if (locSel) {
      location = locSel.value;
      // Force a choice when locations actually exist.
      if (locSel.options.length > 1 && !location) {
        locSel.style.borderColor = 'var(--red,#e5484d)';
        locSel.focus();
        NX.toast && NX.toast('Pick a location for this card', 'error', 2000);
        return;
      }
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '…';
    try{
      await onSubmit?.(text, { location });
      if (location) { try { localStorage.setItem('nexus.board.lastLocation', location); } catch (_) {} }
      // Reset for fast batch entry — Trello keeps the composer open so
      // users can type a second card without re-clicking Add. The chosen
      // location stays selected so a batch shares it.
      ta.value = '';
      submitBtn.disabled = false;
      submitBtn.textContent = buttonLabel;
      ta.focus();
    }catch(e){
      console.error('[composer] submit failed:', e);
      submitBtn.disabled = false;
      submitBtn.textContent = buttonLabel;
      NX.toast && NX.toast('Add failed — try again', 'error');
    }
  };

  // Click outside cancels (but not clicks inside the composer itself)
  const onOutside = (e) => {
    if(!composer.contains(e.target)){
      // If there's text, treat outside-click as submit (Trello pattern).
      // Otherwise just close.
      if(ta.value.trim()) submit();
      else close();
    }
  };
  // Defer attaching the outside-click listener so the same click that
  // opened the composer doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  // Keyboard shortcuts
  ta.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      submit();
    } else if(e.key === 'Escape'){
      e.preventDefault();
      close();
    }
  });

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE CARD / LIST / BOARD
// ─────────────────────────────────────────────────────────────────────────
async function createCard(listId, payload){
  // Pure data path — used by both the inline composer and external
  // callers (prefill flow). Returns the created row or null.
  try{
    const { data: created } = await NX.sb.from('kanban_cards').insert({
      title: payload.title,
      description: payload.description || null,
      board_id: activeBoard.id,
      list_id: listId,
      column_name: '',
      // Add-to-top (Trello-style): one below the current lowest position so
      // the new card renders first. Render sorts by position ascending.
      position: (() => {
        const inList = cards.filter(c => c.list_id === listId);
        if (!inList.length) return 0;
        return Math.min(...inList.map(c => (typeof c.position === 'number' ? c.position : 0))) - 1;
      })(),
      priority: payload.priority || 'normal',
      location: payload.location || null,
      equipment_id: payload.equipment_id || null,
      reported_by: NX.currentUser?.name || null,
      checklist: [], comments: [],
      labels: Array.isArray(payload.labels) ? payload.labels : [],
      photo_urls: [],
      archived: false,
    }).select().single();

    // Ticket mirror — the unified model (card = source of truth, ticket =
    // mirror) so board-created work shows in Duties and the Home "Open
    // Tickets" count like every other creation path. Best-effort: a mirror
    // failure never blocks the card.
    if (created) {
      try {
        const { data: t } = await NX.sb.from('tickets').insert({
          title: payload.title,
          notes: payload.description || null,
          location: payload.location || null,
          priority: payload.priority || 'normal',
          status: 'open',
          reported_by: NX.currentUser?.name || 'Staff',
          equipment_id: payload.equipment_id || null,
          board_card_id: created.id,
        }).select('id').single();
        if (t && t.id) {
          await NX.sb.from('kanban_cards').update({ ticket_id: t.id }).eq('id', created.id);
          created.ticket_id = t.id;
        }
      } catch (e) { console.warn('[board] ticket mirror failed (card kept):', e?.message || e); }
    }
    await loadCards(); render();
    NX.toast && NX.toast('Card created', 'success');
    // Fire push notification — every new card = every new report = buzzes
    // the managers/admins who need to know. Fire-and-forget.
    if (created && NX.notifyCardCreated) NX.notifyCardCreated(created);
    return created;
  }catch(e){
    console.error('[board] createCard:', e);
    NX.toast && NX.toast('Could not create card', 'error');
    throw e;  // let the inline composer reset its button on failure
  }
}

async function promptNewCard(listId, prefillOrTrigger){
  // Two callable forms:
  //   1. promptNewCard(listId, triggerEl)  — UI path, opens inline composer
  //   2. promptNewCard(listId, {title, ...}) — programmatic prefill, immediate insert
  //   3. promptNewCard(listId)             — fallback, opens inline composer if a +Add button exists
  const arg = prefillOrTrigger;
  // Form 2: prefill object with a title
  if(arg && typeof arg === 'object' && !arg.nodeType && arg.title){
    const created = await createCard(listId, arg);
    if(created) openCardDetail(created);
    return;
  }
  // Form 1 or 3: find or use a trigger to anchor the inline composer
  const triggerEl = (arg && arg.nodeType) ? arg
    : document.querySelector(`.b-list .b-list-add[data-list="${listId}"]`)
      || document.querySelector(`.b-list-cards[data-list-id="${listId}"]`)?.parentElement?.querySelector('.b-list-add');
  if(!triggerEl){
    // No trigger to anchor against — fall back to a minimal modal. This
    // shouldn't happen in normal use but keeps the function robust.
    const title = prompt('Card title:');
    if(!title) return;
    let loc = null; try { loc = localStorage.getItem('nexus.board.lastLocation') || null; } catch (_) {}
    await createCard(listId, { title, location: loc });
    return;
  }
  startInlineComposer(triggerEl, {
    placeholder: 'Enter a title for this card…',
    buttonLabel: 'Add card',
    locationPicker: true,
    onSubmit: async (text, meta) => {
      await createCard(listId, { title: text, location: (meta && meta.location) || null });
    },
  });
}

async function promptNewList(triggerEl){
  // If a trigger element is provided, use the inline composer.
  // Otherwise fall back to the legacy prompt() (rare path).
  if(triggerEl && triggerEl.nodeType){
    startInlineComposer(triggerEl, {
      placeholder: 'Enter list title…',
      buttonLabel: 'Add list',
      minRows: 1,
      onSubmit: async (text) => {
        await NX.sb.from('board_lists').insert({
          board_id: activeBoard.id, name: text, position: lists.length
        });
        await loadLists(); render();
      },
    });
    return;
  }
  const name = prompt('List name:');
  if(!name) return;
  try{
    await NX.sb.from('board_lists').insert({
      board_id: activeBoard.id, name, position: lists.length
    });
    await loadLists(); render();
  }catch(e){ console.error('[board] promptNewList:', e); }
}

async function promptNewBoard(triggerEl){
  const create = async (name) => {
    const { data: nb } = await NX.sb.from('boards').insert({
      name, color: 'var(--accent)', position: boards.length
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
  };
  if(triggerEl && triggerEl.nodeType){
    startInlineComposer(triggerEl, {
      placeholder: 'New board name…',
      buttonLabel: 'Create board',
      minRows: 1,
      onSubmit: create,
    });
    return;
  }
  const name = prompt('Board name:');
  if(!name) return;
  try{ await create(name); }
  catch(e){ console.error('[board] promptNewBoard:', e); }
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
    count: cards.filter(c => locKey(c.location) === l.key).length,
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
      <div style="flex:1;font-size:14px;font-weight:600">Board Stats</div>
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
    NX.toast && NX.toast('Nothing to clean up — you are caught up', 'success');
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
        <div style="font-size:14px;font-weight:600">Clean Up</div>
        <div id="bTriageProgress" style="font-size:11px;color:var(--text-dim);margin-top:2px"></div>
      </div>
      <button class="b-modal-close">✕ Done</button>
    </div>
    <div class="b-modal-body" id="bTriageBody"></div>
    <div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:8px;flex-wrap:wrap;background:rgba(255,255,255,0.02)">
      <button class="b-btn b-btn-danger" id="bTArchive" style="flex:1;min-width:100px"><i data-lucide="archive" class="b-btn-icon"></i> Archive</button>
      <button class="b-btn" id="bTClose" style="flex:1;min-width:100px;background:rgba(156, 138, 62,0.12);color:var(--green);border-color:rgba(156, 138, 62,0.3)">✓ Close</button>
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
        <div style="font-size:36px;margin-bottom:10px;color:var(--nx-gold);font-weight:300">◇</div>
        <div style="font-size:16px;color:var(--accent);margin-bottom:8px;font-weight:600">All done!</div>
        <div style="font-size:13px;color:var(--text-dim)">
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
    if (c.priority === 'urgent') badges.push('<span class="b-card-badge pri-urgent">URGENT</span>');
    else if (c.priority === 'high') badges.push('<span class="b-card-badge pri-high">HIGH</span>');
    if (loc) badges.push(`<span class="b-card-badge loc loc-${loc.key}"><i data-lucide="map-pin" class="badge-icon"></i> ${esc(loc.label)}</span>`);
    if (c.equipment_id) badges.push('<span class="b-card-badge eq"><i data-lucide="wrench" class="badge-icon"></i> Equipment</span>');
    if (overdue) badges.push('<span class="b-card-badge overdue">OVERDUE</span>');
    if (stuckDays != null && stuckDays > 30) badges.push(`<span class="b-card-badge overdue">⏳ Stuck ${stuckDays}d</span>`);

    const photoHtml = (c.photo_urls||[]).length
      ? `<img src="${esc(c.photo_urls[0])}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;margin-bottom:8px">`
      : '';

    bodyEl.innerHTML = `
      <div style="position:relative;padding-left:8px;border-left:4px solid ${pri.color||'transparent'};margin-bottom:12px">
        <div style="font-size:15px;font-weight:600;color:var(--text);line-height:1.3;margin-bottom:8px">${esc(c.title||'(untitled)')}</div>
        ${badges.length ? `<div class="b-card-badges">${badges.join('')}</div>` : ''}
      </div>
      ${photoHtml}
      ${c.description ? `<div style="font-size:13px;color:var(--text);margin-bottom:10px;line-height:1.4;white-space:pre-wrap">${esc(c.description)}</div>` : ''}
      <div style="font-size:11px;color:var(--text-dim);line-height:1.6">
        ${created ? `Created ${ageDays}d ago (${created.toLocaleDateString()})<br>` : ''}
        ${lastChange ? `Last status change ${stuckDays}d ago<br>` : ''}
        ${c.status ? `Status: <strong>${esc((c.status||'').replace(/_/g,' '))}</strong><br>` : ''}
        ${c.assignee ? `Assigned: ${esc(c.assignee)}<br>` : ''}
        ${c.reported_by ? `Reported by: ${esc(c.reported_by)}<br>` : ''}
        ${c.due_date ? `Due: ${esc(c.due_date)}<br>` : ''}
      </div>
      ${(c.checklist && c.checklist.length) ? `<div style="margin-top:10px;font-size:11px;color:var(--text-dim)">Checklist: ${c.checklist.filter(x=>x.done).length}/${c.checklist.length} done</div>` : ''}
      ${(c.comments && c.comments.length) ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim)"><i data-lucide="message-square" class="meta-icon"></i> ${c.comments.length} comment${c.comments.length!==1?'s':''}</div>` : ''}
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
        closeMirrorTicket(c);
        archivedCount++;
      } else if (action === 'close') {
        // v18.33 — stamp closed_at so the daily log "closed today" bucket
        // picks up triage-closed cards. Tolerate the column being absent.
        const closePayload = { status: 'closed', closed_at: new Date().toISOString() };
        let closeErr = (await NX.sb.from('kanban_cards').update(closePayload).eq('id', c.id)).error;
        if (closeErr && closeErr.code === '42703') {
          closeErr = (await NX.sb.from('kanban_cards').update({ status: 'closed' }).eq('id', c.id)).error;
        }
        if (closeErr) throw closeErr;
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
    if (!(await nxConfirm(`This bulk-archives all ${remaining} cards you haven't triaged yet. They aren't deleted — you can find them later by filtering "archived".`, { title: `Archive ALL ${remaining} remaining?`, okLabel: 'Archive all', danger: true }))) return;
    const ids = allOpen.slice(idx).map(c => c.id);
    try {
      // Supabase caps batch updates; chunk into groups of 200
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await NX.sb.from('kanban_cards').update({ archived: true }).in('id', chunk);
      }
      // File the mirrored tickets for everything just archived.
      allOpen.slice(idx).forEach(c => closeMirrorTicket(c));
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
  bindVisibilityHandler();
  // Route first-load through show() so the work-order open-intent, the
  // "New card" compose-intent, and the missing-card backfill all run on the
  // very first board open of a session — not just on later re-entries.
  // (app.js calls init() the first time a lazy module loads, show() after.)
  await show();
}

async function show(){
  // Warm the equipment cache so the manual-card location picker is ready
  // the instant the composer opens (locations come from equipment).
  loadEquipmentCache();
  // v18.34 — Home "New card" quick action sets NX.boardComposeIntent.
  // After the board renders, click the first lane's add-card trigger so
  // the composer opens automatically. One-shot — cleared after use.
  const wantCompose = NX.boardComposeIntent;
  NX.boardComposeIntent = false;
  const openComposerSoon = () => {
    if (!wantCompose) return;
    setTimeout(() => {
      const trigger = document.querySelector('.b-list .b-list-add');
      if (trigger) trigger.click();
    }, 250);
  };

  // Home "Work Orders" tap sets NX.boardOpenIntent = { issueId | cardId }.
  // After the board renders, locate that card and open its detail. One-shot,
  // cleared after use. Retries briefly so a card the backfill just created
  // (below) is still caught.
  const wantOpen = NX.boardOpenIntent;
  NX.boardOpenIntent = null;
  const findIntentCard = (intent) => {
    if (!intent) return null;
    if (intent.cardId) {
      const byId = cards.find(c => String(c.id) === String(intent.cardId));
      if (byId) return byId;
    }
    if (intent.issueId) {
      const tag = 'issue:' + intent.issueId;
      return cards.find(c => Array.isArray(c.labels) && c.labels.some(l => String(l) === tag)) || null;
    }
    return null;
  };
  const openIntentSoon = () => {
    if (!wantOpen) return;
    let tries = 0;
    let ensured = false;
    let globalChecked = false;
    const tryOpen = async () => {
      let card = findIntentCard(wantOpen);
      if (card) { openCardDetail(card); return; }
      // Not found on the ACTIVE board. The dedup that guards card creation
      // is global (any board), but the search above is active-board only —
      // so a work-order card on another board was "found" by dedup yet
      // invisible here, and the old flow gave up with a toast. Look the
      // card up globally first; if it lives on another board, switch to
      // that board and open it there.
      if (!globalChecked && (wantOpen.issueId || wantOpen.cardId)) {
        globalChecked = true;
        try {
          let q = NX.sb.from('kanban_cards').select('*').eq('archived', false);
          q = wantOpen.cardId
            ? q.eq('id', wantOpen.cardId)
            : q.contains('labels', ['issue:' + wantOpen.issueId]);
          const { data: hits } = await q.limit(1);
          const hit = hits && hits[0];
          if (hit && activeBoard && String(hit.board_id) !== String(activeBoard.id)) {
            const other = boards.find(b => String(b.id) === String(hit.board_id));
            if (other) {
              activeBoard = other;
              await loadCards();
              render();
              const found = findIntentCard(wantOpen);
              if (found) { openCardDetail(found); return; }
            } else {
              // Card's board isn't in the picker (hidden/legacy board) —
              // open the card detail directly from the fetched row.
              openCardDetail(hit);
              return;
            }
          } else if (hit) {
            // Same board but missing from the local cache (stale fetch /
            // realtime race) — refresh and open.
            await loadCards();
            render();
            const found = findIntentCard(wantOpen);
            if (found) { openCardDetail(found); return; }
            openCardDetail(hit);
            return;
          }
        } catch (_) {}
      }
      // Still nothing — create the card on demand once (covers work orders
      // that never got a board card), then reload and retry.
      if (!ensured && wantOpen.issueId && NX.domain && typeof NX.domain.ensureIssueCard === 'function') {
        ensured = true;
        try { await NX.domain.ensureIssueCard(wantOpen.issueId); } catch (_) {}
        await loadCards();
        render();
        card = findIntentCard(wantOpen);
        if (card) { openCardDetail(card); return; }
      }
      if (++tries < 4) setTimeout(tryOpen, 450);   // give backfillIssueCards time
      else NX.toast && NX.toast('Could not find that work order on the board', 'warn', 2600);
    };
    setTimeout(tryOpen, 300);
  };

  // One-time per session: backfill board cards for any OPEN equipment issues
  // that don't have one yet (reported via paths that skipped the board, or
  // before this orchestration existed). Idempotent + deduped by issue label.
  if (NX.domain && typeof NX.domain.backfillIssueCards === 'function' && !window.__nxIssueCardBackfillDone) {
    window.__nxIssueCardBackfillDone = true;
    NX.domain.backfillIssueCards().then(n => {
      if (n) { loadCards().then(() => render()); NX.toast && NX.toast(n + ' work order' + (n > 1 ? 's' : '') + ' added to board', 'info', 2400); }
    }).catch(() => {});
  }

  // Stale-while-revalidate: if we have a live realtime subscription and
  // data pulled recently, render from memory NOW (instant), then kick
  // a silent refresh in the background. Tab switches become snappy.
  const isWarm = rtChannel && rtConnected && (Date.now() - lastFetchAt) < 10000;
  if(isWarm && !wantOpen){
    render();
    openComposerSoon();
    // Silent background refresh — only re-renders if anything changed
    // (realtime should have caught mutations already, this is a safety
    // net against dropped events during reconnect windows).
    loadStats();
    return;
  }
  await loadCards();
  loadStats();
  render();
  openComposerSoon();
  openIntentSoon();
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

// Open a specific card's detail by id — lets other modules (e.g. Vendors)
// deep-link straight into a work order. Loads the board + the card first,
// switches to the Board view, then opens the detail overlay.
async function openCard(cardId){
  if(!cardId) return;
  try{
    if(!boards.length) await loadBoards();
    if((!cards || !cards.length) && typeof loadCards === 'function') await loadCards();
  }catch(_){}
  let card = (cards || []).find(c => String(c.id) === String(cardId));
  if(!card){
    try{ const { data } = await NX.sb.from('kanban_cards').select('*').eq('id', cardId).single(); if(data) card = data; }catch(_){}
  }
  if(!card){ NX.toast && NX.toast('Card not found', 'warn', 1800); return; }
  document.querySelector('.nav-tab[data-view="board"]')?.click();
  document.querySelector('.bnav-btn[data-view="board"]')?.click();
  setTimeout(() => { try{ openCardDetail(card); }catch(e){ console.error('[board] openCard:', e); } }, 60);
}

// ═══════════════════════════════════════════════════════════════════════
// v18.5 — Issue Lifecycle Timeline + Repair Attempts
// ═══════════════════════════════════════════════════════════════════════
//
// These two functions populate the new sections in openCardDetail():
//
//   - renderIssueTimeline(card, bg)   → reads `issue:<uuid>` from
//                                       card.labels, fetches the
//                                       equipment_issues row, renders
//                                       a 6-step ordering-style timeline
//                                       and wires tap-to-advance +
//                                       Reopen button.
//
//   - renderRepairAttempts(card, bg)  → fetches the last N dispatch_events
//                                       for card.equipment_id, renders
//                                       each as a card with Mark Resolved
//                                       / Mark Failed buttons.
//
// All status-change ripples (equipment.status proposals) go through
// the domain layer. Board.js just collects the user's confirmation.
// ═══════════════════════════════════════════════════════════════════════

const ISSUE_LIFECYCLE_LABELS_B = {
  reported:           'Reported',
  contractor_called:  'Called',
  eta_set:            'ETA Set',
  in_progress:        'In Progress',
  awaiting_parts:     'Parts',
  repaired:           'Repaired',
};
const ISSUE_LIFECYCLE_STEPS_B = ['reported', 'contractor_called', 'eta_set', 'in_progress', 'awaiting_parts', 'repaired'];

function issueTsForStep(issue, step) {
  if (!issue) return null;
  switch (step) {
    case 'reported':           return issue.reported_at;
    case 'contractor_called':  return issue.contractor_called_at;
    case 'eta_set':            return issue.eta_set_at;
    case 'in_progress':        return issue.in_progress_at;
    case 'awaiting_parts':     return issue.awaiting_parts_at;
    case 'repaired':           return issue.repaired_at;
    default:                   return null;
  }
}

function fmtIssueTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  } catch (_) { return ''; }
}

function extractIssueIdFromLabels(labels) {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    if (typeof l === 'string' && l.startsWith('issue:')) return l.slice(6);
  }
  return null;
}

async function renderIssueTimeline(card, bg) {
  const issueId = extractIssueIdFromLabels(card.labels);
  const sect = bg.querySelector('#bIssueSection');
  const host = bg.querySelector('#bIssueTimeline');
  if (!sect || !host) return;
  if (!issueId) {
    sect.style.display = 'none';
    return;
  }

  // Fetch the linked issue
  let issue;
  try {
    const { data, error } = await NX.sb.from('equipment_issues')
      .select('*').eq('id', issueId).maybeSingle();
    if (error) throw error;
    issue = data;
  } catch (e) {
    console.warn('[board] renderIssueTimeline fetch failed:', e?.message || e);
  }
  if (!issue) {
    sect.style.display = 'none';
    return;
  }

  sect.style.display = '';
  const currentIdx = ISSUE_LIFECYCLE_STEPS_B.indexOf(issue.status);

  function paint() {
    const idx = ISSUE_LIFECYCLE_STEPS_B.indexOf(issue.status);
    const stepsHtml = ISSUE_LIFECYCLE_STEPS_B.map((s, i) => {
      const reached = i <= idx;
      const isCurrent = i === idx;
      const ts = reached ? fmtIssueTs(issueTsForStep(issue, s)) : '';
      const cls = ['b-il-step'];
      if (reached) cls.push('is-reached');
      if (isCurrent) cls.push('is-current');
      return `
        <div class="${cls.join(' ')}" data-step="${esc(s)}" role="button" aria-label="Advance to ${esc(ISSUE_LIFECYCLE_LABELS_B[s])}">
          <div class="b-il-marker">${reached ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
          <div class="b-il-text">
            <div class="b-il-label">${esc(ISSUE_LIFECYCLE_LABELS_B[s])}</div>
            ${ts ? `<div class="b-il-ts">${esc(ts)}</div>` : ''}
          </div>
        </div>
        ${i < ISSUE_LIFECYCLE_STEPS_B.length - 1 ? `<div class="b-il-bar ${i < idx ? 'is-reached' : ''}"></div>` : ''}
      `;
    }).join('');

    const reopenBtn = issue.status === 'repaired'
      ? `<button class="b-btn b-il-reopen" id="bIssueReopen"><i data-lucide="rotate-ccw" class="b-btn-icon"></i> Reopen / Continue</button>`
      : '';

    host.innerHTML = `
      <div class="b-il-timeline">${stepsHtml}</div>
      <div class="b-il-actions">${reopenBtn}</div>
    `;
    if (window.lucide) try { lucide.createIcons(); } catch (_) {}

    // Wire taps on steps. Forward-advance only (can't tap backward
    // except via Reopen). Tap a future step → advances issue to that
    // status, then proposes equipment.status change.
    host.querySelectorAll('.b-il-step').forEach(stepEl => {
      stepEl.addEventListener('click', async () => {
        const target = stepEl.getAttribute('data-step');
        const targetIdx = ISSUE_LIFECYCLE_STEPS_B.indexOf(target);
        if (targetIdx <= idx) return;                // can't go backward via tap
        if (!(await nxConfirm(`Mark issue as "${ISSUE_LIFECYCLE_LABELS_B[target]}"?`, { title: 'Update work order', okLabel: 'Update' }))) return;
        stepEl.classList.add('is-loading');
        try {
          const res = await NX.domain.transitionEquipmentIssue({
            issueId: issue.id, newStatus: target,
          });
          if (!res.ok) { NX.toast?.('Could not advance issue', 'error'); return; }
          issue = res.issue;
          paint();
          await maybeApplyProposal(res.statusProposal);
          NX.toast?.(`Marked ${ISSUE_LIFECYCLE_LABELS_B[target]}`, 'info', 1100);
        } finally {
          stepEl.classList.remove('is-loading');
        }
      });
    });

    // Reopen button
    const reopen = host.querySelector('#bIssueReopen');
    if (reopen) reopen.addEventListener('click', () => openReopenPicker(issue, paint));
  }
  paint();
}

// Modal asking "Same issue continued, or new problem?"
function openReopenPicker(issue, repaintTimeline) {
  const m = document.createElement('div');
  m.className = 'b-modal-bg b-modal-bg-stack';
  m.innerHTML = `
    <div class="b-modal b-modal-narrow">
      <div class="b-modal-head">
        <div class="b-modal-title-static">Reopen this ticket?</div>
        <button class="b-modal-close">✕</button>
      </div>
      <div class="b-modal-body">
        <div class="b-il-reopen-hint">What's happening with this equipment?</div>
        <div class="b-il-reopen-options">
          <button class="b-il-reopen-opt" data-mode="continue">
            <div class="b-il-reopen-opt-title">It broke again — same issue</div>
            <div class="b-il-reopen-opt-sub">Continue this ticket. Past attempts stay as history. Status goes back to "In Progress".</div>
          </button>
          <button class="b-il-reopen-opt" data-mode="newProblem">
            <div class="b-il-reopen-opt-title">It's a different problem</div>
            <div class="b-il-reopen-opt-sub">Keep this ticket closed. Start a fresh ticket for the new issue.</div>
          </button>
        </div>
        <div id="bReopenNewForm" style="display:none">
          <input class="b-field" id="bReopenNewTitle" placeholder="What's the new problem? (brief title)" style="margin-bottom:6px">
          <textarea class="b-field" id="bReopenNewDesc" rows="2" placeholder="More details (optional)"></textarea>
          <button class="b-btn b-btn-primary" id="bReopenNewSubmit" style="margin-top:8px;width:100%">Create new ticket</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('.b-modal-close').addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });

  m.querySelectorAll('.b-il-reopen-opt').forEach(opt => {
    opt.addEventListener('click', async () => {
      const mode = opt.getAttribute('data-mode');
      if (mode === 'continue') {
        if (!(await nxConfirm('Continue this ticket and reopen for more work?', { title: 'Reopen work order', okLabel: 'Reopen' }))) return;
        const res = await NX.domain.reopenEquipmentIssue({ issueId: issue.id, mode: 'continue' });
        if (!res.ok) { NX.toast?.('Could not reopen', 'error'); return; }
        // Update local issue copy to the new state
        Object.assign(issue, res.issue);
        await maybeApplyProposal(res.statusProposal);
        NX.toast?.('Ticket reopened', 'info', 1200);
        close();
        if (repaintTimeline) repaintTimeline();
      } else if (mode === 'newProblem') {
        const form = m.querySelector('#bReopenNewForm');
        form.style.display = '';
        m.querySelector('#bReopenNewTitle')?.focus();
      }
    });
  });

  m.querySelector('#bReopenNewSubmit')?.addEventListener('click', async () => {
    const newTitle = m.querySelector('#bReopenNewTitle').value.trim();
    if (!newTitle) { NX.toast?.('Need a title', 'error'); return; }
    const newDescription = m.querySelector('#bReopenNewDesc').value.trim();
    const res = await NX.domain.reopenEquipmentIssue({
      issueId: issue.id, mode: 'newProblem', newTitle, newDescription,
    });
    if (!res.ok) { NX.toast?.('Could not create new ticket', 'error'); return; }
    await maybeApplyProposal(res.statusProposal);
    NX.toast?.('New ticket created on board', 'success');
    close();
    // Refresh board so the new card is visible
    try { await loadCards(); render(); } catch (_) {}
  });
}

// Show a confirm() for a domain-proposed equipment.status change.
// If user accepts, calls applyEquipmentStatusChange. The proposal
// object carries equipmentId (set by computeProposedEquipmentStatus).
async function maybeApplyProposal(proposal) {
  if (!proposal || !proposal.equipmentId) return;
  const { suggestedStatus, reason, equipmentName, currentStatus, equipmentId } = proposal;
  const STATUS_LABEL = {
    operational:    'Operational',
    needs_service:  'Needs Service',
    down:           'Down',
  };
  const ok = await nxConfirm(
    `${reason}\n\nCurrently: ${STATUS_LABEL[currentStatus] || currentStatus}`,
    { title: `Mark ${equipmentName} as ${STATUS_LABEL[suggestedStatus] || suggestedStatus}?`, okLabel: 'Update status' }
  );
  if (!ok) return;
  const did = await NX.domain.applyEquipmentStatusChange({
    equipmentId, newStatus: suggestedStatus,
  });
  if (did) NX.toast?.(`${equipmentName}: ${STATUS_LABEL[suggestedStatus]}`, 'success', 1300);
}

// ─── Repair Attempts ──────────────────────────────────────────────────
const DISPATCH_METHOD_ICON = {
  call:      'phone',
  text:      'message-square',
  email:     'mail',
  in_house:  'wrench',
};
const DISPATCH_OUTCOME_LABEL = {
  pending:   'Pending',
  resolved:  'Resolved',
  failed:    'Failed',
  no_answer: 'No answer',
};

async function renderRepairAttempts(card, bg) {
  const sect = bg.querySelector('#bAttemptsSection');
  const host = bg.querySelector('#bAttempts');
  if (!sect || !host) return;
  if (!card.equipment_id) {
    sect.style.display = 'none';
    return;
  }
  sect.style.display = '';
  host.innerHTML = '<div class="b-attempts-loading">Loading attempts…</div>';

  let attempts = [];
  try {
    const { data } = await NX.sb.from('dispatch_events')
      .select('id, equipment_id, contractor_name, contractor_phone, method, issue_description, dispatched_by, outcome, outcome_notes, dispatched_at, responded_at, photo_urls')
      .eq('equipment_id', card.equipment_id)
      .order('dispatched_at', { ascending: false })
      .limit(8);
    attempts = data || [];
  } catch (e) {
    // photo_urls column may not exist yet — retry without
    if (/photo_urls/i.test(e?.message || '')) {
      try {
        const { data } = await NX.sb.from('dispatch_events')
          .select('id, equipment_id, contractor_name, contractor_phone, method, issue_description, dispatched_by, outcome, outcome_notes, dispatched_at, responded_at')
          .eq('equipment_id', card.equipment_id)
          .order('dispatched_at', { ascending: false })
          .limit(8);
        attempts = data || [];
      } catch (_) {}
    } else {
      console.warn('[board] renderRepairAttempts fetch failed:', e?.message || e);
    }
  }

  function rowHtml(a) {
    const icon = DISPATCH_METHOD_ICON[a.method] || 'wrench';
    const when = fmtIssueTs(a.dispatched_at);
    const outcomeKey = a.outcome || 'pending';
    const outcomeLabel = DISPATCH_OUTCOME_LABEL[outcomeKey] || outcomeKey;
    const isOpen = outcomeKey === 'pending';
    const photos = Array.isArray(a.photo_urls) ? a.photo_urls : [];
    return `
      <div class="b-attempt b-attempt-${esc(outcomeKey)}" data-attempt-id="${esc(a.id)}">
        <div class="b-attempt-head">
          <div class="b-attempt-method"><i data-lucide="${icon}" class="badge-icon"></i></div>
          <div class="b-attempt-meta">
            <div class="b-attempt-who">${esc(a.contractor_name || 'Unknown')}</div>
            <div class="b-attempt-when">${esc(when)}${a.dispatched_by ? ' · by ' + esc(a.dispatched_by) : ''}</div>
          </div>
          <div class="b-attempt-outcome b-outcome-${esc(outcomeKey)}">${esc(outcomeLabel)}</div>
        </div>
        ${a.issue_description ? `<div class="b-attempt-issue">${esc(a.issue_description)}</div>` : ''}
        ${a.outcome_notes ? `<div class="b-attempt-notes">${esc(a.outcome_notes)}</div>` : ''}
        ${photos.length ? `<div class="b-attempt-photos">${photos.map(u => `<img class="b-attempt-photo" src="${esc(u)}" onerror="this.style.display='none'">`).join('')}</div>` : ''}
        ${isOpen ? `
          <div class="b-attempt-actions">
            <button class="b-btn b-btn-sm" data-act="resolve">Mark resolved</button>
            <button class="b-btn b-btn-sm b-btn-warn" data-act="fail">Mark failed</button>
          </div>` : ''}
      </div>`;
  }

  function paint() {
    if (!attempts.length) {
      host.innerHTML = '<div class="b-attempts-empty">No attempts logged yet. Tap +Add to log one.</div>';
      return;
    }
    host.innerHTML = attempts.map(rowHtml).join('');
    if (window.lucide) try { lucide.createIcons(); } catch (_) {}

    host.querySelectorAll('.b-attempt').forEach(el => {
      const id = el.getAttribute('data-attempt-id');
      el.querySelector('[data-act="resolve"]')?.addEventListener('click', () => markAttempt(id, 'resolved'));
      el.querySelector('[data-act="fail"]')?.addEventListener('click', () => markAttempt(id, 'failed'));
    });
  }

  async function markAttempt(dispatchEventId, outcome) {
    const note = prompt(outcome === 'failed'
      ? 'What didn\'t work? (notes — optional)'
      : 'Resolution notes? (optional)');
    if (note === null) return;   // user cancelled
    const res = await NX.domain.markAttemptOutcome({
      dispatchEventId, outcome,
      outcomeNotes: note || null,
    });
    if (!res.ok) { NX.toast?.('Could not update attempt', 'error'); return; }
    // Update local list
    const i = attempts.findIndex(a => a.id === dispatchEventId);
    if (i >= 0) attempts[i] = res.dispatchEvent;
    paint();
    if (res.statusProposal) {
      await maybeApplyProposal(res.statusProposal);
    }
  }

  paint();

  // Add-attempt button
  bg.querySelector('#bAddAttempt')?.addEventListener('click', () => openAddAttemptForm(card, attempts, paint));
}

// ─────────────────────────────────────────────────────────────────────────
// UNIFIED PROGRESS TIMELINE (v19)
// One chronological feed of everything that happened to this work item:
// created → calls/dispatches (with photos) → PM & service logs (with photos
// + cost) → equipment status changes → comments. Read-only; the existing
// edit affordances (attempts buttons, comment box) stay where they are. This
// is the "see the full progress, pictures along the way" view.
// ─────────────────────────────────────────────────────────────────────────
async function renderProgressTimeline(card, bg) {
  const sect = bg.querySelector('#bProgressSection');
  const host = bg.querySelector('#bProgress');
  if (!sect || !host) return;

  const eqId = card.equipment_id || null;
  const nodes = [];

  // 0) Created
  nodes.push({
    ts: card.created_at || null,
    icon: 'plus-circle', color: '#9a9081',
    title: 'Created' + (card.reported_by ? ` · ${card.reported_by}` : ''),
    text: card.description || '',
    photos: Array.isArray(card.photo_urls) ? card.photo_urls : [],
  });

  if (eqId) {
    // 1) Calls / dispatches
    try {
      let q = await NX.sb.from('dispatch_events')
        .select('id, method, contractor_name, outcome, outcome_notes, issue_description, dispatched_by, dispatched_at, photo_urls')
        .eq('equipment_id', eqId).order('dispatched_at', { ascending: true }).limit(40);
      if (q.error && /photo_urls/i.test(q.error.message || '')) {
        q = await NX.sb.from('dispatch_events')
          .select('id, method, contractor_name, outcome, outcome_notes, issue_description, dispatched_by, dispatched_at')
          .eq('equipment_id', eqId).order('dispatched_at', { ascending: true }).limit(40);
      }
      (q.data || []).forEach(d => {
        const verb = d.method === 'text' ? 'Texted' : d.method === 'email' ? 'Emailed' : d.method === 'in_house' ? 'In-house' : 'Called';
        const parts = [];
        if (d.issue_description) parts.push(d.issue_description);
        if (d.outcome && d.outcome !== 'pending') parts.push(`Outcome: ${d.outcome}`);
        if (d.outcome_notes) parts.push(d.outcome_notes);
        nodes.push({
          ts: d.dispatched_at, icon: 'phone', color: '#6c7bd0',
          title: `${verb} ${d.contractor_name || 'contractor'}` + (d.dispatched_by ? ` · by ${d.dispatched_by}` : ''),
          text: parts.join(' — '),
          photos: Array.isArray(d.photo_urls) ? d.photo_urls : [],
        });
      });
    } catch (_) {}

    // 2) Service / PM logs (contractor submissions carry photos + invoice)
    try {
      const { data } = await NX.sb.from('pm_logs')
        .select('id, service_type, service_date, work_performed, parts_replaced, cost_amount, contractor_name, review_status, photo_urls, pdf_url')
        .eq('equipment_id', eqId).order('service_date', { ascending: true }).limit(40);
      (data || []).forEach(l => {
        const type = (l.service_type || 'service').replace(/^./, c => c.toUpperCase());
        const bits = [];
        if (l.work_performed) bits.push(l.work_performed);
        if (l.parts_replaced) bits.push('Parts: ' + l.parts_replaced);
        if (l.cost_amount != null && !isNaN(l.cost_amount)) bits.push(`$${Math.round(Number(l.cost_amount)).toLocaleString()}`);
        const status = l.review_status && l.review_status !== 'approved' ? ` · ${l.review_status}` : '';
        nodes.push({
          ts: l.service_date, icon: 'wrench', color: '#6cd09a',
          title: `${type}${l.contractor_name ? ' · ' + l.contractor_name : ''}${status}`,
          text: bits.join(' — '),
          photos: Array.isArray(l.photo_urls) ? l.photo_urls : [],
          invoice: l.pdf_url || null,
        });
      });
    } catch (_) {}

    // 3) Status changes
    try {
      const { data } = await NX.sb.from('equipment_events')
        .select('event_type, payload, occurred_at, actor_name')
        .eq('equipment_id', eqId).eq('event_type', 'status_change')
        .order('occurred_at', { ascending: true }).limit(40);
      (data || []).forEach(ev => {
        const p = ev.payload || {};
        nodes.push({
          ts: ev.occurred_at, icon: 'activity', color: '#d4a44e',
          title: `Status: ${esc(p.from_label || p.from || '?')} → ${esc(p.to_label || p.to || '?')}` + (ev.actor_name ? ` · ${ev.actor_name}` : ''),
          text: '', photos: [],
        });
      });
    } catch (_) {}
  }

  // 4) Comments on the card
  (card.comments || []).forEach(c => {
    nodes.push({
      ts: c.at || null, icon: 'message-square', color: '#9a9081',
      title: `Comment${c.by ? ' · ' + c.by : ''}`,
      text: c.text || '', photos: [],
    });
  });

  const valid = nodes.filter(n => n.title);
  if (valid.length <= 1 && !eqId) { sect.style.display = 'none'; return; }
  sect.style.display = '';

  // Sort oldest→newest; undated created node floats to top.
  valid.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0;
    const tb = b.ts ? new Date(b.ts).getTime() : 0;
    return ta - tb;
  });

  const fmt = (ts) => ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  host.innerHTML = `<div class="b-timeline">${valid.map(n => `
    <div class="b-tl-node">
      <div class="b-tl-rail"><span class="b-tl-dot" style="background:${n.color}"><i data-lucide="${n.icon}"></i></span></div>
      <div class="b-tl-body">
        <div class="b-tl-title">${esc(n.title)}</div>
        ${n.ts ? `<div class="b-tl-when">${esc(fmt(n.ts))}</div>` : ''}
        ${n.text ? `<div class="b-tl-text">${esc(n.text)}</div>` : ''}
        ${n.invoice ? `<a class="b-tl-invoice" href="${esc(n.invoice)}" target="_blank" rel="noopener"><i data-lucide="file-text"></i> View invoice</a>` : ''}
        ${n.photos && n.photos.length ? `<div class="b-tl-photos">${n.photos.map(u => `<img class="b-tl-photo" src="${esc(u)}" loading="lazy" onerror="this.style.display='none'" onclick="window.open('${esc(u)}','_blank')">`).join('')}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;

  // Inject the small stylesheet once.
  if (!document.getElementById('b-timeline-style')) {
    const st = document.createElement('style');
    st.id = 'b-timeline-style';
    st.textContent =
      '.b-timeline{display:flex;flex-direction:column;gap:0}' +
      '.b-tl-node{display:flex;gap:10px;align-items:flex-start}' +
      '.b-tl-rail{display:flex;flex-direction:column;align-items:center;align-self:stretch;flex:0 0 auto}' +
      '.b-tl-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#1a1710;flex:0 0 auto}' +
      '.b-tl-dot i,.b-tl-dot svg{width:14px;height:14px}' +
      '.b-tl-node:not(:last-child) .b-tl-rail::after{content:"";flex:1;width:2px;background:var(--nx-gold-line,rgba(212,164,78,.25));margin:2px 0}' +
      '.b-tl-body{flex:1;min-width:0;padding-bottom:16px}' +
      '.b-tl-title{font-size:13.5px;font-weight:600;color:var(--nx-text,#f3ede1)}' +
      '.b-tl-when{font-size:11px;color:var(--nx-faint,#9a9081);margin-top:1px}' +
      '.b-tl-text{font-size:12.5px;color:var(--nx-muted,#bdb3a2);margin-top:4px;white-space:pre-wrap;word-break:break-word}' +
      '.b-tl-photos{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}' +
      '.b-tl-invoice{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;font-weight:600;color:var(--nx-gold,#d4a44e);text-decoration:none}' +
      '.b-tl-invoice i,.b-tl-invoice svg{width:14px;height:14px}' +
      '.b-tl-photo{width:62px;height:62px;object-fit:cover;border-radius:8px;border:1px solid var(--nx-gold-line,rgba(212,164,78,.25));cursor:pointer}';
    document.head.appendChild(st);
  }
  if (window.lucide) try { lucide.createIcons(); } catch (_) {}
}


function openAddAttemptForm(card, attempts, repaint) {
  const m = document.createElement('div');
  m.className = 'b-modal-bg b-modal-bg-stack';
  m.innerHTML = `
    <div class="b-modal b-modal-narrow">
      <div class="b-modal-head">
        <div class="b-modal-title-static">Log Repair Attempt</div>
        <button class="b-modal-close">✕</button>
      </div>
      <div class="b-modal-body">
        <div class="b-section">
          <div class="b-section-label">Method</div>
          <div class="b-attempt-methods">
            <button class="b-attempt-method-pick" data-method="call">📞 Call</button>
            <button class="b-attempt-method-pick" data-method="text">💬 Text</button>
            <button class="b-attempt-method-pick" data-method="email">✉ Email</button>
            <button class="b-attempt-method-pick is-active" data-method="in_house">🔧 In-house</button>
          </div>
        </div>
        <div class="b-section">
          <div class="b-section-label">Who tried it</div>
          <input class="b-field" id="bAttContractor" placeholder="Name (defaults to you)">
        </div>
        <div class="b-section">
          <div class="b-section-label">What was tried</div>
          <textarea class="b-field" id="bAttIssue" rows="2" placeholder="e.g., replaced capacitor, reset thermostat"></textarea>
        </div>
        <div class="b-section">
          <div class="b-section-label">Notes (optional)</div>
          <textarea class="b-field" id="bAttNotes" rows="2" placeholder="ETA, parts ordered, contractor said..."></textarea>
        </div>
        <button class="b-btn b-btn-primary" id="bAttSubmit" style="width:100%">Log attempt</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('.b-modal-close').addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });

  let pickedMethod = 'in_house';
  m.querySelectorAll('.b-attempt-method-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      m.querySelectorAll('.b-attempt-method-pick').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      pickedMethod = btn.getAttribute('data-method');
    });
  });

  m.querySelector('#bAttSubmit').addEventListener('click', async () => {
    const submit = m.querySelector('#bAttSubmit');
    submit.disabled = true; submit.textContent = 'Logging…';
    try {
      const res = await NX.domain.recordRepairAttempt({
        equipmentId:      card.equipment_id,
        method:           pickedMethod,
        contractorName:   m.querySelector('#bAttContractor').value.trim() || null,
        issueDescription: m.querySelector('#bAttIssue').value.trim() || null,
        notes:            m.querySelector('#bAttNotes').value.trim() || null,
      });
      if (!res.ok) { NX.toast?.('Could not log attempt', 'error'); return; }
      attempts.unshift(res.dispatchEvent);
      repaint();
      NX.toast?.('Attempt logged', 'success', 1100);
      close();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Log attempt';
    }
  });
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
  openCard,
  // also expose loadCards so equipment-integration refreshes correctly
  reload: async () => { await loadCards(); render(); },
};

console.log('[board] v4 loaded — ' + Object.keys(NX.modules.board).length + ' exports');

})();
