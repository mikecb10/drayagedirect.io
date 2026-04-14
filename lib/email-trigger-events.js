/**
 * Email Trigger Catalogs
 *
 * Single source of truth for the 4 trigger kinds supported by the
 * drayage-specific trigger model:
 *
 *   1. FIELD_CHANGE — "WHEN [field] IS [Added / Removed / Updated]"
 *                     Watches a specific column on the load row.
 *   2. NOTIFICATION — "WHEN [boolean flag] IS TRUE"
 *                     Fires when a flag flips true.
 *   3. EVENT        — "WHEN [composite drayage event] IS <sub-conditions>"
 *                     Named drayage events with per-event condition forms.
 *   4. STATUS       — "WHEN [Load Status] IS <value> AND NOTIFY AFTER <d/h/m>"
 *                     Fires N time units after a specific status transition.
 *
 * ## Storage mapping
 *
 *   email_template_triggers.trigger_kind → 'field_change' | 'notification' | 'event' | 'status'
 *   email_template_triggers.event_name   → one of the keys below (field name,
 *                                           notification key, event key, or
 *                                           status slug)
 *   email_template_triggers.conditions   → JSONB holding the sub-form values
 *                                           per each trigger's conditionSchema
 *
 * The poll_anchor / poll_delay_* columns from migration 052 remain unused by
 * this model — all timing info goes into conditions JSONB so composite
 * events can carry multiple timing fields (NOTIFY_AFTER + NOTIFY_BEFORE + etc.)
 * in a single row.
 */

// ──────────────────────────────────────────────────────────────
// Trigger kinds (the top-level enum stored in trigger_kind column)
// ──────────────────────────────────────────────────────────────
export const TRIGGER_KINDS = [
  {
    value: 'field_change',
    label: 'Field Change',
    description:
      'Fires when a watched field on the load is Added, Removed, or Updated.',
  },
  {
    value: 'notification',
    label: 'Notification',
    description:
      'Fires when a dispatcher marks a boolean notification flag as true (Ready to Return, Load Empty, etc.).',
  },
  {
    value: 'event',
    label: 'Event',
    description:
      'Named drayage events with rich sub-conditions (Approaching Demurrage, Behind Schedule, Missing Information, etc.).',
  },
  {
    value: 'status',
    label: 'Load Status',
    description:
      'Fires a fixed amount of time after the load transitions to a specific status (e.g. "30 minutes after Dispatched").',
  },
];

// ──────────────────────────────────────────────────────────────
// 1) FIELD_CHANGE triggers
//    event_name = the field key
//    conditions.change_type = 'added' | 'removed' | 'updated'
//    (POD uniquely carries conditions.validation_gate as an extra)
// ──────────────────────────────────────────────────────────────
export const FIELD_CHANGE_TRIGGERS = [
  {
    key: 'container_number',
    label: 'Container Number',
    description: 'The ISO container number on the load.',
  },
  {
    key: 'cutoff_date',
    label: 'Cut Off Date',
    description: 'The export cutoff date set by the SSL.',
  },
  {
    key: 'delivery_appointment',
    label: 'Delivery Appointment',
    description: 'The scheduled delivery appointment date/time.',
  },
  {
    key: 'empty_return_date',
    label: 'Empty Return Date',
    description:
      'The date the empty container was returned. Derived from the return event arrived_at timestamp.',
  },
  {
    key: 'last_free_day',
    label: 'Last Free Day',
    description: 'The last free day at the terminal before per diem accrues.',
  },
  {
    key: 'master_bill_of_lading',
    label: 'Master Bill of Lading',
    description: 'The master BL number.',
  },
  {
    key: 'pickup_appointment',
    label: 'Pick Up Appointment',
    description: 'The scheduled pickup appointment date/time.',
  },
  {
    key: 'pod',
    label: 'POD',
    description:
      'Proof of delivery document. Has an extra "validation_gate" option: fire at upload OR after the document validation workflow confirms the POD is good.',
    hasPodValidationGate: true,
  },
  {
    key: 'return_appointment',
    label: 'Return Appointment',
    description: 'The scheduled return appointment date/time.',
  },
  {
    key: 'seal_number',
    label: 'Seal Number',
    description: 'The seal number on the container.',
  },
  {
    key: 'total_weight',
    label: 'Total Weight',
    description: 'The total load weight in lbs.',
  },
];

