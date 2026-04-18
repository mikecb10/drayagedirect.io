/**
 * Email Dispatcher — the trigger runtime orchestrator
 *
 * Single entry point: `fireTrigger(svc, {tenantId, triggerId, loadId,
 * fireKey, userId, eventName})`
 *
 * Pipeline:
 *   1. Load trigger + template (skip if disabled)
 *   2. Dedupe check against email_trigger_log
 *   3. Hydrate trigger context from the load
 *   4. Resolve matching umbrellas (winners + always_run)
 *   5. For each umbrella: find owning configuration, find matching groups,
 *      expand recipients, resolve template, call provider adapter, record
 *      message_id in umbrella_decisions
 *   6. Write email_trigger_log row with full decision snapshot
 *
 * Each per-umbrella block is wrapped in its own try/catch so one failure
 * never prevents sibling umbrellas from firing.
 */

import { resolveEmailTemplate } from '../email-variable-resolver.js';
import {
  resolveMatchingUmbrellas,
  dedupeUmbrellasById,
} from './umbrella-matcher.js';
import { expandGroupRecipients } from './recipient-expander.js';
import { buildTriggerContext } from './context-builder.js';
import { getProvider } from './providers/index.js';
import { fetchFullConfiguration } from '../email-configuration-helpers.js';

/**
 * Main entrypoint.
 *
 * @param svc  service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   triggerId: string,
 *   loadId: string,
 *   fireKey: string,
 *   userId?: string | null,
 *   eventName?: string,
 * }} params
 * @returns {Promise<{
 *   outcome: 'fired'|'skipped'|'deduped'|'errored'|'disabled',
 *   messagesCreated: number,
 *   umbrellaDecisions: object[],
 *   logId: string | null,
 *   error: string | null
 * }>}
 */
