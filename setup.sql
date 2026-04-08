-- ═══════════════════════════════════════════
-- NEXUS — Supabase Schema Setup
-- Run this ONCE in SQL Editor
-- ═══════════════════════════════════════════

-- 1. Knowledge Nodes
create table if not exists nodes (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null default 'equipment',
  tags text[] default '{}',
  notes text default '',
  links bigint[] default '{}',
  is_private boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Daily Logs
create table if not exists daily_logs (
  id bigint generated always as identity primary key,
  entry text not null,
  location text default 'all',
  logged_by text default 'team',
  created_at timestamptz default now()
);

-- 3. Cleaning Logs
create table if not exists cleaning_logs (
  id bigint generated always as identity primary key,
  location text not null,
  log_date date not null default current_date,
  task_index int not null,
  section text default '',
  done boolean default false,
  completed_at timestamptz,
  completed_by text default '',
  unique(location, log_date, task_index, section)
);

-- 4. Chat History (public AI Q&A)
create table if not exists chat_history (
  id bigint generated always as identity primary key,
  question text not null,
  answer text not null,
  asked_by text default 'team',
  created_at timestamptz default now()
);

-- 5. Kanban Cards
create table if not exists kanban_cards (
  id bigint generated always as identity primary key,
  title text not null,
  description text default '',
  column_name text default 'todo',
  location text default 'all',
  priority text default 'normal',
  assigned_to text default '',
  due_date date,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. Private emails (admin only)
create table if not exists emails (
  id bigint generated always as identity primary key,
  subject text,
  sender text,
  body text,
  extracted_nodes bigint[] default '{}',
  is_processed boolean default false,
  received_at timestamptz,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════

alter table nodes enable row level security;
alter table daily_logs enable row level security;
alter table cleaning_logs enable row level security;
alter table chat_history enable row level security;
alter table kanban_cards enable row level security;
alter table emails enable row level security;

-- Public read for non-private nodes
create policy "Public read nodes" on nodes for select using (is_private = false);
create policy "Admin all nodes" on nodes for all using (true);

-- Public read+write for logs and cleaning
create policy "Public read logs" on daily_logs for select using (true);
create policy "Public insert logs" on daily_logs for insert with check (true);

create policy "Public read cleaning" on cleaning_logs for select using (true);
create policy "Public write cleaning" on cleaning_logs for insert with check (true);
create policy "Public update cleaning" on cleaning_logs for update using (true);

-- Public read chat, insert
create policy "Public read chat" on chat_history for select using (true);
create policy "Public insert chat" on chat_history for insert with check (true);

-- Public read+write kanban
create policy "Public read kanban" on kanban_cards for select using (true);
create policy "Public write kanban" on kanban_cards for insert with check (true);
create policy "Public update kanban" on kanban_cards for update using (true);
create policy "Public delete kanban" on kanban_cards for delete using (true);

-- Emails: admin only (via service key, not anon)
create policy "No public emails" on emails for select using (false);

-- ═══════════════════════════════════════════
-- Seed Knowledge Nodes
-- ═══════════════════════════════════════════

insert into nodes (name, category, tags, notes, links) values
('Suerte', 'location', '{restaurant,austin,kitchen,bar,patio}', 'Primary location. Full kitchen, bar, patio.', '{4,5,8}'),
('Este', 'location', '{restaurant,austin,irrigation}', 'Restaurant location. Irrigation zone diagram Project No. 19-320.', '{8,12}'),
('Toti', 'location', '{restaurant,austin}', 'Third restaurant location.', '{8}'),
('Hoshizaki Ice Machine', 'equipment', '{ice,hoshizaki,auger,commercial}', 'Auger type commercial ice machine. Common failure: harvest assist spring. Check evaporator coil freeze pattern.', '{1,6}'),
('Oven Repair Protocol', 'procedure', '{oven,repair,troubleshoot,kitchen}', 'Diagnostic flow: 1) Igniter — check glow, measure resistance. 2) Gas valve — verify voltage when igniter hot. 3) Thermostat — calibration check. 4) Control board — last resort, check for burn marks.', '{1}'),
('Ice Machine Troubleshoot', 'procedure', '{ice,troubleshoot,hoshizaki,auger}', 'No ice flow: 1) Water supply — verify line open, filter clean. 2) Inlet valve — listen for fill, check solenoid. 3) Evaporator temp — should reach freeze temp. 4) Auger motor — verify rotation, check capacitor. 5) Harvest assist spring — common failure.', '{4}'),
('Z260 Zero-Turn', 'equipment', '{mower,zero-turn,z260,kawasaki}', 'Zero-turn mower with Kawasaki FS730V engine. Sat unused — needs full service. OEM parts preferred.', '{9}'),
('Cleaning Checklists', 'procedure', '{cleaning,checklist,bilingual,spanish,daily}', 'Bilingual EN/ES cleaning checklists for all 3 locations. Categories: Daily, Bi-Weekly, Monthly, Quarterly, 6-Month, Landscaping. Print-ready PDFs and interactive HTML app.', '{1,2,3}'),
('Kawasaki FS730V', 'parts', '{engine,kawasaki,v-twin}', 'V-twin engine on Z260 zero-turn. Common issue: fuel pump diaphragm. OEM parts, Amazon Prime shipping.', '{7}'),
('F-150 2.7L EcoBoost', 'equipment', '{ford,f150,ecoboost,truck,spark-plug}', '2016 Ford F-150 2.7L EcoBoost twin-turbo V6. Check spark plug spec and interval.', '{}'),
('Craftsman Smart Charger', 'equipment', '{charger,battery,craftsman,diagnostics}', 'Multi-mode battery charger/maintainer. Used for vehicle battery troubleshooting.', '{}'),
('Irrigation Zones - Este', 'procedure', '{irrigation,zones,landscape,este}', 'Project No. 19-320 landscape architecture drawings. Interactive HTML version built from source drawings.', '{2}'),
('Ruskin CBD-150 Damper', 'equipment', '{damper,ruskin,backdraft,hvac}', 'Backdraft damper. Check blade linkage and actuator.', '{}'),
('Echo PE-225 Edger', 'equipment', '{echo,edger,2-stroke}', '2-stroke edger with diaphragm carburetor. Common issues: fuel lines deteriorate, primer bulb cracks. Sat unused.', '{}'),
('Troy-Bilt GCV170A', 'equipment', '{troy-bilt,honda,mower,auto-choke}', 'Honda GCV170A engine with auto-choke system. Sat unused — needs inspection.', '{}'),
('Honda GX120', 'equipment', '{honda,engine,small-engine,pressure-washer}', 'Pressure washer engine. Common issue: carburetor fouling.', '{}'),
('Weekend On-Call Rates', 'procedure', '{rates,service,weekend,on-call,contractors}', 'Rate structure for weekend/holiday equipment repair service calls.', '{}');
