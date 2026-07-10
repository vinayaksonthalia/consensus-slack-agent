/**
 * Block Kit builders for Consensus — the decision-capture card, the
 * contradiction alert, and the App Home dashboard.
 */

/**
 * @typedef {import('./ledger.js').Decision} Decision
 */

/**
 * Format an ISO timestamp (or Slack ts) into a short human date.
 * @param {string | null | undefined} value
 * @returns {string}
 */
function shortDate(value) {
  if (!value) return 'unknown date';
  // Slack ts looks like "1700000000.000100"; ISO looks like a date string.
  const ms = /^\d+\.\d+$/.test(value) ? Number.parseFloat(value) * 1000 : Date.parse(value);
  if (Number.isNaN(ms)) return 'unknown date';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** @param {string | null | undefined} id */
function userMention(id) {
  return id ? `<@${id}>` : 'someone';
}

/**
 * Sanitize untrusted text for safe rendering inside a Slack `mrkdwn` field.
 * Escapes the three Slack entity characters (& < >) so chat content cannot forge
 * mentions (<!channel>, <@U…>) or fake <http://x|links>, collapses whitespace,
 * and truncates to `maxLen` with an ellipsis.
 * @param {unknown} text
 * @param {number} [maxLen=300]
 * @returns {string}
 */
export function sanitizeMrkdwn(text, maxLen = 300) {
  let s = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) {
    s = `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  }
  return s;
}

/**
 * Compact "Decision captured" card, posted in-thread.
 * @param {{statement: string, decidedBy?: string|null, channelName?: string|null, permalink?: string|null, id: string}} args
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function decisionCard({ statement, decidedBy, channelName, permalink, id }) {
  const where = channelName ? `#${channelName}` : 'this channel';
  const contextText =
    `Decided by ${userMention(decidedBy)} in ${where} · ${shortDate(new Date().toISOString())}` +
    (permalink ? ` · <${permalink}|view message>` : '');

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📌 Decision captured', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${sanitizeMrkdwn(statement, 300)}*` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextText }],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Mark superseded', emoji: true },
          action_id: 'consensus_supersede',
          value: id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Not a decision', emoji: true },
          action_id: 'consensus_not_decision',
          value: id,
          style: 'danger',
        },
      ],
    },
  ];
}

/**
 * Contradiction alert, posted ephemerally to the message author.
 * @param {{newMessageText: string, decision: Decision, confidence: number, reasoning: string}} args
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function contradictionAlert({ newMessageText, decision, confidence, reasoning }) {
  const where = decision.channel_name ? `#${decision.channel_name}` : 'a channel';
  const pct = `${Math.round((confidence || 0) * 100)}%`;
  const original = decision.permalink ? `<${decision.permalink}|View original>` : 'original message';
  const contextText =
    `Decided by ${userMention(decision.decided_by)} in ${where} · ${shortDate(decision.created_at)} · ${original}` +
    ` · ${pct} confidence`;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⚠️ *Heads up — this may conflict with a team decision.*',
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `> ${sanitizeMrkdwn(decision.statement, 300)}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextText }],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'This is intentional — supersede', emoji: true },
          action_id: 'consensus_confirm_supersede',
          value: decision.id,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Not a conflict', emoji: true },
          action_id: 'consensus_dismiss',
          // Carry the OFFENDING message text (truncated) so the dismissal is
          // recorded against it — not against the alert's own rendered text.
          // Block Kit button values cap at 2000 chars; 500 keeps us well under.
          value: JSON.stringify({ decisionId: decision.id, text: (newMessageText || '').slice(0, 500) }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Show reasoning', emoji: true },
          action_id: 'consensus_reasoning',
          // Reasoning is rendered as mrkdwn later (handleReasoning); sanitize +
          // cap here so it is safe and stays under Block Kit's 2000-char value cap.
          value: sanitizeMrkdwn(reasoning || 'No reasoning provided.', 1500),
        },
      ],
    },
  ];
}

/** @param {Decision['status']} status */
function statusEmoji(status) {
  if (status === 'superseded') return '🔁';
  if (status === 'dismissed') return '🚫';
  return '🟢';
}

/**
 * App Home dashboard view.
 * @param {{stats: import('./ledger.js').Stats, decisions: Decision[], lastAudit?: import('./audit.js').LastAuditSummary | null}} args
 * @returns {import('@slack/types').HomeView}
 */
