# DOVIRA v0.7.0 — V22-style redesign test report

Date: 2026-11-22. Version bumped to **0.7.0** in `package.json` and
`extension/manifest.json`. Branch: main. All verification below ran against
the **packaged** Windows build (`dist-v07\win-unpacked\dovira.exe`, temp
profile `D:\temp\dovira-v07-profile`), driven over CDP — not just `npm run
build`. The live installed app was never touched.

## 1. Design tokens (Mint light / dark)

Light theme is now the default. All values live in
`src/renderer/src/assets/main.css` (`:root` = light, `[data-theme='dark']` =
dark); components use only `var(--…)` tokens, no hardcoded hex.

| Token | Light (Mint) | Dark |
| --- | --- | --- |
| `--bg` | `#edf4ee` | (unchanged dark bg) |
| `--surface` | `#ffffff` | (unchanged) |
| `--surface-2` | `#e2efe7` | (unchanged) |
| `--border` | `#d7e4db` | (unchanged) |
| `--text` | `#122b21` | (unchanged) |
| `--muted` | `#5f7268` | (unchanged) |
| `--accent` | `#12805c` (teal) | (unchanged) |
| `--accent-hover` | `#0e6a4c` | (unchanged) |
| `--accent-orange` | `#f2994a` | (unchanged) |
| `--accent-orange-hover` | `#e8833a` | (unchanged) |
| `--sidebar-bg` | `#0f3d2e` (dark emerald, both themes) | same |
| `--sidebar-text` | `#b9d8c9` | same |
| `--sidebar-muted` | `#8fb8a6` | same |
| `--sidebar-hover-bg` / `--sidebar-active-bg` | `#1d5c46` | same |
| `--sidebar-active-text` | `#c9f2dd` | same |
| Banner gradient | `#0f3d2e` → `#145c42` (both themes) | same |

Radii: card 16px, button 10px, input 11px, nav-item 9px, thumbnail 10px.
Light cards get a stronger shadow than before.

Deviations from the plan (code wins, recorded here):

1. `.nav-item` is shared by the Sidebar **and** SettingsPage's section nav,
   so the global class was NOT switched to sidebar vars (that would have
   broken SettingsPage). Scoped `.sidebar.nav-item` overrides were added
   instead. `.sidebar-section` is Sidebar-only and was switched as planned.
2. Muted text: the plan's `#6b7f75` computes to ~4.3:1 on white (below WCAG
   AA 4.5:1), so the plan's own fallback `#5f7268` (~5.1:1) was used
   directly. Confirmed readable in the screenshots (§5).
3. StatsRow peak: a `useRef` read during render trips eslint
   `react-hooks/refs`; `useState` + `setPeak` in an effect trips
   `react-hooks/set-state-in-effect`. Final fix is the documented React
   pattern — render-time adjustment (`if (currentSpeed > peak)
   setPeak(currentSpeed)`).
4. App.tsx JSX: the first restructure missed the inner ternary's closing
   `)` (Prettier `')' expected` at line 347) — fixed by adding `)}` after
   the list fragment.

## 2. What changed per screen

- **Home (all views):** emerald banner with the tagline "Download Smarter.
  Go Further." + an orange "নতুন ডাউনলোড" button (opens the Add dialog).
  Below it, a 4-card stats row (only when downloads exist): Today
  (completed today), Current speed (sum of `speedBps` of downloading),
  Active (downloading count), Total size (`formatBytes` of completed
  `totalBytes`). Each card has a progress bar (speed bar orange, others
  teal). The empty state drops the tagline line (the banner carries it)
  and gains a Site Grabber button + a Ctrl+V hint.
- **Header:** the Add button is now orange (`btn-accent`, dark text
  `#1c2b22` on orange). The theme quick-toggle was first placed in the
  header, then **moved to the sidebar bottom** (§4 — the header only
  renders on Home, so the toggle was unreachable from Settings/History).