export const FIELD_CHANGE_TYPES = [
  { value: 'added', label: 'Added' },
  { value: 'removed', label: 'Removed' },
  { value: 'updated', label: 'Updated' },
];

// POD-specific option: when should the trigger actually fire relative to
// document validation?
export const POD_VALIDATION_GATES = [
  {
    value: 'at_upload',
    label: 'At upload — fire the moment the POD is uploaded',
  },
  {
    value: 'after_validation',
    label:
      'After validation — wait until the document validation workflow marks it good',
  },
];

// ──────────────────────────────────────────────────────────────
// 2) NOTIFICATION triggers (boolean TRUE flags)
//    event_name = the notification key
//    conditions = {} (no sub-form)
// ──────────────────────────────────────────────────────────────
export const NOTIFICATION_TRIGGERS = [
  {
    key: 'document_validation',
    label: 'Document Validation Notification',
    description:
      'Fires when the document validation workflow marks a document as passed/good (gated to specific document types later in the doc validation config).',
  },
  {
    key: 'load_empty',
    label: 'Load Empty Notification',
    description: 'Fires when the load is marked as empty.',
  },
  {
    key: 'ready_to_return',
    label: 'Ready to Return',
    description:
      'Fires when a dispatcher explicitly marks the load as ready for return.',
  },
];

// ──────────────────────────────────────────────────────────────
// 3) COMPOSITE EVENT triggers (named drayage events)
//    Each event has its own conditionSchema describing the sub-form.
//    conditionSchema.fields = array of { key, type, label, options?, help? }
//
//    Supported field types for conditionSchema:
//      'duration'        — { days, hours, minutes } input
//      'duration_preset' — pick from the options array (e.g. today/tomorrow)
//      'status_picker'   — pick one of LOAD_STATUSES
//      'multi_select'    — pick any subset of the options array
// ──────────────────────────────────────────────────────────────
export const COMPOSITE_EVENT_TRIGGERS = [
  {
    key: 'actively_in_waiting',
    label: 'Actively In Waiting',
    description: 'Fires while a load has been actively waiting for a duration.',
    conditionSchema: {
      fields: [
        {
          key: 'duration',
          type: 'duration',
          label: 'Duration',
          help: 'How long the load must have been in the "waiting" state before this trigger fires.',
        },
      ],
    },
  },
  {
    key: 'approaching_demurrage',
    label: 'Approaching Demurrage',
    description:
      'Fires as a container nears its demurrage window at the destination terminal.',
    conditionSchema: {
      fields: [
        {
          key: 'duration',
          type: 'duration_preset',
          label: 'Duration',
          options: [
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
            { value: 'yesterday', label: 'Yesterday' },
          ],
        },
        {
          key: 'notify_after',
          type: 'duration',
          label: 'Notify After',
          help: 'How long after demurrage begins to wait before sending.',
        },
        {
          key: 'notify_before',
          type: 'duration',
          label: 'Notify Before',
          help: 'How long before demurrage starts to send the warning.',
        },
      ],
    },
  },
  {
    key: 'approaching_per_diem',
    label: 'Approaching Per Diem',
    description:
      'Fires as the last free day approaches and per diem charges are imminent.',
    conditionSchema: {
      fields: [
        {
          key: 'duration',
          type: 'duration_preset',
          label: 'Duration',
          options: [
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
            { value: 'yesterday', label: 'Yesterday' },
          ],
        },
        {
          key: 'notify_after',
          type: 'duration',
          label: 'Notify After',
        },
        {
          key: 'notify_before',
          type: 'duration',
          label: 'Notify Before',
        },
      ],
    },
  },
  {
    key: 'behind_schedule',
    label: 'Behind Schedule',
    description:
      'Fires when GPS/ELD telemetry indicates the driver will miss a scheduled appointment by more than the configured delta.',
    conditionSchema: {
      fields: [
        {
          key: 'behind_by',
          type: 'duration',
          label: 'Behind By',
          help: 'How far behind schedule the load must be before this fires.',
        },
        {
          key: 'duration',
          type: 'duration',
          label: 'Duration',
          help: 'How long it must have been behind schedule continuously before firing.',
        },
      ],
    },
  },
  {
    key: 'charge_set_updated',
    label: 'Charge Set Updated',
    description:
      'Fires when a charge set on the load is modified (line items added, removed, or rates changed).',
    conditionSchema: {
      fields: [
        {
          key: 'duration',
          type: 'duration_preset',
          label: 'Duration',
          options: [
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
            { value: 'yesterday', label: 'Yesterday' },
          ],
        },
        {
          key: 'notify_after',
          type: 'duration',
          label: 'Notify After',
        },
        {
          key: 'notify_before',
          type: 'duration',
          label: 'Notify Before',
        },
      ],
    },
  },
  {
    key: 'load_created',
    label: 'Load Created',
    description: 'Fires the instant a load is created in the system.',
    conditionSchema: { fields: [] },
  },
  {
    key: 'missing_information',
    label: 'Missing Information',
    description:
      'Fires when a load reaches a specific status but is still missing required fields. Layered: pick the status, wait N time, specify which fields count as missing.',
    conditionSchema: {
      fields: [
        {
          key: 'load_status',
          type: 'status_picker',
          label: 'When Load Status is',
          help: 'The status the load must be in for this trigger to apply.',
        },
        {
          key: 'notify_after',
          type: 'duration',
          label: 'Notify After',
          help: 'How long the load must sit in this status before firing.',
        },
        {
          key: 'applicable_fields',
          type: 'multi_select',
          label: 'Applicable Fields',
          help: 'Any of these fields being empty counts as "missing information".',
          // Options come from MISSING_INFO_APPLICABLE_FIELDS below
          optionsRef: 'MISSING_INFO_APPLICABLE_FIELDS',
        },
      ],
    },
  },
];

