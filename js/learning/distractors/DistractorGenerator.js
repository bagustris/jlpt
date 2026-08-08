// Orchestrates adaptive distractor generation: the only file in this module
// that assembles the candidate pool, touches ProgressManager, and invokes a
// strategy (mirroring how QuestionSelector is the only file in the
// question-selection module that touches ProgressManager). Feature
// extraction is delegated to SimilarityFeatures, scoring to whichever
// strategy is configured in DistractorConfig (DistractorGenerator never
// depends on a specific strategy implementation, only on the
// DistractorStrategy contract).
//
// Flow: DistractorGenerator.generate(question, itemList)
//         -> build candidate pool (every other item's readings, excluding
//            the correct answer), tagging each candidate with how many
//            times this learner has actually picked that reading wrong for
//            this question before (ProgressManager.getConfusions)
//         -> SimilarityFeatures.compute(question, candidate) per candidate
//         -> config.strategy.score(features, config)
//         -> rank candidates
//         -> take the highest-scoring, skipping duplicate reading strings
//         -> return up to config.selection.distractorCount reading strings
//
// Answer-order shuffling stays the caller's responsibility (app.js), same
// as before — this module only decides *which* distractors to use.

const DistractorGenerator = (() => {
  // Kanji entries use `kanji`, compound-word entries use `word` — same shape
  // otherwise.
  function itemText(entry) {
    return entry.kanji ?? entry.word;
  }

  // Every reading of every other item is a candidate, tagged with its
  // source item's metadata so SimilarityFeatures can compare against it,
  // plus how many times this learner has mistakenly picked that exact
  // reading for this exact question before. `entry.freq` is the KANJIDIC
  // corpus-frequency rank (kanji mode only — compound entries don't carry
  // one, so it comes through as `undefined` there); `grade` isn't part of
  // this dataset at all. Either missing simply means SimilarityFeatures
  // treats it as "unavailable" and scores that feature 0 rather than
  // throwing. `confusions` is `{}` when `question.id` isn't supplied (e.g. a
  // caller/test that doesn't need history-aware scoring) or when
  // ProgressManager has no history for this question yet.
  function buildCandidatePool(question, itemList, confusions) {
    const candidates = [];
    itemList.forEach((entry) => {
      const text = itemText(entry);
      if (text === question.text) return;
      entry.readings.forEach((reading) => {
        if (reading === question.reading) return;
        candidates.push({
          text,
          reading,
          meaning: entry.meaning,
          grade: entry.grade,
          frequency: entry.freq,
          confusionCount: confusions[reading] || 0,
        });
      });
    });
    return candidates;
  }

  // Walks candidates highest-score-first, keeping the first (best) occurrence
  // of each distinct reading string and stopping once `count` are collected —
  // this is what guarantees no duplicate readings/answer choices and that
  // the correct answer (already excluded from the pool) can't reappear.
  function selectTopDistractors(rankedCandidates, count) {
    const picked = [];
    const usedReadings = new Set();
    for (const { candidate } of rankedCandidates) {
      if (picked.length >= count) break;
      if (usedReadings.has(candidate.reading)) continue;
      usedReadings.add(candidate.reading);
      picked.push(candidate.reading);
    }
    return picked;
  }

  /**
   * Generates plausible multiple-choice distractors for one question.
   *
   * @param {{text: string, reading: string, meaning: string, grade?: number,
   *   frequency?: number, id?: string}} question - the target being quizzed;
   *   `reading` is the correct answer. `id` (ProgressManager's stable
   *   question ID, e.g. from `ProgressManager.getQuestionId(mode, grade,
   *   text)`) is optional — when present, past mistakes on this exact
   *   question boost matching candidates via `confusionSimilarity`.
   * @param {Array<Object>} itemList - the full grade/mode item pool (kanji or
   *   word entries) to draw candidate distractors from.
   * @param {Object} [options]
   * @param {Object} [options.config=DistractorConfig] - override config (mainly for tests).
   * @returns {string[]} up to config.selection.distractorCount unique reading
   *   strings, never including the correct answer or a duplicate of each other.
   */
  function generate(question, itemList, options = {}) {
    const config = options.config || DistractorConfig;

    if (!DistractorStrategy.isValid(config.strategy)) {
      throw new Error('DistractorConfig.strategy does not conform to DistractorStrategy');
    }

    const confusions = question.id ? ProgressManager.getConfusions(question.id) : {};
    const pool = buildCandidatePool(question, itemList, confusions).slice(0, config.selection.maxCandidates);

    const ranked = pool
      .map((candidate) => ({
        candidate,
        score: config.strategy.score(SimilarityFeatures.compute(question, candidate), config),
      }))
      .sort((a, b) => b.score - a.score);

    return selectTopDistractors(ranked, config.selection.distractorCount);
  }

  // Reverse-mode candidate pool: one candidate per *other* kanji. Unlike the
  // forward pool, same-reading candidates are NOT excluded — a homophone of the
  // prompt reading is the strongest reverse distractor. `confusionCount` is
  // keyed by the candidate *kanji* here (the wrong thing picked in reverse mode
  // is a kanji, not a reading), symmetric with the forward pool keying it by
  // reading. `entry.freq` is the KANJIDIC corpus rank (kanji entries carry it).
  function buildKanjiCandidatePool(question, itemList, confusions) {
    const candidates = [];
    itemList.forEach((entry) => {
      const text = itemText(entry);
      if (text === question.text) return;
      candidates.push({
        text,
        readings: entry.readings,
        meaning: entry.meaning,
        frequency: entry.freq,
        confusionCount: confusions[text] || 0,
      });
    });
    return candidates;
  }

  // Deterministic sub-weight jitter in [0, 0.5) from the exact (question,
  // candidate) pairing. When no homophone/first-mora match exists every
  // candidate lands on the same score and a plain sort falls back to file
  // order, surfacing the same filler kanji in every question (learnable by
  // elimination). This breaks those exact ties per-question without ever
  // outweighing a real signal, staying a pure function of its inputs.
  function tiebreakJitter(questionText, candidateText) {
    let hash = 0;
    const seed = `${questionText} ${candidateText}`;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 1000) / 2000; // [0, 0.5)
  }

  // Reverse score for one candidate kanji: best across its readings (a kanji
  // with several readings is a homophone if *any* of them matches). See
  // DistractorConfig.reverseWeights for why exactReading is a binary homophone
  // flag here, not the graded similarity the forward strategy weights.
  function scoreKanjiCandidate(question, candidate, config) {
    const w = config.reverseWeights;
    let best = 0;
    candidate.readings.forEach((reading) => {
      const f = SimilarityFeatures.compute(question, { ...candidate, reading });
      const score =
        w.homophone * (f.exactReadingSimilarity === 1 ? 1 : 0) +
        w.meaning * f.meaningSimilarity +
        w.confusion * f.confusionSimilarity +
        w.firstMora * f.firstMoraSimilarity +
        w.frequency * f.frequencySimilarity;
      if (score > best) best = score;
    });
    return best + tiebreakJitter(question.text, candidate.text);
  }

  /**
   * Generates plausible distractor *kanji* for a reverse question (prompt is a
   * reading + meaning, learner picks the matching kanji). Mirrors generate()'s
   * pool -> score -> rank -> take-top-N shape, but returns kanji strings scored
   * for reverse confusability (see reverseWeights).
   *
   * @param {{text: string, reading: string, meaning: string, frequency?: number,
   *   id?: string}} question - `text` is the correct kanji, `reading` the
   *   prompt reading.
   * @param {Array<Object>} itemList - the full level kanji pool.
   * @param {Object} [options]
   * @param {Object} [options.config=DistractorConfig]
   * @returns {string[]} up to config.selection.distractorCount unique kanji.
   */
  function generateKanji(question, itemList, options = {}) {
    const config = options.config || DistractorConfig;
    const confusions = question.id ? ProgressManager.getConfusions(question.id) : {};
    const pool = buildKanjiCandidatePool(question, itemList, confusions).slice(0, config.selection.maxCandidates);

    const ranked = pool
      .map((candidate) => ({ candidate, score: scoreKanjiCandidate(question, candidate, config) }))
      .sort((a, b) => b.score - a.score);

    const picked = [];
    const used = new Set();
    for (const { candidate } of ranked) {
      if (picked.length >= config.selection.distractorCount) break;
      if (used.has(candidate.text)) continue;
      used.add(candidate.text);
      picked.push(candidate.text);
    }
    return picked;
  }

  return { generate, generateKanji };
})();