- **Sidebar:** dark emerald in both themes; logo title/version/tagline and
  count pills use the new `--sidebar-*` vars. Bottom row is now
  [Settings nav-item] + [theme toggle button] (sun in dark, moon in
  light). Version label reads `v{appInfo?.version ?? '0.7.0'}` — the
  fallback was `'0.6.0'` and flashed on every cold launch before init;
  fixed to `'0.7.0'` (verified by probe 8, §3).
- **Download card:** unchanged visually, except it now renders inside the
  banner + stats layout. (Its selector fix is §6.)
- **Settings:** unchanged layout; the theme selector label was polished to
  "Light · Mint" / "লাইট · মিন্ট". Settings renders correctly in both
  themes (§5).
- **Add Download dialog:** unchanged layout; renders correctly in Mint
  with a real fetched thumbnail (§5).
- **New icons:** `IconSun` (circle + 8 rays) and `IconMoon` (crescent) in
  `components/icons.tsx`.
- **New i18n keys (7, both languages, 327/327, key sets and order equal):**
  `banner.cta`, `empty.grabber`, `stats.active`, `stats.speed`,
  `stats.today`, `stats.totalSize`, `theme.toggle`.

## 3. Theme toggle + one-time migration

- **Toggle:** one button, always visible in the sidebar bottom (all views:
  Home, History, Settings). Click flips explicit light ↔ dark. Measured
  latency (probe 7, rewritten): Home 232 ms, Settings 214 ms (data-theme,
  Settings select, and stored setting all flip together), Settings again
  256 ms. Persisted via `updateSettings` → SQLite; verified across
  restart (phase 1 P21, phase 2 M5).
- **Migration (first 0.7.0 launch):** `Settings.themeMigrated070: boolean`
  added (`src/main/types.ts`). Default theme is now `'light'`
  (`DEFAULT_SETTINGS`), flag defaults to `false`. On launch, if the flag
  is false, the stored theme is forced to `'light'` and the flag is set
  true and persisted — so a v0.6.x user whose stored theme was `'dark'`
  gets Mint once. After that, the user's own choice is never re-flipped.
  Verified by phase 2 (§4): seeded DB `theme='"dark"'`,
  `themeMigrated070=false` → first launch reads light, flag true; toggle
  to dark, relaunch → still dark.
- **System theme:** `settings.theme === 'system'` still resolves via
  `matchMedia('(prefers-color-scheme: dark)')` (effectiveTheme in App and
  Sidebar).

## 4. Verification runs (packaged build, temp profile)

Builds (all `npm run typecheck` 0 errors, `npm run build` PASS,
`npx electron-builder --win --config electron-builder-v07.yml` exit 0):

| Build | Installer | asar | Note |
| --- | --- | --- | --- |
| Fix build 1 | 237,363,753 B | 4,251,832 B / 328 files | React #185 fix |
| Fix build 2 | 237,363,849 B | 4,252,586 B / 398 files | Toggle moved to sidebar |
| **Final build 3** | **237,363,919 B** | **4,252,586 B** | Version-fallback fix (same-length string, asar size unchanged) |