export function homeView({ stats, decisions, lastAudit = null }) {
  const precision = stats.precisionPct === null || stats.precisionPct === undefined ? '—' : `${stats.precisionPct}%`;
  const confirmed = stats.superseded;

  /** @type {import('@slack/types').KnownBlock[]} */
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🛡️ Consensus — workspace consistency guardian', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Active decisions*\n${stats.activeDecisions}` },
        { type: 'mrkdwn', text: `*Total captured*\n${stats.captured}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔎 Run consistency audit', emoji: true },
          action_id: 'consensus_run_audit',
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: lastAudit
            ? `Last audit: ${shortDate(lastAudit.at)} · ${lastAudit.checkedCount} checked · ${lastAudit.confirmedCount} latent conflict${lastAudit.confirmedCount === 1 ? '' : 's'} found`
            : 'X-ray the whole ledger for standing decisions that already contradict each other.',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*📊 All time*' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Alerts fired*\n${stats.alertsFired}` },
        { type: 'mrkdwn', text: `*Confirmed (superseded)*\n${confirmed}` },
        { type: 'mrkdwn', text: `*Dismissed*\n${stats.dismissed}` },
        { type: 'mrkdwn', text: `*Precision*\n${precision}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🧠 Learned patterns: ${stats.learnedPatterns}` }],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Counts are workspace-wide totals; the log below shows only decisions you have access to.',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*🗂 Decision Log*' },
    },
  ];

  if (decisions.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "_No decisions captured yet._ I'll start logging team decisions as they happen in your channels.",
      },
    });
  } else {
    for (const d of decisions.slice(0, 15)) {
      const where = d.channel_name ? `#${d.channel_name}` : 'channel';
      const line = `${statusEmoji(d.status)} *${sanitizeMrkdwn(d.statement, 300)}*`;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: line },
      });
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${where} · ${shortDate(d.created_at)}${d.permalink ? ` · <${d.permalink}|view>` : ''}`,
          },
        ],
      });
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Consensus learns from every Confirm/Dismiss — precision improves as you use it.',
      },
    ],
  });

  return { type: 'home', blocks };
}

/**
 * Render one decision as a "statement (channel, date, link)" mrkdwn fragment for
 * an audit conflict card.
 * @param {Decision} d
 * @returns {string}
 */
function auditDecisionLine(d) {
  const where = d.channel_name ? `#${d.channel_name}` : 'a channel';
  const link = d.permalink ? ` · <${d.permalink}|view>` : '';
  return `*${sanitizeMrkdwn(d.statement, 300)}*\n_${where} · ${shortDate(d.created_at)}${link}_`;
}

/**
 * Block Kit blocks for a consistency-audit report: an intro line, one card per
 * confirmed latent conflict (with Supersede-first / Supersede-second / Not-a-conflict
 * buttons), and an optional trailing line counting conflicts hidden behind private
 * channels the viewer can't access.
 *
 * @param {{
 *   confirmed: import('./audit.js').ConfirmedConflict[],
 *   checkedCount: number,
 *   hiddenPrivateCount?: number
 * }} args
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function auditConflictBlocks({ confirmed, checkedCount, hiddenPrivateCount = 0 }) {
  /** @type {import('@slack/types').KnownBlock[]} */
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔎 *Consistency audit* — ${checkedCount} active decision${checkedCount === 1 ? '' : 's'} checked, *${confirmed.length}* latent conflict${confirmed.length === 1 ? '' : 's'} found.`,
      },
    },
  ];

  for (const { a, b, reasoning } of confirmed) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Latent conflict:*\n${auditDecisionLine(a)}\n\n*vs*\n\n${auditDecisionLine(b)}`,
      },
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🧠 ${sanitizeMrkdwn(reasoning || 'No reasoning provided.', 300)}` }],
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Supersede first', emoji: true },
          action_id: 'consensus_audit_supersede',
          value: a.id,
          style: 'primary',
        },
        {
          // Distinct action_id (Slack requires uniqueness within an actions
          // block); routed to the same handler as "Supersede first".
          type: 'button',
          text: { type: 'plain_text', text: 'Supersede second', emoji: true },
          action_id: 'consensus_audit_supersede_second',
          value: b.id,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Not a conflict', emoji: true },
          action_id: 'consensus_audit_dismiss',
          value: JSON.stringify({ aId: a.id, bId: b.id }),
        },
      ],
    });
  }

  if (hiddenPrivateCount > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🔒 ${hiddenPrivateCount} additional conflict${hiddenPrivateCount === 1 ? '' : 's'} exist involving private channels you don't have access to.`,
        },
      ],
    });
  }

  return blocks;
}
