/**
 * Glue between the audit ENGINE (audit.js — pure LLM logic) and the Slack
 * SURFACES (action handler DM, @mention thread). Runs an audit over the active
 * ledger, applies the per-viewer permission gate (fail-closed), records the
 * learning event, updates the App Home "Last audit" cache, and composes the
 * Block Kit message. Shared so the button flow and the mention flow are byte-for-byte
 * identical and permission-gated the same way.
 */

import { runAudit, setLastAudit } from './audit.js';
import { auditConflictBlocks } from './blocks.js';
import { listDecisions, recordEvent } from './ledger.js';
import { canSeeDecision } from './permissions.js';

/**
 * @typedef {Object} AuditReport
 * @property {number} checkedCount
 * @property {import('./audit.js').ConfirmedConflict[]} visibleConfirmed Pairs the viewer may see in full.
 * @property {number} hiddenPrivateCount Confirmed pairs excluded because a member-only decision is involved.
 * @property {number} totalConfirmed Workspace-wide confirmed count (visible + hidden).
 */

/**
 * Run an audit and permission-filter the confirmed conflicts for one viewer.
 *
 * A confirmed pair is only shown if the viewer can see BOTH decisions: if EITHER
 * is private and the viewer is not a member of its channel, the whole pair is
 * excluded (fail-closed) and counted into `hiddenPrivateCount` — never any detail.
 *
 * @param {{
 *   client: import('@slack/web-api').WebClient,
 *   userId: string,
 *   logger?: import('@slack/bolt').Logger
 * }} args
 * @returns {Promise<AuditReport>}
 */
export async function runAuditForViewer({ client, userId, logger }) {
  const decisions = listDecisions({ status: 'active', limit: 60 });
  const result = await runAudit({ decisions });
  recordEvent('audit_run');

  /** @type {import('./audit.js').ConfirmedConflict[]} */
  const visibleConfirmed = [];
  let hiddenPrivateCount = 0;
  for (const c of result.confirmed) {
    // canSeeDecision short-circuits (no API call) for public decisions, and
    // fails closed on any membership-lookup error → excluded, never leaked.
    const aOk = await canSeeDecision(client, c.a, userId, logger);
    const bOk = aOk ? await canSeeDecision(client, c.b, userId, logger) : false;
    if (aOk && bOk) visibleConfirmed.push(c);
    else hiddenPrivateCount++;
  }

  setLastAudit({
    at: new Date().toISOString(),
    checkedCount: result.checkedCount,
    confirmedCount: result.confirmed.length,
  });

  return {
    checkedCount: result.checkedCount,
    visibleConfirmed,
    hiddenPrivateCount,
    totalConfirmed: result.confirmed.length,
  };
}

/**
 * Compose the Slack message ({text, blocks}) for an audit report. Zero confirmed
 * conflicts → a clean all-clear line; otherwise the per-pair conflict cards plus
 * a private-channel summary line when applicable.
 * @param {AuditReport} report
 * @returns {{text: string, blocks?: import('@slack/types').KnownBlock[]}}
 */
export function composeAuditMessage(report) {
  const { checkedCount, visibleConfirmed, hiddenPrivateCount, totalConfirmed } = report;

  // Nothing confirmed anywhere → unambiguous all-clear.
  if (totalConfirmed === 0) {
    return {
      text: `✅ Audit complete — ${checkedCount} decision${checkedCount === 1 ? '' : 's'} checked, no latent contradictions. Your workspace agrees with itself.`,
    };
  }

  return {
    text: `🔎 Consistency audit — ${checkedCount} decisions checked, ${visibleConfirmed.length} latent conflict${visibleConfirmed.length === 1 ? '' : 's'} to review.`,
    blocks: auditConflictBlocks({ confirmed: visibleConfirmed, checkedCount, hiddenPrivateCount }),
  };
}
