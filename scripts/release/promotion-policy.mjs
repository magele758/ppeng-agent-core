/** Reversible image promotion only. Schema-changing releases need an explicit migration/backup plan. */
export async function promoteWithRollback({ candidateImages, previousImages, candidateSchema, stableSchema, activate, probe }) {
  const valid = images => images && ['daemon', 'web'].every(role => /^(?:[a-zA-Z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/.test(images[role] ?? ''));
  if (!valid(candidateImages) || !valid(previousImages)) return { ok: false, rolledBack: false, detail: 'missing verified candidate or previous image IDs; refuse promotion' };
  if (!Number.isInteger(candidateSchema) || !Number.isInteger(stableSchema) || candidateSchema !== stableSchema) {
    return { ok: false, rolledBack: false, detail: 'schema compatibility unknown or changed; explicit migration and backup/restore rehearsal required before promotion' };
  }
  let failure;
  try {
    const activated = await activate(candidateImages);
    if (!activated.ok) throw new Error(activated.detail || 'candidate activation failed');
    if (!(await probe())) throw new Error('post-promotion probes failed');
    return { ok: true, rolledBack: false, previousImages, candidateImages, schemaVersion: stableSchema, detail: 'verified image IDs activated; stable probes passed' };
  } catch (error) { failure = error.message; }
  try {
    const rollback = await activate(previousImages);
    const restored = rollback.ok && await probe();
    return { ok: false, rolledBack: Boolean(restored), previousImages, candidateImages,
      detail: `${failure}; ${restored ? 'previous images restored and probed' : 'rollback failed; operator action required'}` };
  } catch (error) {
    return { ok: false, rolledBack: false, previousImages, candidateImages, detail: `${failure}; rollback failed: ${error.message}` };
  }
}
