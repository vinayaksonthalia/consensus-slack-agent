/**
 * Governance — the trusted-channel / authority model and the decision-lifecycle
 * predicates that gate ENFORCEMENT (hard contradiction alerts).
 *
 * Phase 1 is config-driven with NO admin UI. Two env vars shape behavior:
 *   - CONSENSUS_TRUSTED_CHANNELS: comma-separated channel IDs whose captures
 *     become `active` (enforceable) immediately. Captures from ANY other channel
 *     become `proposed` (surfaced but NOT enforced).
 *   - CONSENSUS_AUTHORITY_USERS: comma-separated user IDs allowed to
 *     Confirm / Reject / Mark-exception / Supersede a decision into (or out of)
 *     an enforceable state.
 *
 * Fallbacks preserve today's demo behavior when the env is unset:
 *   - CONSENSUS_TRUSTED_CHANNELS unset ENTIRELY → EVERY channel is trusted, so
 *     ambient capture still yields `active` decisions like the pre-governance
 *     build. Set-but-empty ("") → no channel is trusted (an explicit lockdown).
 *   - CONSENSUS_AUTHORITY_USERS unset OR empty → EVERYONE is authorized, so the
 *     existing one-click demo flows keep working.
 *
 * Every predicate here is PURE: it takes an explicit `env` (defaulting to
 * process.env) and returns a boolean/string with no I/O, so the whole state
 * machine is unit-testable without Slack or a live ledger.
 *
 * @typedef {import('./ledger.js').Decision} Decision
 */

/**
 * Parse a comma-separated env value into a Set of trimmed, non-empty tokens.
 * @param {string | undefined | null} raw
 * @returns {Set<string>}
 */
export function parseIdList(raw) {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Whether captures from `channelId` should become enforceable (`active`)
 * immediately. When CONSENSUS_TRUSTED_CHANNELS is unset ENTIRELY, every channel
 * is trusted (demo fallback). When it is set (even to ""), only the listed
 * channels are trusted — an explicit "" locks everything down to `proposed`.
 * @param {string | null | undefined} channelId
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isTrustedChannel(channelId, env = process.env) {
  const raw = env.CONSENSUS_TRUSTED_CHANNELS;
  // Unset entirely → all channels trusted (keeps ambient capture working).
  if (raw === undefined) return true;
  if (!channelId) return false;
  return parseIdList(raw).has(channelId);
}

/**
 * The capture status a new decision should get, given its channel: trusted
 * channels yield `active` (enforceable); every other channel yields `proposed`
 * (stored + shown, never hard-alerted).
 * @param {string | null | undefined} channelId
 * @param {Record<string, string | undefined>} [env]
 * @returns {'active' | 'proposed'}
 */
export function captureStatusForChannel(channelId, env = process.env) {
  return isTrustedChannel(channelId, env) ? 'active' : 'proposed';
}

/**
 * Whether `userId` may transition a decision into/out of an enforceable state
 * (Confirm / Reject / Mark-exception / Supersede). When CONSENSUS_AUTHORITY_USERS
 * is unset or empty, EVERYONE is authorized (demo fallback); otherwise only the
 * listed user IDs are.
 * @param {string | null | undefined} userId
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function canConfirm(userId, env = process.env) {
  const list = parseIdList(env.CONSENSUS_AUTHORITY_USERS);
  // Unset/empty → fall back to today's behavior: treat all users as authorized.
  if (list.size === 0) return true;
  if (!userId) return false;
  return list.has(userId);
}

/** Statuses that enforce (hard-alert) when not expired. */
const ENFORCEABLE_STATUSES = new Set(['active', 'confirmed']);

/**
 * Is this decision a genuinely enforceable standing rule RIGHT NOW? True only
 * when its status is `active` or `confirmed` (confirmed = explicit-approval
 * flavor, active = ambient-in-trusted-channel flavor — equivalent for
 * enforcement) AND it has not passed its `expires_at`. `proposed`, `exception`,
 * `superseded`, `expired`, and `rejected` decisions are never enforceable.
 *
 * Pure: `now` is injected so expiry is testable deterministically.
 * @param {Pick<Decision, 'status' | 'expires_at'> | null | undefined} decision
 * @param {number} [now] epoch ms
 * @returns {boolean}
 */
export function isEnforceable(decision, now = Date.now()) {
  if (!decision) return false;
  if (!ENFORCEABLE_STATUSES.has(decision.status)) return false;
  return !isExpired(decision, now);
}

/**
 * Whether a decision has a concrete `expires_at` that is at/before `now`. A null
 * or unparseable expiry never expires.
 * @param {Pick<Decision, 'expires_at'> | null | undefined} decision
 * @param {number} [now] epoch ms
 * @returns {boolean}
 */
export function isExpired(decision, now = Date.now()) {
  const raw = decision?.expires_at;
  if (!raw) return false;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return false;
  return ms <= now;
}

/**
 * Map a legacy ledger status to the Phase-1 lifecycle vocabulary. Only the two
 * renamed legacy values move: `dismissed`→`rejected`. `active` and `superseded`
 * (and any already-new status) pass through unchanged. Idempotent.
 * @param {string | null | undefined} status
 * @returns {Decision['status']}
 */
export function mapLegacyStatus(status) {
  if (status === 'dismissed') return 'rejected';
  return /** @type {Decision['status']} */ (status ?? 'active');
}
