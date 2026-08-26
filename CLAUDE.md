# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## What this is

JLPTドリル — a static, browser-only multiple-choice reading quiz for JLPT
kanji and compound words (N5–N1). Plain HTML/CSS/JS, **no framework, no
build step, no `package.json`**. Designed to run as-is on GitHub Pages. The
quiz engine (adaptive question selection, adaptive distractors, spaced-
repetition review) is carried over unmodified from the sibling
[kanji-drill](../kanji-drill) repo — see README.md for what it does from a
user's perspective.

## Commands

```bash
# Serve locally (required — data is loaded via fetch(), which file:// blocks)
python3 -m http.server 8000

# Run the test suites (Node built-ins only, no deps)
node js/learning/distractors/__tests__/run-tests.js
node js/learning/review/__tests__/run-tests.js
```

## Architecture

### Script loading — order matters, there's no bundler

Every JS file is a plain `<script>` tag in `index.html`, loaded in
dependency order, sharing the global scope. When adding a module: add its
`<script src="...">` before `js/app.js` in `index.html`, and add its path
to `CORE_ASSETS` in `sw.js` (an explicit precache list, not a glob — a
forgotten entry 404s silently for offline/installed users). Bump
`CACHE_VERSION` in `sw.js` when changing any cached file.

### Layers

```
index.html              Markup + script load order
js/settings.js           SettingsManager — localStorage: jlpt-quiz-settings
js/progress.js           ProgressManager — localStorage: jlpt-quiz-progress
js/progress-view.js      ProgressView — read-only rendering of ProgressManager data
js/learning/             Adaptive Learning Engine — unmodified from kanji-drill
js/learning/review/      ReviewScheduler — spaced-repetition intervals
js/learning/distractors/ Adaptive Distractor Generator
js/app.js                Screen navigation, quiz flow, keyboard/arrow nav, DOM wiring
data/kanji-nN.json        Kanji + on'yomi/kun'yomi/meaning/compounds pool, N=1..5, mode "kanji"
data/compounds-nN.json    Compound word + reading/accent/meaning pool, N=1..5, mode "word"
sw.js                    Service worker; CORE_ASSETS must mirror index.html's script list
```

Storage keys were deliberately renamed from kanji-drill's
(`kanji-drill-progress`/`kanji-drill-settings` → `jlpt-quiz-progress`/
`jlpt-quiz-settings`) and the service worker cache name changed
(`jlpt-quiz-vN`) — this app can be deployed under the same origin as
kanji-drill/kotoba (e.g. GitHub Pages user site with per-repo paths), and
localStorage/Cache Storage are per-*origin*, not per-path. **Never reuse a
storage key or cache name from a sibling app.**

`ProgressManager` is the only module allowed to touch `localStorage` for
progress; `SettingsManager` is the only one for preferences. Same
memoized-snapshot-vs-fresh-load split as kanji-drill: read-only getters use
`readSnapshot()`, write paths use `load()`.

### Modes and levels

The `mode`/`grade` vocabulary is inherited from kanji-drill: `mode` is
`'kanji'` or `'word'` (the latter labeled 熟語/Compound Words in the UI),
`grade` is the JLPT level *number* (1–5, matching N1–N5 — **not**
elementary-school grade). `MODE_FILE_PREFIX` in `app.js` maps mode →
`kanji-n`/`compounds-n`, so `loadData('kanji', 5)` fetches
`data/kanji-n5.json`. Level buttons list N5→N1 in the DOM (easiest first)
but `data-grade` holds the raw JLPT number, so keyboard shortcuts 1–5 map
directly to N1–N5.

Sentence mode (present in kanji-drill) was removed entirely — this app only
ever asked for two modes, and stripping it out means no dead
`sentence`-branch code paths to keep in sync.

### Adaptive Learning Engine, review scheduling, distractor generation

Unmodified from kanji-drill except two data-shape adaptations — see that
repo's CLAUDE.md/README for the full design rationale (strategy-pattern
pipelines, SM-2-style interval ladder, `SimilarityFeatures`). The two
adaptations:

1. **`maxCandidates` raised to 20000** (`DistractorConfig.js`). kanji-drill
   sized this cap to its own largest pool (~560 candidates); this dataset's
   cumulative review pools ~10,000 compound candidates across N1–N5 at
   once. Undersizing this cap silently truncates the candidate pool to an
   early array slice and collapses distractor variety — see the comment in
   `DistractorConfig.js` before lowering it.
2. **`frequency` wired to real data.** kanji-drill's dataset had no
   frequency field, so `SimilarityFeatures`' frequency-similarity term was
   permanently 0. `data/kanji-n*.json` carries KANJIDIC's `freq` corpus
   rank, so `DistractorGenerator.buildCandidatePool` reads `entry.freq` and
   `app.js`'s `buildQuestion` reads `target.freq` — nearby-frequency kanji
   now score as more plausible distractors. Compound entries have no
   `freq`, so this stays 0 for compound-mode questions, same as before.

### Questions are built lazily, one at a time — this is load-bearing

`app.js` does **not** pre-build a round's questions upfront the way it might
look natural to (`state.questions = picks.map(buildQuestion)`, run once at
round start). It used to, during development, and that was a real bug: for
kanji-drill's original ~2,136-item cumulative pool it was invisible, but
this dataset's largest pools are much bigger (N1 compounds ~4,100 items;
cumulative compound review ~10,000), and both `QuestionSelector.select()`
and `DistractorGenerator.generate()` are O(pool size) *per call*. Building
every question in an "all"-sized round upfront measured at **multiple
minutes of blocked main thread before the first question even appeared** —
for cumulative review, over 15.

