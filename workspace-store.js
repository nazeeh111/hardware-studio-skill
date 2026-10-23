export class WorkspaceConflictError extends Error {
  constructor() { super('The saved workspace changed in another tab.'); this.name = 'WorkspaceConflictError'; }
}
// Reject a stale tab before it replaces the workspace read at startup/last save.
// localStorage has no cross-tab transaction: this is not collaborative editing.
export function writeWorkspace(storage, key, expectedRaw, nextRaw) {
  if (storage.getItem(key) !== expectedRaw) throw new WorkspaceConflictError();
  storage.setItem(key, nextRaw);
  return nextRaw;
}
