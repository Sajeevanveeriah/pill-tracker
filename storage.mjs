import {emptyState, validateState} from './inventory.mjs';
export const KEY = 'sv-pill-tracker:v1';
export const LOCK = 'sv-pill-tracker-write';
export function read(store) {
  let raw = null;
  try { raw = store.getItem(KEY); }
  catch { return {raw, state: null, error: 'Browser storage is unavailable. Changes cannot be saved in this browser.'}; }
  if (raw === null) return {raw, state: emptyState(), error: null};
  try { return {raw, state: validateState(JSON.parse(raw)), error: null}; }
  catch { return {raw, state: null, error: 'Saved data could not be read. It has not been changed. Export the original data or restore a valid backup in Settings.'}; }
}
/** Synchronous read/check/write; callers use Web Locks when available. */
export function write(store, input, expectedRaw) {
  const state = validateState(input);
  let current;
  try { current = store.getItem(KEY); }
  catch { throw new Error('Not saved. Browser storage is unavailable.'); }
  if (current !== expectedRaw) throw new Error('Not saved: another tab changed the stack. Close this form, then reopen it to use the latest values.');
  let previousRevision = 0;
  if (current !== null) {
    try { previousRevision = validateState(JSON.parse(current)).revision; } catch { /* Explicit restore may replace damaged data. */ }
  }
  state.revision = Math.max(state.revision, previousRevision) + 1;
  const raw = JSON.stringify(validateState(state));
  try {
    store.setItem(KEY, raw);
    if (store.getItem(KEY) !== raw) throw new Error('Write was not retained.');
  } catch { throw new Error('Not saved. Browser storage is blocked or full. Your last saved data has not been intentionally replaced; export a backup before clearing any site data.'); }
  return {state, raw};
}
export function parseBackup(value) {
  if (typeof value !== 'string' || value.length > 1048576) throw new Error('Choose a JSON backup smaller than 1 MB.');
  let input;
  try { input = JSON.parse(value); }
  catch { throw new Error('Choose a valid JSON backup exported by Pill-Tracker.'); }
  return validateState(input);
}
