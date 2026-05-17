import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

describe('register-lider', () => {
  it('server.js importa pgUpsertUserWithPasswordHash usado no cadastro de líder', () => {
    const src = readFileSync(serverPath, 'utf8');
    const importStart = src.indexOf("from './db/postgres/repos.js'");
    assert.ok(importStart > 0, 'import de repos.js');
    const importSection = src.slice(Math.max(0, importStart - 400), importStart + 40);
    assert.match(importSection, /pgUpsertUserWithPasswordHash/);
    assert.match(src, /await pgUpsertUserWithPasswordHash\(/);
  });
});
