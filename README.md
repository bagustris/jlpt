# JLPTドリル (JLPT Drill)

A static, browser-only multiple-choice quiz for JLPT kanji and compound
words (熟語), levels N5 through N1. Plain HTML/CSS/JS, no framework, no
build step — designed to run as-is on GitHub Pages.

Three quiz modes:

- **漢字 Kanji** — given a kanji, choose its correct reading.
- **熟語 Compound Words** — given a compound word, choose its correct
  reading.
- **逆引き Reverse** — the mirror direction: given a reading **and** its
  meaning, choose the matching kanji from four. Tracked as its own skill
  (a separate progress schedule), with distractors picked for reverse
  confusability — homophones sharing the exact reading, then same-first-mora
  and same-meaning kanji.

An optional **読み上げ (Speak the reading aloud)** setting — **off by default**
— reads the reading via the browser's built-in speech synthesis. A kanji you
keep missing is flagged a **にがて (weak spot)** and its meaning is shown as a
hint even when "show meaning" is off.

Each level (N5/N4/N3/N2/N1) can be drilled on its own, plus a cumulative
**ふくしゅう Review** round across every level you've already studied.

After answering, a detail panel reveals everything the dataset carries
beyond the reading itself:

- Kanji mode: on'yomi vs. kun'yomi (shown separately), stroke count, an
  example sentence, and a few compound words that use this kanji — each
  with its kanjium pitch-accent number.
- Compound mode: the word's pitch-accent number and which kanji (from this
  level) it's built from.

By default the app advances to the next question after a short timed pause.
Turn **off** 自動で次へ進む (Auto-advance) in Settings to wait for a tap or
key press instead, so there's no rush reading the detail panel.

## Running locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Data is loaded via `fetch()`, which `file://` blocks — it must be served
over HTTP.

## Running the test suites

```bash
node js/learning/distractors/__tests__/run-tests.js
node js/learning/review/__tests__/run-tests.js
```

These cover the reused adaptive-learning engine (`ReviewScheduler`,
`SpacedRepetitionStrategy`, `DistractorGenerator`) — see CLAUDE.md.

## Data

`data/kanji-n{1-5}.json` and `data/compounds-n{1-5}.json` are generated from
the [kanji-data](https://github.com/bagustris/kanji-data) repo (checked out
here as a submodule at `vendor/kanji-data`) — its JLPT CSVs and
`kanji_metadata.json`, via `vendor/kanji-data/scripts/export_jlpt_web.py`. To
regenerate after updating the source data:

```bash
git submodule update --remote vendor/kanji-data   # pick up upstream changes
python3 vendor/kanji-data/scripts/export_jlpt_web.py \
  --src-dir vendor/kanji-data/kanji --output-dir data
```

This overwrites everything under `data/` here. The script prints fill-rate
and parse-failure diagnostics — check that output before committing new
data.