Final build asar: 0 project-`dist/` entries, temp config not included,
`out/renderer/index.html` present, 9 extension files under
`resources/extension/`, all 5 binaries unpacked in
`app.asar.unpacked\resources\bin\win\` (aria2c, deno, ffmpeg, ffprobe,
yt-dlp). `npx eslint src` clean; Prettier clean on all 12 touched files;
0 CRLF in all touched files.

### Phase 1 — full regression, final build (22/22 PASS)

Driver `test-v07.mjs`, fresh profile. Hydration 5,167 ms. P1 nav renders,
P1b hydrates, P2 fresh profile defaults to Mint light, P3 CSP
`img-src 'self' data: https:` intact (v0.6.2 fix), P4 emerald banner,
P5 orange Add, P6 empty state, P7 Site Grabber button, P8 toggle→dark,
P9 toggle→light, P10 fetchInfo plain URL ok:true + thumbnail
`https://i.ytimg.com/vi_webp/UHxTJ91SJIU/maxresdefault.webp`, P11
fetchInfo mix URL ok:true (same title, v0.6.1 not regressed), P12 dialog
thumbnail naturalWidth=1280, P13 360p row, P14 Download click, P15 real
360p completes → `C:\Users\Khalid\Downloads\DOVIRA\Shudhu Tomake (Lyrics)
Song FRANKLIN শুধু তোমাকে Soft Song Lyrics (9).mp4`, P16 file exists
6,975,685 B, P17 stats `["1","0 KB/s","0","4.5 MB"]`, P18 Settings renders
in dark, P19 Settings theme select = dark, **P20 toggle back to light
from the Settings view** (failed on build 1 — see §4 note), P21 theme
persists across restart (light). Two earlier full runs on builds 1–2 also
passed 21/22 and 22/22 (the 21/22 run failed only P20).

P20 note: on build 1 the header toggle did not exist on the Settings view
(the header only renders on Home — `App.tsx` line 154:
`view === 'settings' ? <SettingsPage/> : view === 'history' ?
<HistoryPage/> : <> <header>…`), so the P20 click hit nothing and the
theme stayed dark. The toggle was moved to the sidebar bottom (always
rendered); P20 passes on builds 2–3. The earlier "P21 read light" after
the failed P20 was a pre-hydration false reading (settings null →
effectiveTheme fallback `'light'`) — see the M5 note below.

### Phase 2 — migration (M1–M5, all PASS)

Seeded the temp profile DB (`dovira.db`, settings key/value table) with
`theme='"dark"'` + `themeMigrated070=false`, simulating a v0.6.x user.
M1 app renders, M2 stored dark migrated to Mint light (`theme=light`),
M3 `settings.theme='light'` + `themeMigrated070=true`, M4 toggle→dark,
M5 dark persists across restart (no re-flip). M5 first read FAIL in the
driver (it read `data-theme` as soon as nav items appeared, before init
settled — the pre-hydration fallback reads `'light'` while the stored
value was already `'dark'`). Re-checked with a settled read
(`m5-recheck.mjs`): early `data-theme=light, stored=dark`; settled
`data-theme=dark, stored={theme: dark, flag: true}` — **M5 passes**.
Lesson: never read `data-theme` before hydration; wait for the banner +
no `লোড হচ্ছে…`.

### Probes

- **Probe 5 (post-completion watch, build 1):** after the #185 fix, root
  stayed 13,846 chars of innerHTML for the full 20 s watch (T+0/5/10/20),
  body 616 chars, 0 renderer errors, 0 window errors.
- **Probe 6 (continuous root monitor):** tree died 0.678 s after the ADD
  click while still downloading — proved the crash was at card render,
  not at completion.
- **Probe 7 (toggle latency, rewritten):** sidebar toggle present on Home
  and Settings; Home 232 ms, Settings 214 ms (theme + select + stored
  together), Settings again 256 ms.
- **Probe 8 (version label):** early (pre-hydration) `v0.7.0 · Phase 7`,
  settled `v0.7.0 · Phase 7` — the fallback fix works.

## 5. Screenshot evidence (viewed by the agent)

All in `~/workspace/dovira-v07/shots-fix/` (pulled from the laptop).
Inspected for contrast/readability (esp. Bengali), clipped text, broken
layout, invisible buttons, unreadable stats:

