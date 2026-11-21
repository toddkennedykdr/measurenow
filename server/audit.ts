export type AuditAction = 'disable' | 'enable' | 'email-change' | 'reset-link';

/** One structured line. Ids and the action only — never a name, email, token, or link. */
export function auditAdmin(actorId: number, targetId: number, action: AuditAction) {
  console.log(JSON.stringify({
    type: 'audit',
    actorId: Number(actorId),
    targetId: Number(targetId),
    action,
    at: new Date().toISOString(),
  }));
}
