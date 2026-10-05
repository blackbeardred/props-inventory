# Tests

Three kinds, all run by GitHub Actions on every push to `main` and every pull
request (`.github/workflows/ci.yml`). A red check there means something broke
before it reached Vercel.

| What | Command | Takes |
|---|---|---|
| Lint | `npm run lint` | ~1 min |
| Types | `npm run typecheck` | ~30 s |
| Unit tests (`src/**/*.test.mjs`, no framework) | `npm run test:unit` | seconds |
| Browser tests (this folder) | `npm run test:e2e` | ~2 min build + ~3 min |
| All of the above | `npm test` | |

## The browser tests

These drive the real app in Chromium, at phone and desktop sizes, with
real touch events for the swipes. Every page, server action and the proxy's
redirect rules are the real code. Only seven modules are swapped (see
`next.config.ts`, under `E2E_FIXTURES`):

- **`fixtures/db.ts`**: an in-memory sample theatre (SPARC: 8 places, 22
  items, *Noises Off!* with three pull-list lines) standing in for Supabase.
  It's put back the way it started before every test (`POST /api/e2e/reset`,
  which is a 404 in any normal build). The browser keeps its own copy, fresh
  on every page load, on `window.__fixtureDB`; files it uploads or removes are
  listed on `window.__storage`. Picture matching (`match_items`) finds nothing
  unless a test sets `window.__matchItems = [{ item_id, similarity }]` first.
- **`fixtures/proxy-session.ts`**: everyone is signed in as the owner, unless
  the request carries an `e2e-signed-out` cookie.
- **`fixtures/see-items.ts`**: the prop-table photo always "contains" the same
  four things, so no Anthropic API call is made.
- **`fixtures/describe-item.ts`**: any photo of a new item reads as "White
  cup" (a file under 200 bytes can't be read), so filling in the add-item
  form from a photo makes no API call either.
- **`fixtures/embedding.ts`**: no 40MB model download.

A fixture build goes to `.next-e2e/`, so it never touches your normal `.next`,
and `next.config.ts` refuses to make one on Vercel.

### Running them on your computer

Once:

```powershell
npm install
npx playwright install chromium
```

Then:

```powershell
npm run test:e2e                       # builds the fixture app, runs everything
npx playwright test e2e/swipes         # one file
npx playwright test -g "edge of the screen"   # tests whose name matches
npx playwright show-report             # what failed, with screenshots and a trace
```

To work on a test without rebuilding each time, run the fixture app in dev
mode in one terminal and the tests in another (Playwright reuses a server
that's already running):

```powershell
$env:E2E_FIXTURES = "1"; npx next dev -p 3100
npx playwright test e2e/inventory
```

The offline test (`offline.spec.ts`) needs the production build, because the
service worker only registers there. It starts its own copy on port 3101 and
stops it to simulate no signal.

### Writing one

Import `test` and `expect` from `./helpers`, not from `@playwright/test`. That
gives you the per-test reset and fails the test if the browser logged an
error. `helpers.ts` also has `PHONE` / `DESKTOP`, `swipe()` (a real finger
drag), `smallTapTargets()`, `tappable()` and `noSidewaysScroll()`.
