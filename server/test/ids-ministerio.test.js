import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEntityId } from '../lib/ids.js';
import { candidaturaMatchesLiderMinisterios, filterCandidaturasForLider } from '../lib/ministerio-match.js';

describe('ids', () => {
  it('aceita UUID e ObjectId', () => {
    assert.ok(isValidEntityId('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(isValidEntityId('507f1f77bcf86cd799439011'));
    assert.ok(!isValidEntityId(''));
    assert.ok(!isValidEntityId('abc'));
  });
});

describe('ministerio-match', () => {
  it('casa ministério parcial', () => {
    assert.ok(candidaturaMatchesLiderMinisterios('Kids / Min. Infantil', ['Kids']));
    assert.ok(!candidaturaMatchesLiderMinisterios('Parking', ['Kids']));
  });

  it('filtra lista para líder', () => {
    const list = [
      { ministerio: 'Kids' },
      { ministerio: 'Parking' },
    ];
    const out = filterCandidaturasForLider(list, ['Kids']);
    assert.equal(out.length, 1);
  });
});