// ──────────────────────────────────────────────────────────────
// 4) LOAD STATUS triggers (simple status + NOTIFY AFTER)
//    event_name = the status slug
//    conditions = { notify_after: { days, hours, minutes } }
// ──────────────────────────────────────────────────────────────
export const LOAD_STATUSES = [
  // ── Load lifecycle statuses ──
  { value: 'pending', label: 'Pending', group: 'Load Status' },
  { value: 'available', label: 'Available', group: 'Load Status' },
  { value: 'dispatched', label: 'Dispatched', group: 'Load Status' },
  { value: 'in_transit', label: 'In Transit', group: 'Load Status' },
  { value: 'dropped', label: 'Dropped', group: 'Load Status' },
  { value: 'delivered', label: 'Delivered', group: 'Load Status' },
  { value: 'pending_completion', label: 'Pending Completion', group: 'Load Status' },
  { value: 'completed', label: 'Completed', group: 'Load Status' },

  // ── Pull / Pickup (getting the container from terminal) ──
  { value: 'arrived_at_pick_container', label: 'Arrived at Pick Container', group: 'Pickup' },
  { value: 'departed_pick_container', label: 'Departed Pick Container (container picked up)', group: 'Pickup' },

  // ── Deliver (bringing container to customer) ──
  { value: 'enroute_to_deliver_load', label: 'Enroute to Deliver Load', group: 'Delivery' },
  { value: 'arrived_at_deliver_load', label: 'Arrived at Deliver Load', group: 'Delivery' },
  { value: 'departed_deliver_load', label: 'Departed Deliver Load (delivery complete)', group: 'Delivery' },

  // ── Drop / Hook (yard or intermediate location) ──
  { value: 'arrived_at_drop_container', label: 'Arrived at Drop Location', group: 'Drop & Hook' },
  { value: 'departed_drop_container', label: 'Departed Drop Location (container dropped)', group: 'Drop & Hook' },
  { value: 'arrived_to_hook_container', label: 'Arrived to Hook Container', group: 'Drop & Hook' },
  { value: 'departed_hook_container', label: 'Departed Hook Location (container hooked)', group: 'Drop & Hook' },

  // ── Return (bringing empty back to terminal) ──
  { value: 'enroute_to_return_load', label: 'Enroute to Return Empty', group: 'Return' },
  { value: 'arrived_at_return_load', label: 'Arrived at Return Terminal', group: 'Return' },
  { value: 'departed_return_load', label: 'Departed Return Terminal (empty returned)', group: 'Return' },

  // ── Chassis operations ──
  { value: 'arrived_to_chassis', label: 'Arrived to Chassis', group: 'Chassis' },
  { value: 'departed_chassis', label: 'Departed Chassis Location', group: 'Chassis' },
  { value: 'arrived_to_return_chassis', label: 'Arrived to Return Chassis', group: 'Chassis' },
  { value: 'departed_return_chassis', label: 'Departed Return Chassis', group: 'Chassis' },

  // ── Other stops ──
  { value: 'arrived_at_stop_off', label: 'Arrived at Stop Off', group: 'Other' },
  { value: 'departed_stop_off', label: 'Departed Stop Off', group: 'Other' },
  { value: 'enroute_to_pick_container', label: 'Enroute to Pick Container', group: 'Pickup' },
  { value: 'enroute_to_hook_container', label: 'Enroute to Hook Container', group: 'Drop & Hook' },
  { value: 'enroute_to_chassis', label: 'Enroute to Chassis', group: 'Chassis' },
  { value: 'enroute_to_return_chassis', label: 'Enroute to Return Chassis', group: 'Chassis' },
  { value: 'enroute_to_stop_off', label: 'Enroute to Stop Off', group: 'Other' },
];

