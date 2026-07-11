import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  canConfirm,
  captureStatusForChannel,
  isEnforceable,
  isExpired,
  isTrustedChannel,
  mapLegacyStatus,
  parseIdList,
} from '../../consensus-core/governance.js';

describe('parseIdList', () => {
  it('trims, drops blanks, and dedupes', () => {
    const set = parseIdList(' C1 , C2 ,, C1 , ');
    assert.deepStrictEqual([...set].sort(), ['C1', 'C2']);
  });

  it('is empty for undefined/empty input', () => {
    assert.strictEqual(parseIdList(undefined).size, 0);
    assert.strictEqual(parseIdList('').size, 0);
    assert.strictEqual(parseIdList('   ').size, 0);
  });
});

describe('isTrustedChannel', () => {
  it('trusts EVERY channel when the env var is unset entirely (demo fallback)', () => {
    assert.strictEqual(isTrustedChannel('C_ANY', {}), true);
    assert.strictEqual(isTrustedChannel('C_OTHER', {}), true);
  });

  it('trusts only the listed channels when the var is set', () => {
    const env = { CONSENSUS_TRUSTED_CHANNELS: 'C_TRUSTED, C_ALSO' };
    assert.strictEqual(isTrustedChannel('C_TRUSTED', env), true);
    assert.strictEqual(isTrustedChannel('C_ALSO', env), true);
    assert.strictEqual(isTrustedChannel('C_UNTRUSTED', env), false);
  });

  it('trusts NOTHING when set to an explicit empty string (lockdown)', () => {
    assert.strictEqual(isTrustedChannel('C_ANY', { CONSENSUS_TRUSTED_CHANNELS: '' }), false);
  });
});

describe('captureStatusForChannel', () => {
  it('is active for a trusted channel, proposed otherwise', () => {
    const env = { CONSENSUS_TRUSTED_CHANNELS: 'C_TRUSTED' };
    assert.strictEqual(captureStatusForChannel('C_TRUSTED', env), 'active');
    assert.strictEqual(captureStatusForChannel('C_OTHER', env), 'proposed');
  });

  it('is active everywhere under the unset fallback', () => {
    assert.strictEqual(captureStatusForChannel('C_ANY', {}), 'active');
  });
});

describe('canConfirm', () => {
  it('authorizes everyone when the authority list is unset or empty (fallback)', () => {
    assert.strictEqual(canConfirm('U_ANY', {}), true);
    assert.strictEqual(canConfirm('U_ANY', { CONSENSUS_AUTHORITY_USERS: '' }), true);
    assert.strictEqual(canConfirm(null, {}), true);
  });

  it('authorizes only listed users when the list is set', () => {
    const env = { CONSENSUS_AUTHORITY_USERS: 'U_ADMIN, U_LEAD' };
    assert.strictEqual(canConfirm('U_ADMIN', env), true);
    assert.strictEqual(canConfirm('U_LEAD', env), true);
    assert.strictEqual(canConfirm('U_RANDOM', env), false);
    assert.strictEqual(canConfirm(null, env), false);
  });
});

describe('isExpired / isEnforceable', () => {
  const NOW = Date.parse('2026-07-11T00:00:00.000Z');

  it('a null/absent expiry never expires', () => {
    assert.strictEqual(isExpired({ expires_at: null }, NOW), false);
    assert.strictEqual(isExpired({ expires_at: undefined }, NOW), false);
    assert.strictEqual(isExpired({ expires_at: 'not-a-date' }, NOW), false);
  });

  it('an expiry at/before now is expired; a future expiry is not', () => {
    assert.strictEqual(isExpired({ expires_at: '2026-07-10T00:00:00.000Z' }, NOW), true);
    assert.strictEqual(isExpired({ expires_at: '2999-01-01T00:00:00.000Z' }, NOW), false);
  });

  it('active and confirmed are enforceable; every other status is not', () => {
    assert.strictEqual(isEnforceable({ status: 'active', expires_at: null }, NOW), true);
    assert.strictEqual(isEnforceable({ status: 'confirmed', expires_at: null }, NOW), true);
    for (const status of ['proposed', 'exception', 'superseded', 'expired', 'rejected']) {
      assert.strictEqual(isEnforceable({ status, expires_at: null }, NOW), false, `${status} must not be enforceable`);
    }
  });

  it('an expired active decision is NOT enforceable', () => {
    assert.strictEqual(isEnforceable({ status: 'active', expires_at: '2026-07-01T00:00:00.000Z' }, NOW), false);
    // …but the same decision was enforceable before its expiry.
    const before = Date.parse('2026-06-01T00:00:00.000Z');
    assert.strictEqual(isEnforceable({ status: 'active', expires_at: '2026-07-01T00:00:00.000Z' }, before), true);
  });

  it('tolerates null/undefined decisions', () => {
    assert.strictEqual(isEnforceable(null, NOW), false);
    assert.strictEqual(isEnforceable(undefined, NOW), false);
  });
});

describe('mapLegacyStatus', () => {
  it('maps only the renamed legacy value and is idempotent', () => {
    assert.strictEqual(mapLegacyStatus('dismissed'), 'rejected');
    assert.strictEqual(mapLegacyStatus('rejected'), 'rejected');
    assert.strictEqual(mapLegacyStatus('active'), 'active');
    assert.strictEqual(mapLegacyStatus('superseded'), 'superseded');
    assert.strictEqual(mapLegacyStatus('proposed'), 'proposed');
    assert.strictEqual(mapLegacyStatus(undefined), 'active');
  });
});
