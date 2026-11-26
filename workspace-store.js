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

// Standalone workbench files remain separate from project revisions, but their
// competing tabs still need one serialized compare-and-write operation.
export async function writeStandalone(storage, locks, key, expectedRaw, nextRaw, guard=null) {
  if (!locks || typeof locks.request !== 'function') throw new Error('Safe source saving requires Web Locks.');
  return locks.request(`hardware-studio-standalone:${key}`, {mode:'exclusive'}, () => {
    if(guard)guard();
    return writeWorkspace(storage,key,expectedRaw,nextRaw);
  });
}
