/**
 * Next-level: is this a plausible extension Options page URL? The
 * extension reports its own options page on the status ping so the
 * app's one-click Pair button knows where to open. Only an
 * extension-scheme URL ending in /options.html is ever stored — the
 * query string (e.g. ?token=…) is ignored for the check.
 *
 * Pure logic, no imports — unit-tested in
 * tests/extension-checkin.test.ts.
 */
export function isValidExtensionOptionsUrl(value: string): boolean {
  return (
    (value.startsWith('chrome-extension://') || value.startsWith('moz-extension://')) &&
    value.split('?')[0].endsWith('/options.html') &&
    value.length <= 512
  )
}
