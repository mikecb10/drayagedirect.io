-- ============================================================
-- DrayageDirect: Phase 5b-1 Addendum — Load Types Expansion
-- Adds Inbound + Outbound load types, final_delivery_location_id,
-- trailer_id, and seeds inbound/outbound routing templates.
-- ============================================================

-- New columns on orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_delivery_location_id UUID REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trailer_id UUID REFERENCES equipment_trailers(id);

-- Seed additional routing templates for Inbound + Outbound
INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
SELECT * FROM (VALUES
  -- Inbound (intermodal/rail delivery to warehouse)
  ('Inbound + Live',
   'Pull container from rail terminal, deliver live to warehouse, return empty',
   'inbound',
   '[{"type":"pull","label":"Pull from Rail"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Inbound + Drop & Hook',
   'Pull from rail, drop loaded, hook empty, return to rail',
   'inbound',
   '[{"type":"pull","label":"Pull from Rail"},{"type":"drop","label":"Drop Loaded"},{"type":"hook","label":"Hook Empty"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Inbound Prepull + Live',
   'Prepull from rail to yard, deliver live later, return empty',
   'inbound',
   '[{"type":"pull","label":"Pull from Rail"},{"type":"drop","label":"Drop at Yard"},{"type":"hook","label":"Hook from Yard"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),

  -- Outbound (empty pickup → load at warehouse → rail ingate → final destination)
  ('Outbound + Live Load',
   'Pick empty, load live at warehouse, ingate at rail terminal',
   'outbound',
   '[{"type":"pull","label":"Pickup Empty"},{"type":"deliver","label":"Live Load at Warehouse"},{"type":"return","label":"Ingate at Rail"}]'::jsonb,
   true),
  ('Outbound + Drop & Hook',
   'Pick empty, drop at warehouse, hook loaded, ingate at rail',
   'outbound',
   '[{"type":"pull","label":"Pickup Empty"},{"type":"drop","label":"Drop Empty at Warehouse"},{"type":"hook","label":"Hook Loaded"},{"type":"return","label":"Ingate at Rail"}]'::jsonb,
   true),
  ('Outbound Prepull Empty',
   'Pre-position empty at warehouse, return later for loaded ingate',
   'outbound',
   '[{"type":"pull","label":"Pickup Empty"},{"type":"drop","label":"Drop Empty"},{"type":"hook","label":"Hook Loaded"},{"type":"return","label":"Ingate at Rail"}]'::jsonb,
   true)
) AS t(name, description, load_type, event_sequence, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM routing_templates WHERE is_system = true AND routing_templates.name = t.name
);