export async function fireTrigger(svc, params) {
  const { tenantId, triggerId, loadId, fireKey, userId, eventName } = params;

  if (!tenantId || !triggerId || !loadId || !fireKey) {
    throw new Error('fireTrigger: tenantId, triggerId, loadId, fireKey are required');
  }

  // ── Step 1: Load trigger + template ──
  const { data: trigger, error: triggerErr } = await svc
    .from('email_template_triggers')
    .select('*, template:email_templates(*)')
    .eq('id', triggerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (triggerErr) {
    return finalizeErrored(svc, {
      tenantId,
      triggerId,
      templateId: null,
      loadId,
      eventName: eventName || 'unknown',
      fireKey,
      error: `trigger fetch: ${triggerErr.message}`,
    });
  }

  if (!trigger) {
    return finalizeErrored(svc, {
      tenantId,
      triggerId,
      templateId: null,
      loadId,
      eventName: eventName || 'unknown',
      fireKey,
      error: 'trigger not found',
    });
  }

  const template = trigger.template;
  const resolvedEventName = eventName || trigger.event_name || 'unknown';

  if (!trigger.is_active || !template || !template.is_active) {
    return finalizeDisabled(svc, {
      tenantId,
      triggerId,
      templateId: template?.id || null,
      loadId,
      eventName: resolvedEventName,
      fireKey,
      detail: !trigger.is_active
        ? 'trigger inactive'
        : !template
        ? 'template missing'
        : 'template inactive',
    });
  }

  // ── Step 2: Dedupe check ──
  const windowSeconds = trigger.dedupe_window_seconds || 3600;
  const cutoffIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data: priorFires } = await svc
    .from('email_trigger_log')
    .select('id, fired_at')
    .eq('tenant_id', tenantId)
    .eq('trigger_id', triggerId)
    .eq('load_id', loadId)
    .eq('fire_key', fireKey)
    .eq('outcome', 'fired')
    .gte('fired_at', cutoffIso)
    .order('fired_at', { ascending: false })
    .limit(1);

  if (priorFires && priorFires.length > 0) {
    return finalizeDeduped(svc, {
      tenantId,
      triggerId,
      templateId: template.id,
      loadId,
      eventName: resolvedEventName,
      fireKey,
      detail: `prior fire at ${priorFires[0].fired_at}`,
    });
  }

  // ── Step 3: Build context ──
  let builtContext;
  try {
    builtContext = await buildTriggerContext(svc, tenantId, loadId, userId);
  } catch (e) {
    return finalizeErrored(svc, {
      tenantId,
      triggerId,
      templateId: template.id,
      loadId,
      eventName: resolvedEventName,
      fireKey,
      error: `context build: ${e.message}`,
    });
  }

  const { context, formatPrefs, tenant, user, rawLoad } = builtContext;

  // ── Step 4: Resolve matching umbrellas ──
  // Use rawLoad (the full DB row with ALL columns) for umbrella matching,
  // NOT context.load (which only has variable-resolver fields and is
  // missing filter columns like container_size, customer_id, etc.)
  const { data: allUmbrellas } = await svc
    .from('email_umbrellas')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  const { winners, alwaysRun } = resolveMatchingUmbrellas(
    rawLoad,
    allUmbrellas || []
  );
  const toFire = dedupeUmbrellasById([...winners, ...alwaysRun]);

  if (toFire.length === 0) {
    // No matching umbrellas → record skipped
    return finalizeSkipped(svc, {
      tenantId,
      triggerId,
      templateId: template.id,
      loadId,
      eventName: resolvedEventName,
      fireKey,
      detail: 'no umbrellas matched this load',
      umbrellaDecisions: [],
    });
  }

  // ── Step 5: Per-umbrella fan-out ──
  const umbrellaDecisions = [];
  let messagesCreated = 0;
  let caughtExceptions = 0;

  for (const umbrella of toFire) {
    const decision = {
      umbrella_id: umbrella.id,
      name: umbrella.name,
      specificity_score: umbrella.specificity_score || 0,
      always_run: !!umbrella.always_run,
      matched: true,
      groups_fired: [],
      suppressed_reason: null,
      error: null,
    };

    try {
      // Find active configuration(s) that own this umbrella
      const { data: attachments, error: attErr } = await svc
        .from('email_configuration_umbrellas')
        .select('configuration_id, configuration:email_configurations!inner(id, is_active, priority)')
        .eq('umbrella_id', umbrella.id)
        .eq('tenant_id', tenantId);
      if (attErr) throw new Error(`config lookup: ${attErr.message}`);

      const activeAttachments = (attachments || []).filter(
        (a) => a.configuration?.is_active === true
      );
      if (activeAttachments.length === 0) {
        decision.suppressed_reason = 'no_active_configuration';
        umbrellaDecisions.push(decision);
        continue;
      }

      // Pick the highest-priority (lowest priority number) configuration
      activeAttachments.sort(
        (a, b) => (a.configuration.priority || 0) - (b.configuration.priority || 0)
      );
      const configId = activeAttachments[0].configuration_id;
      const fullConfig = await fetchFullConfiguration(svc, tenantId, configId);
      if (!fullConfig) {
        decision.suppressed_reason = 'configuration_not_found';
        umbrellaDecisions.push(decision);
        continue;
      }
      decision.configuration_id = fullConfig.id;
      decision.configuration_name = fullConfig.name;
      decision.sender_kind = fullConfig.sender_kind;

      // Fetch groups on this umbrella that contain the trigger's template
      const { data: groupRows, error: grpErr } = await svc
        .from('email_umbrella_groups')
        .select(
          '*, email_umbrella_group_templates!inner(template_id)'
        )
        .eq('umbrella_id', umbrella.id)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .eq('email_umbrella_group_templates.template_id', template.id);
      if (grpErr) throw new Error(`group lookup: ${grpErr.message}`);

      if (!groupRows || groupRows.length === 0) {
        decision.suppressed_reason = 'no_groups_containing_template';
        umbrellaDecisions.push(decision);
        continue;
      }

      // Resolve from_address once per umbrella (same sender for all groups)
      const fromAddress = resolveFromAddress(fullConfig, context, tenant);
      const fromName = resolveFromName(fullConfig, tenant);

      // Per-fire cache shared across all groups on this umbrella
      const cache = new Map();

      for (const group of groupRows) {
        const groupDecision = {
          group_id: group.id,
          group_name: group.name,
          suppressed_reason: null,
          error: null,
          message_id: null,
          missing_variables: [],
          unknown_variables: [],
          recipient_counts: null,
        };

        try {
          // Expand recipients
          const { to, cc, bcc } = await expandGroupRecipients(
            svc,
            tenantId,
            group,
            context,
            cache
          );
          groupDecision.recipient_counts = {
            to: to.length,
            cc: cc.length,
            bcc: bcc.length,
          };

          if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
            groupDecision.suppressed_reason = 'no_valid_recipients';
            decision.groups_fired.push(groupDecision);
            continue;
          }

          // Resolve template
          const rendered = resolveEmailTemplate({
            subject: template.subject,
            body_html: template.body_html,
            body_text: template.body_text,
            context,
            formatPrefs,
            templateOverrides: template.format_overrides || {},
            strict:
              formatPrefs?.strict_empty_mode === true ||
              template.format_overrides?.strict_empty_mode === true,
          });
          groupDecision.missing_variables = rendered.missing;
          groupDecision.unknown_variables = rendered.unknown;

          if (rendered.aborted) {
            groupDecision.suppressed_reason = 'strict_empty_abort';
            decision.groups_fired.push(groupDecision);
            continue;
          }

          // Build message + dispatch
          const message = {
            load_id: loadId,
            from_address: fromAddress,
            from_name: fromName,
            reply_to: group.reply_to || null,
            to,
            cc,
            bcc,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            template_id: template.id,
            umbrella_id: umbrella.id,
            group_id: group.id,
            configuration_id: fullConfig.id,
            trigger_id: triggerId,
            sent_by_user_id: userId || null,
          };

          const provider = getProvider(fullConfig.sender_kind || 'mock');
          const result = await provider.dispatch(svc, tenantId, message);
          groupDecision.message_id = result.messageId;
          messagesCreated++;
        } catch (groupErr) {
          groupDecision.error = groupErr.message;
          groupDecision.suppressed_reason = 'error';
          caughtExceptions++;
        }
        decision.groups_fired.push(groupDecision);
      }
    } catch (umbrellaErr) {
      decision.suppressed_reason = 'error';
      decision.error = umbrellaErr.message;
      caughtExceptions++;
    }

    umbrellaDecisions.push(decision);
  }

  // ── Step 6: Write the final trigger_log row ──
  let outcome;
  let detail;
  if (messagesCreated > 0) {
    outcome = 'fired';
    detail = `${toFire.length} umbrella(s) matched, ${messagesCreated} message(s) sent`;
  } else if (caughtExceptions > 0) {
    outcome = 'errored';
    detail = `${toFire.length} umbrella(s) matched, ${caughtExceptions} error(s), 0 messages sent`;
  } else {
    outcome = 'skipped';
    detail = `${toFire.length} umbrella(s) matched, 0 messages sent`;
  }

  const { data: logRow } = await svc
    .from('email_trigger_log')
    .insert({
      tenant_id: tenantId,
      trigger_id: triggerId,
      template_id: template.id,
      load_id: loadId,
      event_name: resolvedEventName,
      fire_key: fireKey,
      outcome,
      outcome_detail: detail,
      umbrella_decisions: umbrellaDecisions,
      messages_created: messagesCreated,
    })
    .select('id')
    .single();

  return {
    outcome,
    messagesCreated,
    umbrellaDecisions,
    logId: logRow?.id || null,
    error: null,
  };
}

