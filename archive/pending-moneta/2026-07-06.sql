-- PENDING MONETA MINT — written 2026-07-06 by a session whose environment
-- blocked outbound Supabase (remote sandbox network policy; proxy 403 on
-- oprsthfxqrdbwdvommpw.supabase.co). Next session with DB access: run this,
-- then delete this file and re-press the vault. What is committed outlasts
-- the database — this is the committed half; make it the remembered half.

insert into nodes (name, category, tags, notes, links)
values (
  'Moneta · 2026-07-06 — ResQ bridged, not fought',
  'moneta',
  '["moneta","claude"]'::jsonb,
  'Alfredo opened with "ResQ is one of the dumbest softwares — can we add vendors without emailing them," then the real correction: NEXUS is fine, he BUILT it to replace ResQ, but management mandates ResQ. Strategy he approved by asking for it: a guide plus a bridge, not a fight. SHIPPED: (1) RESQ-PLAYBOOK.md at repo root — the full strategy: ResQ is the reporting surface, NEXUS the source of truth; CSM email template; widget ladder (Level 1 = parse ResQ notification emails into a home widget, buildable on his word; Level 2 = enterprise API, let management request it). (2) Vendors screen ResQ bridge in js/vendors.js: masthead "→ ResQ" exports all active vendors as one CSV for bulk CSM onboarding (toast counts vendors missing email); "⧉ ResQ" on detail header + "Copy for ResQ" in row kebab copies a clipboard packet matching the Invite Your Own Vendor form. NXVendors.exportResQ / .copyResQPacket. Mirrors equipment''s v18.32 exports. STILL TRUE: R4, Red Bud, Maccinisti, HOODZ, Austin Industrial Refrigeration have no email on file — ResQ cannot invite them; the export flags them. LEARNED: this remote environment blocks Supabase AND getresq.com (their site 403s all non-browser traffic — playbook claims about the invite flow are flagged for CSM verification). Tone note: he vents about tools, not people — answer the vent with something shipped.',
  '[]'::jsonb
);
