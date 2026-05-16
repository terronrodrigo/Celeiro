/** IDs de entidade: UUID (Postgres) ou ObjectId (Mongo legado). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isValidEntityId(id) {
  const s = String(id || '').trim();
  return UUID_RE.test(s) || OBJECT_ID_RE.test(s);
}
