/** Inventory arithmetic only. No clinical, prescribing or dose-taking decisions. */
export const VERSION = 1;
export const TIMEZONE = 'Australia/Melbourne';
export const MAX_STOCK = 100000;
const DAY_MS = 86400000;
const fail = (message) => { throw new Error(message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(value, label, max, optional = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) fail(`Check ${label.toLowerCase()} (up to ${max} characters).`);
  return result;
}
export function quantity(value, label = 'Quantity', allowZero = true, max = MAX_STOCK) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (allowZero ? 0 : 0.25) || value > max || !Number.isInteger(value * 4)) {
    fail(`${label} must be ${allowZero ? '0' : '0.25'} to ${max}, in steps of 0.25.`);
  }
  return value;
}
function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Use a valid calendar date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '9998-12-31') fail('Use a valid calendar date.');
  return date.getTime() / DAY_MS;
}
export function daysBetween(from, to) { return dateNumber(to) - dateNumber(from); }
export function addDays(day, number) {
  if (!Number.isSafeInteger(number)) fail('Days must be a whole number.');
  const result = new Date((dateNumber(day) + number) * DAY_MS).toISOString().slice(0, 10);
  dateNumber(result);
  return result;
}
export function todayInMelbourne(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-AU', {timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const p = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validateMedicine(input) {
  if (!object(input)) fail('Invalid medication entry.');
  const id = text(input.id, 'ID', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Invalid medication ID.');
  if (!['daily', 'manual'].includes(input.mode)) fail('Choose daily estimate or manual tracking.');
  dateNumber(input.countedOn);
  if (input.countedOn < '2000-01-01' || input.countedOn > '2100-12-31') fail('Count dates must be between 2000 and 2100.');
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 90) fail('Refill notice must be 0 to 90 whole days.');
  if (typeof input.ordered !== 'boolean') fail('Invalid order status.');
  const dailyUse = quantity(input.dailyUse, 'Daily use', input.mode === 'manual', 1000);
  if (input.mode === 'manual' && dailyUse !== 0) fail('Manual tracking must not assume daily use.');
  return {id, name: text(input.name, 'Medication name', 80), strength: text(input.strength, 'Strength', 80, true),
    quantity: quantity(input.quantity), dailyUse, mode: input.mode, countedOn: input.countedOn, leadDays: input.leadDays,
    lowCount: quantity(input.lowCount, 'Low-stock count'), packSize: quantity(input.packSize, 'Pack size'), ordered: input.ordered};
}
export function project(input, day = todayInMelbourne()) {
  const m = validateMedicine(input);
  const elapsed = daysBetween(m.countedOn, day);
  const remaining = Math.max(0, (m.quantity * 4 - (m.mode === 'daily' ? Math.max(0, elapsed) * m.dailyUse * 4 : 0)) / 4);
  const daysLeft = m.mode === 'daily' ? Math.floor(remaining * 4 / (m.dailyUse * 4)) : null;
  return {remaining, daysLeft, clockWarning: elapsed < 0,
    needsRefill: daysLeft === null ? remaining <= m.lowCount : daysLeft <= m.leadDays,
    firstShortDay: daysLeft === null || elapsed < 0 ? null : addDays(m.countedOn, Math.floor(m.quantity * 4 / (m.dailyUse * 4)) + 1),
    refillOn: daysLeft === null || elapsed < 0 ? null : addDays(m.countedOn, Math.floor(m.quantity * 4 / (m.dailyUse * 4)) - m.leadDays)};
}
export function updateStock(input, action, amount, day = todayInMelbourne()) {
  const m = validateMedicine(input);
  quantity(amount, 'Amount', action === 'count');
  const current = project(m, day).remaining;
  if (action === 'use' && m.mode !== 'manual') fail('Daily estimates already account for use. Recount instead.');
  if (action === 'use' && amount > current) fail('Used amount cannot exceed the recorded stock.');
  if (!['count', 'refill', 'use'].includes(action)) fail('Choose a stock action.');
  const next = action === 'count' ? amount : (current * 4 + (action === 'refill' ? 1 : -1) * amount * 4) / 4;
  return validateMedicine({...m, quantity: next, countedOn: day, ordered: action === 'refill' ? false : m.ordered});
}
export function emptyState() { return {version: VERSION, revision: 0, theme: 'light', medicines: [], history: []}; }
export function validateState(input) {
  if (!object(input) || input.version !== VERSION) fail('This is not a supported Pill-Tracker backup (version 1).');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER) fail('Invalid backup revision.');
  if (!['light', 'dark', 'system'].includes(input.theme)) fail('Invalid appearance setting.');
  if (!Array.isArray(input.medicines) || input.medicines.length > 100) fail('A stack can contain up to 100 medications.');
  const medicines = input.medicines.map(validateMedicine);
  if (new Set(medicines.map(m => m.id)).size !== medicines.length) fail('The backup contains duplicate medication IDs.');
  if (!Array.isArray(input.history) || input.history.length > 100) fail('Invalid history (maximum 100 entries).');
  const history = input.history.map(entry => {
    if (!object(entry)) fail('Invalid history entry.');
    const at = text(entry.at, 'History time', 40);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at))) fail('Invalid history time.');
    return {at, text: text(entry.text, 'History entry', 200)};
  });
  return {version: VERSION, revision: input.revision, theme: input.theme, medicines, history};
}