The fix: `startRound()` only computes `state.remainingPool` (candidates) and
`state.roundTotal` (target count). `renderQuestion()` picks and builds
exactly one question — `QuestionSelector.select()` then
`buildQuestion()`/`DistractorGenerator.generate()` — immediately before
showing it, storing it as `state.currentQuestion` (there is no
`state.questions` array). Measured per-question cost against the real N1/
cumulative data: ~50–160ms, imperceptible as a single transition. Total CPU
cost across a full round is unchanged — it's just spread across the time
the learner spends actually answering instead of front-loaded — which is
exactly what fixes the freeze. If you're tempted to "simplify" this back to
an eager `.map()`, don't; re-run the perf check first (build a
`QuestionSelector`+`DistractorGenerator` pool from `data/compounds-n1.json`
in a `vm` context, as the test harnesses below already know how to load, and
time `generate()` in a loop).

### Post-answer detail panel

`renderDetail()` in `app.js` (wired into `handleAnswer`, target
`#quiz-detail`) is the one piece of UI with no kanji-drill equivalent. It
surfaces on'yomi/kun'yomi (shown separately, unlike the combined `readings`
array used for quizzing), stroke count, an example sentence, and a handful
of pitch-accented compounds for kanji mode; pitch accent and source kanji
for compound mode. It only renders *after* an answer is graded — on'yomi/
kun'yomi or the accent number would otherwise give the correct choice away
before the question is answered.

### Auto-advance vs. tap/press-to-continue

`SettingsManager`'s `autoNext` (default **off**) picks between two ways of
moving past a graded answer:

- **On**: the original kanji-drill behavior — `setTimeout(advanceQuestion,
  isCorrect ? 900 : 2400)`.
- **Off** (default): `armContinue()` swaps the instruction line to a
  "tap/press any key to continue" prompt and waits — `state.awaitingContinue`
  gates a keydown check (top of the global `keydown` listener) and a
  document-level one-shot click listener (`onContinueClick`). Added because
  a fixed timer is always wrong for someone: too short to read the detail
  panel's compound list, too long for a bare N5 kanji.

The click listener is registered via `setTimeout(..., 0)`, not directly
inside `armContinue()` — the click that answered the question is still
bubbling up to `document` when `armContinue()` runs (it's called from
`handleAnswer()`, itself called from the option button's own click handler),
so attaching synchronously would let that same click immediately satisfy its
own continue gate. Deferring registration by one tick sidesteps that. Every
screen transition (`showScreen()`) calls `cancelContinue()` first, so
quitting mid-reveal can't leave a stale listener that re-renders a question
the learner already backed out of.

### HTML-escaping data-sourced strings

Most innerHTML template literals in `app.js` interpolate plain-text fields
straight from the exported dataset (meanings, example sentences, compound
glosses) — `escapeHTML()` wraps every one of them. This isn't defensive
theater: real entries contain a bare `&` (e.g. kanji 張, N1: "counter for
bows & stringed instruments..."), which is invalid HTML and can swallow
subsequent content. Anywhere a raw data string is about to join an
`innerHTML` string (not `textContent`, which needs no escaping — `quiz-kanji`
and `quiz-meaning` use it and are fine as-is), route it through
`escapeHTML()` first, at the leaf/raw-text level — `readingHTML()` already
returns pre-built markup (a `<span class="okurigana">` wrapper), so escape
the raw pieces before wrapping, not the assembled result.

### Data shape (see vendor/kanji-data/scripts/export_jlpt_web.py)

`data/kanji-nN.json`: `{ kanji, onyomi: [...], kunyomi: [...], readings: [...],
meaning, strokes, freq, sentence, compounds: [{word, reading, accent, meaning}] }`.
`readings` (used for quizzing) excludes bound/affix-only forms like `"ひと-"`
that aren't standalone pronunciations — `onyomi`/`kunyomi` keep them for
display. `accent` is the kanjium pitch-accent pattern number as a string
(e.g. `"0"`, `"2,3"` when a word has more than one accepted pattern); `null`
when the accent lookup missed (~21% of compounds).

`data/compounds-nN.json`: `{ word, reading, readings: [reading], accent,
meaning, sourceKanji: [...] }`, deduped by (word, reading) within a level;
`sourceKanji` is every kanji in that level whose entry listed this compound.

Deliberately `sourceKanji`, not `kanji`: `itemText()` in `app.js` (and in
`DistractorGenerator.js`) does `entry.kanji ?? entry.word` to tell a
kanji-mode entry from a compound-mode one apart. A compound entry named
`kanji` would win that check and the quiz would display/identify the entry
by its source-kanji array instead of the actual word — this bit once during
development (a compound rendered as a single stray kanji character). Don't
reintroduce a `kanji` field on compound entries.

### Progress/settings storage keys

- `jlpt-quiz-progress` — per-question stats, per-level totals, answer
  history, per-question confusion counts.
- `jlpt-quiz-settings` — `showMeaning`, `roundSize`, `autoNext`, `playAudio`,
  `showDetail`. `showDetail` (default on) gates the post-answer detail panel
  (see `renderDetail`); while it's on, `SettingsManager.get('autoNext')`
  resolves to `false` at read time (never persisted), since the panel needs
  more reading time than auto-advance's timer allows.

Both are versioned, defensively-parsed JSON blobs (see `load()` in each
file) — preserve that pattern when extending either shape.
