// Configuration for the Adaptive Learning Engine's distractor generation.
// Configuration only — no feature-extraction/scoring/selection logic lives
// here. DistractorGenerator and strategies must read every tunable value
// from this object; nothing should be a magic number inside their
// implementations.
//
// To experiment with a different algorithm, implement a new module
// conforming to DistractorStrategy (see js/learning/distractors/DistractorStrategy.js)
// and point `strategy` at it — no other file needs to change.
//
// Deliberately excludes a JLPT-level feature: the level toggle in the UI is
// about vocabulary/kanji scope, not something a learner reasons about while
// picking a reading, so scoring doesn't either. What mirrors real review is
// exactReading/firstMora/meaning similarity plus each learner's own mistake
// history (see weights.confusion below) — with `frequency` (KANJIDIC corpus
// rank) also live for kanji mode, since the exported dataset carries it.
const DistractorConfig = {
  strategy: WeightedDistractorStrategy,

  // Per-feature multipliers in WeightedDistractorStrategy's score formula.
  // `grade` stays dormant at a similarity of 0 — this dataset has no
  // per-item grade field, only `sourceGrade` (the JLPT level a round was
  // launched from), which isn't per-candidate metadata. `frequency` is live
  // for kanji mode (data/kanji-n*.json carries `freq`); compound entries
  // don't have one, so it's 0 there too. See README "Adaptive Distractor
  // Generation" for how to wire up a new field without touching any other
  // file.
  weights: {
    exactReading: 50, // whole-reading string similarity (e.g. きょう vs きょく)
    firstMora: 20, // shares the same first character/mora as the correct reading
    confusion: 40, // this learner has actually picked this reading wrong before (see ProgressManager.getConfusions)
    meaning: 10, // overlapping English gloss tokens (e.g. shared word in "meaning")
    grade: 5, // dormant: no per-item grade data in this dataset
    frequency: 5, // nearby KANJIDIC corpus frequency rank (kanji mode only)
  },

  // Reverse mode (reading + meaning shown -> pick the kanji) needs its own
  // weights, NOT the forward `weights` above. Reversing the direction inverts
  // what a *graded* reading similarity means: forward, せい-vs-せき is hard
  // (you must know the exact reading); reverse, a candidate whose reading is
  // せき is trivially eliminable once you half-know the prompt reading せい.
  // So the only reading signal that makes a hard reverse distractor is an
  // *exact* homophone (a binary match in DistractorGenerator, not a
  // Levenshtein gradient), alongside meaning overlap (a same-meaning kanji is
  // hard precisely because the meaning is on screen) and this learner's own
  // past wrong kanji picks. firstMora is a mild plausibility nudge.
  reverseWeights: {
    homophone: 60, // candidate kanji shares the exact prompt reading
    meaning: 30, // overlapping English gloss tokens with the target
    confusion: 40, // this learner has picked this kanji wrong for this question before
    firstMora: 12, // candidate reading starts with the same mora as the prompt
    frequency: 5, // nearby KANJIDIC corpus frequency rank (kanji mode carries `freq`)
  },

  selection: {
    distractorCount: 3, // number of wrong options to generate (OPTIONS_COUNT - 1 in app.js)
    // Set well above the largest real candidate pool so this never truncates
    // today's data — it's a safety valve against a future, much larger
    // dataset, not a routine filter. kanji-drill (the app this engine was
    // built for) hit a real bug from too low a cap: candidates are built in
    // itemList's fixed array order, so a low cap always scored roughly the
    // same early slice of the file regardless of the target, collapsing
    // distractor variety.
    //
    // This app's largest single-level pool is N1 compounds at ~4,100
    // candidates; cumulative review across all five levels pools ~10,000
    // compound candidates (or ~8,200 kanji readings) at once, so the cap
    // sits well above that.
    maxCandidates: 20000,
  },
};