- `home-empty-light.png` — Mint: emerald sidebar, banner + orange CTA,
  empty card ("এখনো কোনো ডাউনলোড নেই", "লিংক পেস্ট করো" + "সাইট
  গ্র্যাবার" + Ctrl+V), moon toggle in sidebar bottom. Clean.
- `home-empty-dark.png` — dark empty state, banner + CTA, sun toggle.
  Clean.
- `home-downloads-light.png` — Mint with a completed download: 4 stat
  cards (আজ 1, বর্তমান গতি 0 KB/s, চলছে 0, মোট সাইজ 4.5 MB) all
  readable; card shows thumbnail, title, "4.5 MB", green "শেষ" badge,
  date, actions; progress bar full teal; "100% · 6.7 MB / 4.5 MB".
  Clean.
- `home-downloads-dark.png` — same in dark (blue progress bar, green
  badge, toast "সেটিংস সংরক্ষিত হয়েছে" visible). Clean.
- `dialog-light.png` — Add dialog in Mint: URL input, fetched thumbnail
  (cover art, 04:36), title, quality rows 1080p (~18.9 MB, selected) /
  720p / 480p / 360p (~7.2 MB), checkboxes, save path, বাতিল/ডাউনলোড.
  Clean.
- `settings-light.png` — Settings in Mint: white cards, pale inputs,
  "সীমা নেই" pill selected, readable everywhere; sun toggle in sidebar
  (the gear-like icon beside "সেটিংস" is the pre-existing IconSettings).
  Clean. A transient "সেটিংস সংরক্ষিত হয়েছে" toast briefly overlaps the
  clipboard description — standard toast behaviour, dismisses itself.
- `settings-dark.png` — Settings in dark. Clean.
- `migration-light.png` — seeded-dark profile after migration: Mint
  chrome (sidebar + toggle moon) while still loading. Taken mid-hydration,
  so it shows the loading text and the version fallback — which is how the
  stale `'0.6.0'` fallback was caught and fixed.
- `probe5-t0/t10/t20.png` — post-completion UI alive at 0/10/20 s (no
  blank app).

Fixed from screenshot review: (1) theme toggle moved from the header to
the sidebar bottom (unreachable from Settings/History); (2) sidebar
version fallback `'0.6.0'` → `'0.7.0'`.

## 6. The React #185 blank-app bug — found and fixed in this task

**Symptom:** after adding a download in the packaged v0.7.0 build, the
whole app went blank (root innerHTML length 0, body empty, nav items 0).
The download itself still completed (main-process data). First seen as 4
black screenshots (4,718 B each) in a phase-1 run.

**Root cause (proven):** `src/renderer/src/components/DownloadCard.tsx`
had `const samples = useStore((s) => s.speedHistory[d.id] ?? [])`. When a
download has no speed samples yet, the selector returns a brand-new `[]`
on every call. Zustand v5's `useStore` uses `useSyncExternalStore`, which
compares snapshots with `Object.is` — a new array each time is never
equal, so React re-renders, returns another new `[]`, and so on. After 50
nested updates React throws error #185 ("Maximum update depth exceeded")
and unmounts the entire tree. Full stack captured via a `window.onerror`
hook: `getRootForUpdatedFiber → enqueueConcurrentRenderForLane →
forceStoreRerender → updateStoreInstance → commitHookEffectListMount →
commitPassiveMountOnFiber → recursivelyTraversePassiveMountEffects`. No
reload, no console errors (production React reports it as an uncaught
error).

**Bisect:** disabling StatsRow in App.tsx reproduced the crash
identically — StatsRow is NOT the cause. Bisect fully reverted.

**Pre-existing, not caused by the redesign:** the `?? []` selector
predates v0.7.0. It was never caught because no earlier check rendered a
download card in the UI — v0.6.0 Phase 7 verified downloads via
main-process data only; v0.6.1/v0.6.2 checks verified fetchInfo +
thumbnail only. (Whether the user's own live v0.6.x app blanked on
download is UNCONFIRMED — do not assert it.)

**Fix:** module-level `const EMPTY_SPEED_SAMPLES: number[] = []` in
DownloadCard.tsx; selector now `?? EMPTY_SPEED_SAMPLES`. `samples` is
only read (`samples.length > 0`, `speedGraphPolyline(samples, 100, 36)` —
pure), never mutated, so a shared stable empty array is safe. No other
`?? []` / `?? {}` selectors exist in the renderer (all other `useStore`
selectors are direct property accesses).

**Verification:** probe 5 re-run + full phase-1 re-runs on the fixed
builds: 22/22 PASS, root stable for the full 20 s watch after a real
download completes.

## 7. Known quirks (not blockers)

- **Stats "Total size" 4.5 MB vs file on disk 6,975,685 B (6.7 MB):**
  `totalBytes` is the yt-dlp-reported size (video-only stream; the audio
  stream merges after), so the card reads "100% · 6.7 MB / 4.5 MB"
  (doneBytes > totalBytes). Pre-existing engine reporting, not a StatsRow
  invention.
- **Hydration takes ~3.5–7.6 s on a cold launch** (probe: 4,030 ms;
  phase 1: 3,472 / 7,634 / 4,961 / 5,167 ms). Checks must wait for the
  banner + settled list, not a fixed 1.5 s sleep. The loading text is
  `লোড হচ্ছে…` (WITH ellipsis U+2026); the sidebar item `ডাউনলোড হচ্ছে`
  contains `লোড হচ্ছে` as a substring — a bare-substring check is true
  forever. Always use the ellipsis form.
- **Theme-toggle-during-hydration race:** toggling before `init()` settles
  can be overwritten by init's in-flight `set()` with stale settings.
  Once hydrated the toggle flips in ~200 ms.
- **`npm run lint` is `eslint --cache .`** and lints the whole tree
  INCLUDING the temp build dir — once `dist-v07/` exists it reports 459
  problems (43 errors, 416 warnings), all in
  `dist-v07\win-unpacked\resources\extension\*.js` (packaged copies of the
  extension sources). Not a source problem. Delete `dist-v07/` before the
  final lint/commit, or lint `src/` only.
- **M5 driver false negative** (§4): read `data-theme` only after
  hydration.

## 8. Files changed

```
extension/manifest.json                     version 0.6.2 → 0.7.0
package.json                                version 0.6.2 → 0.7.0
src/main/settings.ts                        DEFAULT theme 'dark' → 'light';
                                            themeMigrated070 flag + one-time migration
src/main/types.ts                           Settings.themeMigrated070: boolean
src/renderer/src/App.tsx                    banner + StatsRow, orange Add,
                                            theme effect (effectiveTheme), empty-state
                                            Site Grabber button; header toggle removed
                                            (moved to Sidebar)
src/renderer/src/assets/main.css            Mint tokens, sidebar/orange/banner vars,
                                            radii, shadows, .btn-accent, .banner,
                                            .stat-card/*, .sidebar.nav-item overrides
src/renderer/src/components/DownloadCard.tsx  EMPTY_SPEED_SAMPLES fix (§6)
src/renderer/src/components/Sidebar.tsx     sidebar vars, theme toggle (bottom),
                                            version fallback '0.7.0'
src/renderer/src/components/StatsRow.tsx    NEW — 4 stat cards + bars
src/renderer/src/components/icons.tsx       IconSun + IconMoon
src/renderer/src/i18n/bn.json               7 new keys, 327/327
src/renderer/src/i18n/en.json               7 new keys, 327/327
docs/v07-redesign-test.md                   NEW — this file
```

Temp files NOT committed (deleted before commit): `electron-builder-v07.yml`,
`dist-v07/` (temp packaged build).

## 9. Not verified (user's own check is the final word)

- The redesign on the user's real machine / real data (the temp profile
  had only test downloads). In particular: the migration flip on his real
  profile (stored dark → Mint on first 0.7.0 launch) and the stats row
  with his real download history.
- The "Total size" quirk (§7) on a real multi-file history.
- History view in Mint (not screenshotted — same tokens as Home; the
  sidebar toggle is verified there by construction, not by screenshot).
