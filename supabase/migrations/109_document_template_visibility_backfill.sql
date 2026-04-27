-- 109_document_template_visibility_backfill.sql
-- Translates document_templates.section_config from the FU-035-B flat shape
-- (visibility keyed by old section IDs: bill_to, equipment_details, ...)
-- to the FU-035-D hierarchical shape (parent + perSection.fields children).
--
-- Idempotent: rows already migrated (perSection.order_details present) are skipped.
-- Drops: customer_contact + driver_per_move toggle intent (subsumed into new sections).

BEGIN;

UPDATE document_templates
SET section_config = jsonb_build_object(
  'visibility', jsonb_build_object(
    'header',                  true,
    'delivery_order_details',  true,
    'address_details',         COALESCE((section_config->'visibility'->>'bill_to')::boolean,            true),
    'move_events',             COALESCE((section_config->'visibility'->>'move_block')::boolean,         true),
    'order_details',           CASE
                                  WHEN COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true) = false
                                   AND COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true) = false
                                   AND COALESCE((section_config->'visibility'->>'hazmat_details')::boolean,      true) = false
                                  THEN false ELSE true
                                END,
    'commodity_details',       false,
    'notes',                   COALESCE((section_config->'visibility'->>'instructions')::boolean,       true),
    'signature',               COALESCE((section_config->'visibility'->>'signature_block')::boolean,    false),
    'disclaimer',              false,
    'barcode',                 COALESCE((section_config->'visibility'->>'barcode')::boolean,            false),
    'footer',                  true
  ),
  'perSection', jsonb_build_object(
    -- Rename old perSection.move_block → new perSection.move_events.
    'move_events', COALESCE(
      section_config->'perSection'->'move_events',
      section_config->'perSection'->'move_block',
      '{}'::jsonb
    ),
    'address_details', jsonb_build_object('fields', jsonb_build_object(
      'customer', COALESCE((section_config->'visibility'->>'bill_to')::boolean, true)
    )),
    'order_details', jsonb_build_object('fields', jsonb_build_object(
      'container_number',     COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'container_size',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'container_type',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_number',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_size',         COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_type',         COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_owner',        COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'seal',                 COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'hazmat',               COALESCE((section_config->'visibility'->>'hazmat_details')::boolean,      true),
      'pickup_appointment',   COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'delivery_appointment', COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'last_free_day',        COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'per_diem_free_day',    COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true)
    )),
    'notes', jsonb_build_object('fields', jsonb_build_object(
      'driver_notes',   COALESCE((section_config->'visibility'->>'instructions')::boolean, true),
      'yard_notes',     COALESCE((section_config->'visibility'->>'instructions')::boolean, true),
      'customer_notes', COALESCE((section_config->'visibility'->>'instructions')::boolean, true)
    ))
  )
)
WHERE section_config IS NOT NULL
  AND section_config != '{}'::jsonb
  AND NOT (section_config ? 'perSection' AND section_config->'perSection' ? 'order_details');

NOTIFY pgrst, 'reload schema';

COMMIT;