/* ─────────────────────────── ad-hoc send ─────────────────────────── */

/**
 * Ad-hoc email send — bypasses trigger/dedupe/umbrella pipeline.
 * Used by AR send endpoints (invoice email, rate-con email) that have
 * already resolved their recipients, template body, and attachments.
 *
 * @param svc  service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   senderKind?: string,            // provider key, defaults to 'sendgrid'
 *   fromAddress: string,
 *   fromName?: string | null,
 *   replyTo?: string | null,
 *   to: string[],
 *   cc?: string[],
 *   bcc?: string[],
 *   subject: string,
 *   html?: string | null,
 *   text?: string | null,
 *   attachments?: Array<{
 *     content: Buffer | string,
 *     filename: string,
 *     type?: string,
 *     disposition?: string
 *   }>,
 *   loadId?: string | null,
 *   organizationId?: string | null,
 *   templateId?: string | null,
 *   umbrellaId?: string | null,
 *   groupId?: string | null,
 *   configurationId?: string | null,
 *   triggerId?: string | null,
 *   sentByUserId?: string | null,
 *   relatedEntity?: { type: 'invoice' | 'charge_set', id: string } | null,
 *   eventName?: string | null,   // e.g. 'manual:invoice_send'
 * }} params
 * @returns {Promise<{ ok: boolean, messageId: string, providerMessageId: string }>}
 *
 * relatedEntity + eventName are reserved for AR manual sends — sub-project
 * 2a.2/2a.3 Task 8 will use them to write an `email_trigger_log` row with
 * trigger_id=NULL so manual sends surface in the existing Trigger Activity
 * page. They are accepted but currently unused in the dispatch body.
 */
