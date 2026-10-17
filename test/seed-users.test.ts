import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEED_USERS, seedPasswordFromEnv } from '../server/db/seedUsers';
import { SEED_PASSWORD_DUMMY } from './allowed-literals';
import { assertExact } from './assert-secret';

test('staff users seed only from SEED_<USER>_PASSWORD with no default', () => {
  assert.deepEqual(
    SEED_USERS.map((user) => user.username),
    ['Todd', 'Isaac', 'Rob'],
  );
  for (const user of SEED_USERS) {
    assert.equal(user.passwordEnv, `SEED_${user.username.toUpperCase()}_PASSWORD`);
    assert.equal(Object.hasOwn(user, 'password'), false);
    assert.equal(seedPasswordFromEnv({}, user.passwordEnv), undefined);
    assert.equal(seedPasswordFromEnv({ [user.passwordEnv]: '' }, user.passwordEnv), undefined);
    assert.equal(seedPasswordFromEnv({ [user.passwordEnv]: '   ' }, user.passwordEnv), undefined);
  }
});

test('a seed password is read only from that user variable', () => {
  const todd = seedPasswordFromEnv({ SEED_TODD_PASSWORD: SEED_PASSWORD_DUMMY }, 'SEED_TODD_PASSWORD');
  assertExact(todd, SEED_PASSWORD_DUMMY, 'Todd seed password');
  assert.equal(
    seedPasswordFromEnv({ SEED_TODD_PASSWORD: SEED_PASSWORD_DUMMY }, 'SEED_ISAAC_PASSWORD'),
    undefined,
  );
  assert.equal(
    seedPasswordFromEnv({ SEED_ROB_PASSWORD: SEED_PASSWORD_DUMMY, UNRELATED: SEED_PASSWORD_DUMMY }, 'SEED_ISAAC_PASSWORD'),
    undefined,
  );
});