// ──────────────────────────────────────────────────────────────
// Missing Information — applicable fields catalog
// ──────────────────────────────────────────────────────────────
export const MISSING_INFO_APPLICABLE_FIELDS = [
  { value: 'vessel_eta', label: 'Vessel ETA' },
  { value: 'last_free_day', label: 'Last Free Day' },
  { value: 'discharged_date', label: 'Discharged Date' },
  { value: 'outgate_date', label: 'Outgate Date' },
  { value: 'empty_date', label: 'Empty Date' },
  { value: 'return_date', label: 'Return Date' },
  { value: 'ingate_date', label: 'Ingate Date' },
  { value: 'container_number', label: 'Container #' },
  { value: 'container_size', label: 'Container Size' },
  { value: 'container_type', label: 'Container Type' },
  { value: 'steamship_line', label: 'Steamship Line' },
  { value: 'chassis_number', label: 'Chassis #' },
  { value: 'chassis_size', label: 'Chassis Size' },
  { value: 'chassis_type', label: 'Chassis Type' },
  { value: 'chassis_owner', label: 'Chassis Owner' },
  { value: 'genset_number', label: 'Genset #' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'master_bill_of_lading', label: 'Master Bill of Lading' },
  { value: 'house_bill_of_lading', label: 'House Bill of Lading' },
  { value: 'seal_number', label: 'Seal #' },
  { value: 'reference_number', label: 'Reference #' },
  { value: 'vessel_name', label: 'Vessel Name' },
  { value: 'voyage', label: 'Voyage' },
  { value: 'purchase_order_number', label: 'Purchase Order #' },
  { value: 'pickup_number', label: 'Pick Up #' },
  { value: 'appointment_number', label: 'Appointment #' },
  { value: 'return_number', label: 'Return #' },
  { value: 'reservation_number', label: 'Reservation #' },
  { value: 'gray_container_number', label: 'Gray Container #' },
  { value: 'gray_container_size', label: 'Gray Container Size' },
  { value: 'gray_container_type', label: 'Gray Container Type' },
  { value: 'gray_chassis_number', label: 'Gray Chassis #' },
  { value: 'gray_chassis_size', label: 'Gray Chassis Size' },
  { value: 'gray_chassis_type', label: 'Gray Chassis Type' },
  { value: 'gray_chassis_owner', label: 'Gray Chassis Owner' },
  { value: 'erd', label: 'ERD' },
  { value: 'cutoff', label: 'Cutoff' },
  { value: 'return_location', label: 'Return Location' },
  { value: 'scac', label: 'SCAC' },
  { value: 'booking_number', label: 'Booking #' },
  { value: 'hook_chassis_location', label: 'Hook Chassis Location' },
  { value: 'terminate_chassis_location', label: 'Terminate Chassis Location' },
  { value: 'freight_hold', label: 'Freight Hold' },
  { value: 'customs_hold', label: 'Customs Hold' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'trailer_type', label: 'Trailer Type' },
  { value: 'trailer_size', label: 'Trailer Size' },
];

// ──────────────────────────────────────────────────────────────
// Dedupe window presets (unchanged from prior version — still used)
// ──────────────────────────────────────────────────────────────
export const DEDUPE_PRESETS = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 21600, label: '6 hours' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
];

// ──────────────────────────────────────────────────────────────
// Lookups
// ──────────────────────────────────────────────────────────────
export function getFieldChangeByKey(key) {
  return FIELD_CHANGE_TRIGGERS.find((t) => t.key === key) || null;
}

export function getNotificationByKey(key) {
  return NOTIFICATION_TRIGGERS.find((t) => t.key === key) || null;
}

export function getCompositeEventByKey(key) {
  return COMPOSITE_EVENT_TRIGGERS.find((t) => t.key === key) || null;
}