export async function dispatchEmail(svc, params) {
  const {
    tenantId,
    senderKind = 'sendgrid',
    fromAddress,
    fromName = null,
    replyTo = null,
    to,
    cc = [],
    bcc = [],
    subject,
    html = null,
    text = null,
    attachments = [],
    loadId = null,
    organizationId = null,
    templateId = null,
    umbrellaId = null,
    groupId = null,
    configurationId = null,
    triggerId = null,
    sentByUserId = null,
    relatedEntity = null,
    eventName = null,
  } = params;

  if (!tenantId || !fromAddress || !subject || !to || to.length === 0) {
    throw new Error(
      'dispatchEmail: tenantId, fromAddress, subject, and to[] are required'
    );
  }

  const message = {
    load_id: loadId,
    organization_id: organizationId,
    from_address: fromAddress,
    from_name: fromName,
    reply_to: replyTo,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    attachments,
    template_id: templateId,
    umbrella_id: umbrellaId,
    group_id: groupId,
    configuration_id: configurationId,
    trigger_id: triggerId,
    sent_by_user_id: sentByUserId,
  };

  const provider = getProvider(senderKind);
  const result = await provider.dispatch(svc, tenantId, message);

  // Write email_trigger_log row for manual AR sends (non-blocking)
  if (relatedEntity && eventName) {
    try {
      await svc.from('email_trigger_log').insert({
        tenant_id: tenantId,
        trigger_id: null,
        template_id: templateId,
        load_id: loadId,
        event_name: eventName,
        fire_key: `manual:${relatedEntity.type}:${relatedEntity.id}:${Date.now()}`,
        outcome: 'fired',
        sent_by_user_id: sentByUserId,
        configuration_id: configurationId,
        umbrella_id: null,
        group_id: null,
        decision_snapshot: {
          event_name: eventName,
          related_entity: relatedEntity,
          recipients: { to, cc, bcc },
          subject,
          body_format: params.body_format || null,
        },
        fired_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('email_trigger_log insert failed:', err);
    }
  }

  return result;
}

/**
 * Write a single `email_trigger_log` row with outcome='skipped' for AR
 * manual actions where the user deliberately chose not to send an email
 * (e.g., invoice popup Skip button). No `email_messages` rows are
 * written — no email was dispatched.
 *
 * @param {SupabaseClient} svc
 * @param {{ tenantId: string, templateId?: string | null, loadId?: string | null,
 *           relatedEntity: { type: string, id: string }, eventName: string,
 *           sentByUserId?: string | null }} params
 */
export async function logManualSkip(svc, {
  tenantId,
  templateId = null,
  loadId = null,
  relatedEntity,
  eventName,
  sentByUserId = null,
}) {
  const { error } = await svc.from('email_trigger_log').insert({
    tenant_id: tenantId,
    trigger_id: null,
    template_id: templateId,
    load_id: loadId,
    event_name: eventName,
    fire_key: `manual-skip:${relatedEntity.type}:${relatedEntity.id}:${Date.now()}`,
    outcome: 'skipped',
    sent_by_user_id: sentByUserId,
    umbrella_id: null,
    group_id: null,
    decision_snapshot: { event_name: eventName, related_entity: relatedEntity, reason: 'user_skipped' },
    fired_at: new Date().toISOString(),
  });
  if (error) throw new Error(`logManualSkip insert failed: ${error.message}`);
}

/* ─────────────────────────── helpers ─────────────────────────── */

/**
 * Resolve the From: address string from a config loaded via
 * `fetchFullConfiguration()` (not a raw `email_configurations` row — that
 * lacks the joined tenant_sender_addresses struct needed to build the
 * full address).
 *
 * Exported so ad-hoc callers (AR manual-send endpoints, etc.) can reuse
 * the same resolution the trigger pipeline uses.
 */
export function resolveFromAddress(config, context, tenant) {
  if (config.sender_kind === 'sendgrid' && config.sender_address) {
    // tenant_sender_addresses has local_part + domain_id; we don't
    // eager-load the domain in fetchFullConfiguration, so this may
    // return an incomplete "<local>@" in Phase 1. Milestone 4a will
    // expose the full domain join; for now, fall back to tenant.email.
    const local = config.sender_address.local_part;
    const domainPart = config.sender_address.domain || 'example.com';
    if (local) return `${local}@${domainPart}`;
  }
  if (config.sender_kind === 'shared_gmail' && config.shared_account) {
    return config.shared_account.email_address;
  }
  if (config.sender_kind === 'user_gmail') {
    return context?.user?.email || tenant?.email || 'noreply@drayagedirect.local';
  }
  return tenant?.email || 'noreply@drayagedirect.local';
}

/**
 * Resolve the From: display-name from a fetchFullConfiguration() config.
 * Exported alongside resolveFromAddress for ad-hoc caller use.
 */
export function resolveFromName(config, tenant) {
  if (config.sender_kind === 'sendgrid' && config.sender_address) {
    return config.sender_address.display_name || tenant?.name || null;
  }
  if (config.sender_kind === 'shared_gmail' && config.shared_account) {
    return config.shared_account.display_name || tenant?.name || null;
  }
  return tenant?.name || null;
}

async function finalizeDisabled(svc, p) {
  return writeTerminalLog(svc, {
    ...p,
    outcome: 'disabled',
    outcome_detail: p.detail,
    umbrella_decisions: [],
    messages_created: 0,
  });
}

async function finalizeSkipped(svc, p) {
  return writeTerminalLog(svc, {
    ...p,
    outcome: 'skipped',
    outcome_detail: p.detail,
    umbrella_decisions: p.umbrellaDecisions || [],
    messages_created: 0,
  });
}

async function finalizeDeduped(svc, p) {
  return writeTerminalLog(svc, {
    ...p,
    outcome: 'deduped',
    outcome_detail: p.detail,
    umbrella_decisions: [],
    messages_created: 0,
  });
}

async function finalizeErrored(svc, p) {
  return writeTerminalLog(svc, {
    ...p,
    outcome: 'errored',
    outcome_detail: p.error,
    umbrella_decisions: [],
    messages_created: 0,
  });
}

async function writeTerminalLog(svc, p) {
  const { data: logRow } = await svc
    .from('email_trigger_log')
    .insert({
      tenant_id: p.tenantId,
      trigger_id: p.triggerId,
      template_id: p.templateId,
      load_id: p.loadId,
      event_name: p.eventName,
      fire_key: p.fireKey,
      outcome: p.outcome,
      outcome_detail: p.outcome_detail,
      umbrella_decisions: p.umbrella_decisions,
      messages_created: p.messages_created,
    })
    .select('id')
    .single();

  return {
    outcome: p.outcome,
    messagesCreated: p.messages_created,
    umbrellaDecisions: p.umbrella_decisions,
    logId: logRow?.id || null,
    error: p.outcome === 'errored' ? p.outcome_detail : null,
  };
}
