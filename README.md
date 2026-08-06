# JLPTドリル (JLPT Drill)

A static, browser-only multiple-choice quiz for JLPT kanji and compound
words (熟語), levels N5 through N1. Plain HTML/CSS/JS, no framework, no
build step — designed to run as-is on GitHub Pages.

Two quiz modes:

- **漢字 Kanji** — given a kanji, choose its correct reading.
- **熟語 Compound Words** — given a compound word, choose its correct
  reading.

Each level (N5/N4/N3/N2/N1) can be drilled on its own, plus a cumulative
**ふくしゅう Review** round across every level you've already studied.

After answering, a detail panel reveals everything the dataset carries
beyond the reading itself:

- Kanji mode: on'yomi vs. kun'yomi (shown separately), stroke count, an
  example sentence, and a few compound words that use this kanji — each
  with its kanjium pitch-accent number.
- Compound mode: the word's pitch-accent number and which kanji (from this
  level) it's built from.

By default the app waits for you to tap the card or press any key before
moving to the next question, rather than advancing on a fixed timer, so
there's no rush reading the detail panel. Turn on 自動で次へ進む (Auto-advance)
in Settings to switch back to the old timed behavior.

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

`data/kanji-n{1-5}.json` and `data/compounds-n{1-5}.json` are generated
from the [kanji-slideshow](../kanji-slideshow) repo's JLPT CSVs and
`kanji_metadata.json`, via `kanji-slideshow/export_jlpt_web.py`. To
regenerate after updating the source data:

```bash
cd ../kanji-slideshow
python3 export_jlpt_web.py
```

This overwrites everything under `data/` here. The script prints fill-rate
and parse-failure diagnostics — check that output before committing new
data.