export function getLoadStatusByValue(value) {
  return LOAD_STATUSES.find((s) => s.value === value) || null;
}

export function getFieldChangeTypeByValue(value) {
  return FIELD_CHANGE_TYPES.find((t) => t.value === value) || null;
}

/**
 * Resolve the options array for a conditionSchema field.
 * Supports inline options OR optionsRef pointing at a named catalog.
 */
export function resolveOptions(field) {
  if (Array.isArray(field.options)) return field.options;
  if (field.optionsRef === 'MISSING_INFO_APPLICABLE_FIELDS') {
    return MISSING_INFO_APPLICABLE_FIELDS;
  }
  return [];
}

// ──────────────────────────────────────────────────────────────
// Duration helpers — the conditions JSONB stores durations as
// { days, hours, minutes } objects so the UI form round-trips cleanly.
// ──────────────────────────────────────────────────────────────
export function emptyDuration() {
  return { days: 0, hours: 0, minutes: 0 };
}

export function formatDuration(d) {
  if (!d || typeof d !== 'object') return '0 minutes';
  const parts = [];
  if (d.days) parts.push(`${d.days}d`);
  if (d.hours) parts.push(`${d.hours}h`);
  if (d.minutes) parts.push(`${d.minutes}m`);
  return parts.length > 0 ? parts.join(' ') : '0m';
}

export function isValidDuration(d) {
  if (!d || typeof d !== 'object') return false;
  const nums = [d.days, d.hours, d.minutes];
  return nums.every((n) => Number.isFinite(n) && n >= 0);
}

// ──────────────────────────────────────────────────────────────
// summarizeTrigger — human-readable row summary for the trigger list
// ──────────────────────────────────────────────────────────────
export function summarizeTrigger(trigger) {
  if (!trigger) return '';
  const kind = trigger.trigger_kind;

  if (kind === 'field_change') {
    const field = getFieldChangeByKey(trigger.event_name);
    const changeType = trigger.conditions?.change_type || 'updated';
    const typeLabel =
      getFieldChangeTypeByValue(changeType)?.label || changeType;
    const base = `Fires when ${field?.label || trigger.event_name} is ${typeLabel}`;
    if (field?.hasPodValidationGate && trigger.conditions?.validation_gate) {
      const gate = POD_VALIDATION_GATES.find(
        (g) => g.value === trigger.conditions.validation_gate
      );
      return `${base} (${gate?.label?.split(' — ')[0] || trigger.conditions.validation_gate})`;
    }
    return base;
  }

  if (kind === 'notification') {
    const notif = getNotificationByKey(trigger.event_name);
    return `Fires when ${notif?.label || trigger.event_name} is true`;
  }

  if (kind === 'event') {
    const evt = getCompositeEventByKey(trigger.event_name);
    if (!evt) return `Fires on ${trigger.event_name}`;
    const parts = [`Fires on ${evt.label}`];
    const cond = trigger.conditions || {};
    // Summarize the key sub-conditions compactly
    if (cond.duration && typeof cond.duration === 'object') {
      parts.push(`duration ${formatDuration(cond.duration)}`);
    }
    if (typeof cond.duration === 'string') {
      parts.push(`on ${cond.duration}`);
    }
    if (cond.notify_after && isValidDuration(cond.notify_after)) {
      parts.push(`notify after ${formatDuration(cond.notify_after)}`);
    }
    if (cond.notify_before && isValidDuration(cond.notify_before)) {
      parts.push(`notify before ${formatDuration(cond.notify_before)}`);
    }
    if (cond.behind_by && isValidDuration(cond.behind_by)) {
      parts.push(`behind by ${formatDuration(cond.behind_by)}`);
    }
    if (cond.load_status) {
      const st = getLoadStatusByValue(cond.load_status);
      parts.push(`status: ${st?.label || cond.load_status}`);
    }
    if (Array.isArray(cond.applicable_fields) && cond.applicable_fields.length > 0) {
      parts.push(`${cond.applicable_fields.length} field(s)`);
    }
    return parts.join(' · ');
  }

  if (kind === 'status') {
    const status = getLoadStatusByValue(trigger.event_name);
    const after = trigger.conditions?.notify_after;
    const afterStr = isValidDuration(after) ? formatDuration(after) : '0m';
    return `Fires ${afterStr} after Load Status = ${status?.label || trigger.event_name}`;
  }

  return '';
}
