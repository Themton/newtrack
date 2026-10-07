export function matchesTracking(number, query) {
  const normalize = value => String(value ?? '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').toLowerCase();
  const q = normalize(query);
  return !q || normalize(number).includes(q);
}
