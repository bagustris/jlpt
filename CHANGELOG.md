# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version shown in the app's Settings → About panel is read from the latest
entry below (see `loadAppVersion()` in `js/app.js`), so this file is the single
source of truth for the app version.

## [Unreleased]

## [1.1.0] - 2026-08-11

### Added
- Settings toggle **解答後に読み方などを表示 / Show readings & details after
  answering** (on by default) to hide the post-answer detail panel (on'yomi/
  kun'yomi, strokes, example sentence and compound words in kanji mode; pitch
  accent and source kanji in compound mode).

### Fixed
- Opening Settings while a graded answer was waiting for a manual "tap to
  continue" would let that same click fall through to the continue gate and
  skip past the question underneath. The gate now ignores clicks inside the
  settings overlay.

### Changed
- Auto-advance is now suppressed whenever "Show readings & details after
  answering" is on — its timed pause is sized for the reading alone and would
  cut the detail panel off before it can be read. The Settings toggle is
  disabled in that case and the quiz waits for a manual continue; the
  underlying auto-advance preference is preserved and resumes once the detail
  panel is turned off.

## [1.0.0] - 2026-08-09

### Added
- Multiple-choice reading quiz for JLPT kanji and compound words (N5–N1), with
  an adaptive distractor engine that ranks wrong answers by reading/meaning/
  frequency similarity and past confusions.
- Reverse quiz (逆引き: reading + meaning → kanji), tracked as its own
  spaced-repetition skill.
- Optional spoken readings (読み上げ) via the browser's speech synthesis, and
  auto-advance (自動で次へ) with a length-adaptive reveal pause.
- Adaptive learning engine (spaced repetition with per-item intervals, answer
  latency awareness, leech scaffolding for weak spots) and cumulative review
  (ふくしゅう) pooling every studied level.
- Post-answer detail panel surfacing on'yomi/kun'yomi, stroke count, an example
  sentence and pitch-accented compounds.
- Progress dashboard and per-question/per-level history in `localStorage`.
- Installable, offline-capable PWA via a precaching service worker.
- Settings panel (show meaning, spoken readings, auto-advance, round size) and
  an About section.
