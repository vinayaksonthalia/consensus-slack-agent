/**
 * Live evaluation of the Workspace Consistency Audit engine (audit.js).
 *
 * Builds an in-memory fixture of active decisions containing EXACTLY two true
 * latent conflicts, surrounded by innocent, non-conflicting decisions, then runs
 * the real two-stage audit (scan → judge) against a live LLM. Verdict is PASS iff
 * the audit confirms BOTH true conflicts and ZERO false ones.
 *
 * LLM provider: CEREBRAS_API_KEY / GEMINI_API_KEY from env if set (hosted),
 * otherwise the local Claude auth via the Agent SDK (llm.js decides). No live LLM
 * ever runs under `node --test`; this is an explicit, manually-run harness.
 *
 *   node scripts/audit-eval.mjs
 */

import { runAudit } from '../consensus-core/audit.js';
import { auditPairKey } from '../consensus-core/ledger.js';

/** @type {import('../consensus-core/ledger.js').Decision[]} */
const decisions = [
  // ── True conflict #1: same subject (API v1 availability), hard incompatible positions
  // (fully shut off on a date vs. guaranteed available past that date).
  {
    id: 'd1',
    statement:
      'API v1 will be shut off completely on September 30, 2026; after that date no v1 endpoints will be served to any customer.',
    rationale: null,
    channel_id: 'C_EDGE',
    channel_name: 'acct-edge',
    decided_by: 'U1',
    message_ts: '1.1',
    permalink: null,
    status: 'active',
    confidence: 0.97,
    created_at: '2026-06-01T10:00:00.000Z',
    is_private: 0,
  },
  {
    id: 'd2',
    statement: 'We have guaranteed our enterprise customers continued API v1 access through at least December 2026.',
    rationale: null,
    channel_id: 'C_OMEGA',
    channel_name: 'acct-omega',
    decided_by: 'U1',
    message_ts: '2.1',
    permalink: null,
    status: 'active',
    confidence: 0.96,
    created_at: '2026-06-05T10:00:00.000Z',
    is_private: 0,
  },
  // ── True conflict #2: same subject (datastore for new services), incompatible choice.
  {
    id: 'd3',
    statement: 'Standardizing on Postgres for all new services going forward.',
    rationale: null,
    channel_id: 'C_GEN',
    channel_name: 'general',
    decided_by: 'U1',
    message_ts: '3.1',
    permalink: null,
    status: 'active',
    confidence: 0.97,
    created_at: '2026-06-02T10:00:00.000Z',
    is_private: 0,
  },
  {
    id: 'd4',
    statement: 'The new analytics service will be built on MongoDB as its primary datastore.',
    rationale: null,
    channel_id: 'C_DATA',
    channel_name: 'data-eng',
    decided_by: 'U1',
    message_ts: '4.1',
    permalink: null,
    status: 'active',
    confidence: 0.95,
    created_at: '2026-06-06T10:00:00.000Z',
    is_private: 0,
  },
  // ── Innocent decisions: unrelated subjects; must never be paired with anything.
  {
    id: 'i1',
    statement: 'Remote Fridays are now a permanent policy for the whole company.',
    rationale: null,
    channel_id: 'C_RAND',
    channel_name: 'random',
    decided_by: 'U1',
    message_ts: '5.1',
    permalink: null,
    status: 'active',
    confidence: 0.96,
    created_at: '2026-06-03T10:00:00.000Z',
    is_private: 0,
  },
  {
    id: 'i2',
    statement: 'Support SLA is set at 24-hour first-response for all paid plans.',
    rationale: null,
    channel_id: 'C_GEN',
    channel_name: 'general',
    decided_by: 'U1',
    message_ts: '6.1',
    permalink: null,
    status: 'active',
    confidence: 0.97,
    created_at: '2026-06-04T10:00:00.000Z',
    is_private: 0,
  },
  {
    id: 'i3',
    statement: 'The team will use the blue/teal brand palette for the rebrand.',
    rationale: null,
    channel_id: 'C_NTO',
    channel_name: 'campaign-nto',
    decided_by: 'U1',
    message_ts: '7.1',
    permalink: null,
    status: 'active',
    confidence: 0.97,
    created_at: '2026-06-07T10:00:00.000Z',
    is_private: 0,
  },
  {
    id: 'i4',
    statement: 'On-call rotation switches from daily to weekly starting next month.',
    rationale: null,
    channel_id: 'C_SWARM',
    channel_name: 'service-swarm',
    decided_by: 'U1',
    message_ts: '8.1',
    permalink: null,
    status: 'active',
    confidence: 0.95,
    created_at: '2026-06-08T10:00:00.000Z',
    is_private: 0,
  },
];

const TRUE_PAIR_KEYS = [auditPairKey('d1', 'd2'), auditPairKey('d3', 'd4')].sort();

async function main() {
  const provider = process.env.CEREBRAS_API_KEY
    ? `Cerebras (${process.env.CEREBRAS_MODEL || 'zai-glm-4.7'})`
    : process.env.GEMINI_API_KEY
      ? 'Gemini'
      : 'local Claude (Agent SDK)';

  console.log(`Audit eval — ${decisions.length} decisions, provider: ${provider}`);
  console.log('Expecting exactly 2 latent conflicts: d1|d2 (API v1) and d3|d4 (datastore)\n');

  const result = await runAudit({ decisions });

  const foundKeys = result.confirmed.map((c) => auditPairKey(c.a.id, c.b.id)).sort();
  const missing = TRUE_PAIR_KEYS.filter((k) => !foundKeys.includes(k));
  const falsePairs = foundKeys.filter((k) => !TRUE_PAIR_KEYS.includes(k));

  console.log('Confirmed conflicts:');
  if (result.confirmed.length === 0) {
    console.log('  (none)');
  } else {
    for (const c of result.confirmed) {
      const key = auditPairKey(c.a.id, c.b.id);
      const tag = TRUE_PAIR_KEYS.includes(key) ? 'TRUE ' : 'FALSE';
      console.log(`  [${tag}] ${key}  conf=${c.confidence.toFixed(2)}`);
      console.log(`         A: ${c.a.statement}`);
      console.log(`         B: ${c.b.statement}`);
      console.log(`         why: ${(c.reasoning || '').slice(0, 120)}`);
    }
  }

  const pass = missing.length === 0 && falsePairs.length === 0;
  console.log(
    `\ncandidatePairs=${result.candidatePairs}  confirmed=${result.confirmed.length}  durationMs=${result.durationMs}`,
  );
  console.log(
    'LLM calls: 1 scan + 1–2 verify per candidate (reverse direction only on a forward miss) → ' +
      `${1 + result.candidatePairs}–${1 + 2 * result.candidatePairs} for ${result.candidatePairs} candidate pair(s)`,
  );
  if (missing.length) console.log(`MISSED true pairs: ${missing.join(', ')}`);
  if (falsePairs.length) console.log(`FALSE pairs: ${falsePairs.join(', ')}`);
  console.log(
    `\nVERDICT: ${pass ? 'PASS' : 'FAIL'} (found both true pairs=${missing.length === 0}, zero false pairs=${falsePairs.length === 0})`,
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(`audit-eval crashed: ${e?.stack || e}`);
  process.exit(1);
});
