/**
 * Polled Trigger Worker
 *
 * Evaluates composite event + status triggers for every active tenant,
 * running each trigger's evaluator to find candidate loads, and firing
 * matches through the central dispatcher.
 *
 * Called from the /api/cron/evaluate-triggers endpoint (which should be
 * hit on a schedule — Vercel cron, external pinger, or manual). A
 * per-day fire_key means repeat runs within the same day collapse on
 * the dedupe layer without needing a separate timer table.
 *
 * ── TODO (follow-up milestones) ──
 * These composite events are defined in lib/email-trigger-events.js but
 * intentionally NOT yet implemented. They are logged with a console
 * warning and skipped:
 *   - approaching_demurrage   — needs discharge_date + per-terminal rules
 *   - approaching_per_diem    — needs last_free_day + per-SSL rules
 *   - behind_schedule         — needs GPS/ELD telemetry
 *   - charge_set_updated      — needs order_charges diff capture
 *   - actively_in_waiting     — needs waiting-state timestamps
 *
 * Implemented in this milestone:
 *   - missing_information
 *   - load_created
 *   - (all) status triggers
 */

import { fireTrigger } from './dispatcher.js';
import * as missingInformation from './evaluators/missing-information.js';
import * as loadCreated from './evaluators/load-created.js';
import * as statusEvaluator from './evaluators/status.js';

const COMPOSITE_EVALUATORS = {
  missing_information: missingInformation,
  load_created: loadCreated,
};

const DEFERRED_COMPOSITE_EVENTS = new Set([
  'approaching_demurrage',
  'approaching_per_diem',
  'behind_schedule',
  'charge_set_updated',
  'actively_in_waiting',
]);

/** Build a YYYYMMDD string in UTC for per-day dedupe bucketing. */
function ymd(date) {
  const d = date || new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Run one evaluation sweep over the full tenant graph.
 *
 * @param svc service-role Supabase client
 * @param {{tenantId?: string}=} opts — if tenantId is provided, limit the
 *        sweep to that tenant. Useful for scoped test runs.
 * @returns {Promise<{
 *   evaluated: number,
 *   fired: number,
 *   skipped: number,
 *   deduped: number,
 *   errored: number,
 *   disabled: number,
 *   byTrigger: object,
 * }>}
 */
export async function runPolledEvaluation(svc, opts = {}) {
  const summary = {
    evaluated: 0,
    fired: 0,
    skipped: 0,
    deduped: 0,
    errored: 0,
    disabled: 0,
    byTrigger: {},
  };

  // 1. Tenant list
  let tenantQuery = svc.from('tenants').select('id, name, status');
  if (opts.tenantId) tenantQuery = tenantQuery.eq('id', opts.tenantId);
  const { data: tenants, error: tErr } = await tenantQuery;
  if (tErr) {
    console.error('polled worker tenant fetch:', tErr.message);
    return summary;
  }

  const activeTenants = (tenants || []).filter(
    (t) => !t.status || t.status === 'active'
  );

  // 2. For each tenant, fetch polled triggers
  for (const tenant of activeTenants) {
    const { data: triggers, error: trErr } = await svc
      .from('email_template_triggers')
      .select('*')
      .eq('tenant_id', tenant.id)
      .in('trigger_kind', ['event', 'status'])
      .eq('is_active', true);

    if (trErr) {
      console.error(
        `polled worker trigger fetch [tenant=${tenant.id}]:`,
        trErr.message
      );
      continue;
    }
    if (!triggers || triggers.length === 0) continue;

    for (const trigger of triggers) {
      const triggerSummary = {
        evaluated: 0,
        fired: 0,
        skipped: 0,
        deduped: 0,
        errored: 0,
        disabled: 0,
      };

      try {
        let candidates = [];

        if (trigger.trigger_kind === 'status') {
          candidates = await statusEvaluator.evaluate(svc, tenant.id, trigger);
        } else if (trigger.trigger_kind === 'event') {
          if (DEFERRED_COMPOSITE_EVENTS.has(trigger.event_name)) {
            console.warn(
              `polled worker: deferred composite event '${trigger.event_name}' skipped (trigger ${trigger.id})`
            );
            triggerSummary.skipped++;
            summary.skipped++;
            summary.byTrigger[trigger.id] = triggerSummary;
            continue;
          }
          const evaluator = COMPOSITE_EVALUATORS[trigger.event_name];
          if (!evaluator) {
            console.warn(
              `polled worker: unknown composite event '${trigger.event_name}' (trigger ${trigger.id})`
            );
            triggerSummary.skipped++;
            summary.skipped++;
            summary.byTrigger[trigger.id] = triggerSummary;
            continue;
          }
          candidates = await evaluator.evaluate(svc, tenant.id, trigger);
        } else {
          // Shouldn't happen — the .in() filter limits to event + status
          continue;
        }

        if (!Array.isArray(candidates) || candidates.length === 0) {
          triggerSummary.skipped++;
          summary.skipped++;
          summary.byTrigger[trigger.id] = triggerSummary;
          continue;
        }

        const dayStamp = ymd();
        for (const candidate of candidates) {
          triggerSummary.evaluated++;
          summary.evaluated++;
          // Candidate-shape-aware dispatch (Stream B.1c):
          // - Legacy orders candidates: { load_id, reason } -> entityType='order', entityId=load_id
          // - Non-order candidates (B.1b evaluator): { entityType, entityId, enteredAt } -> use as-is
          const entityType = candidate.entityType || 'order';
          const entityId = candidate.entityId || candidate.load_id;
          const fireKey = `polled_${entityType}_${entityId}_${dayStamp}`;
          try {
            const result = await fireTrigger(svc, {
              tenantId: tenant.id,
              triggerId: trigger.id,
              entityType,
              entityId,
              fireKey,
              userId: null, // cron-initiated
              eventName: trigger.event_name || 'polled',
            });
            switch (result.outcome) {
              case 'fired':
                triggerSummary.fired++;
                summary.fired++;
                break;
              case 'skipped':
                triggerSummary.skipped++;
                summary.skipped++;
                break;
              case 'deduped':
                triggerSummary.deduped++;
                summary.deduped++;
                break;
              case 'errored':
                triggerSummary.errored++;
                summary.errored++;
                break;
              case 'disabled':
                triggerSummary.disabled++;
                summary.disabled++;
                break;
              default:
                break;
            }
          } catch (e) {
            console.error(
              `polled worker fire error [trigger=${trigger.id}, ${entityType}=${entityId}]:`,
              e.message
            );
            triggerSummary.errored++;
            summary.errored++;
          }
        }
      } catch (e) {
        console.error(
          `polled worker evaluator error [trigger=${trigger.id}]:`,
          e.message
        );
        triggerSummary.errored++;
        summary.errored++;
      }

      summary.byTrigger[trigger.id] = triggerSummary;
    }
  }

  return summary;
}
