const OPTIONS_COUNT = 4;

const state = {
  mode: 'kanji',
  // The single JLPT level being drilled (1-5, matching N1-N5), or null in
  // cumulative review mode (where the pool spans several levels and each
  // *item* carries its own level — see sourceGrade in loadData/renderQuestion).
  grade: null,
  isReview: false,
  itemList: [],
  // {id, entry} candidates not yet picked this round — shrinks by one each
  // time renderQuestion() calls QuestionSelector.select(). Kept as pool
  // state rather than pre-picking every question upfront: with pools in the
  // thousands (this dataset's N1 compounds pool is ~4,100; cumulative review
  // pools ~10,000), eagerly running DistractorGenerator for every question
  // in an "all" round before showing the first one measured at multiple
  // minutes of blocked main thread. Picking + building one question at a
  // time keeps each transition to ~50-120ms, however large the round is.
  remainingPool: [],
  roundTotal: 0,
  currentQuestion: null,
  index: 0,
  score: 0,
  missed: [],
  correctItems: [],
  // performance.now() stamp taken when the current question finished
  // rendering; nulled once consumed so a re-render can't double-count.
  questionShownAt: null,
  screen: 'home',
  // True between an answer being graded and the next question appearing,
  // when autoNext is off — see armContinue()/onContinueClick().
  awaitingContinue: false,
};

const el = {
  screens: {
    home: document.getElementById('screen-home'),
    quiz: document.getElementById('screen-quiz'),
    summary: document.getElementById('screen-summary'),
  },
  modeButtons: document.querySelectorAll('.mode-btn'),
  gradeCounts: document.querySelectorAll('.grade-count'),
  gradeButtons: document.querySelectorAll('.grade-btn'),
  btnQuit: document.getElementById('btn-quit'),
  btnRetry: document.getElementById('btn-retry'),
  btnHome: document.getElementById('btn-home'),
  quizProgress: document.getElementById('quiz-progress'),
  quizKanji: document.getElementById('quiz-kanji'),
  quizMeaning: document.getElementById('quiz-meaning'),
  quizInstruction: document.getElementById('quiz-instruction'),
  quizOptions: document.getElementById('quiz-options'),
  quizDetail: document.getElementById('quiz-detail'),
  quizLeechBadge: document.getElementById('quiz-leech-badge'),
  btnReview: document.getElementById('btn-review'),
  reviewCount: document.getElementById('review-count'),
  summaryScore: document.getElementById('summary-score'),
  summaryMissed: document.getElementById('summary-missed'),
  summaryCorrect: document.getElementById('summary-correct'),
  fileWarning: document.getElementById('file-protocol-warning'),
  loadError: document.getElementById('load-error-banner'),
  gradeProgressList: document.getElementById('grade-progress-list'),
  btnSettings: document.getElementById('btn-settings'),
  btnSettingsClose: document.getElementById('btn-settings-close'),
  settingsOverlay: document.getElementById('settings-overlay'),
  settingShowMeaning: document.getElementById('setting-show-meaning'),
  settingAutoNext: document.getElementById('setting-auto-next'),
  settingShowDetail: document.getElementById('setting-show-detail'),
  settingPlayAudio: document.getElementById('setting-play-audio'),
  settingRoundSizeButtons: document.querySelectorAll('#setting-round-size .segmented-btn'),
  installButton: document.getElementById('btn-install'),
  installHint: document.getElementById('settings-install-hint'),
  aboutVersion: document.getElementById('about-version'),
};

// Core screen navigation is wired up first, before dashboard rendering or
// any other setup below — so a bug (or a stale-cache version mismatch
// between index.html and this script, see js/sw.js's CACHE_VERSION) in
// that later code can never leave the level/mode buttons unresponsive.

// data-*-count attributes hold the exact label text to display (e.g.
// "739字") — see registerTotalQuestionCounts() below.
// Reverse mode drills the same kanji files as kanji mode, so it reuses the
// kanji counts.
const COUNT_ATTR = { kanji: 'kanjiCount', word: 'wordCount', reverse: 'kanjiCount' };

el.modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    el.modeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    const mode = btn.dataset.mode;
    el.gradeCounts.forEach((span) => {
      span.textContent = span.dataset[COUNT_ATTR[mode]];
    });
    el.gradeButtons.forEach((gbtn) => { gbtn.dataset.mode = mode; });
    renderDashboard();
  });
});

el.gradeButtons.forEach((btn) => {
  btn.dataset.mode = 'kanji';
  btn.addEventListener('click', () => startGrade(btn.dataset.mode, Number(btn.dataset.grade)));
});

el.btnReview.addEventListener('click', () => startReview(getSelectedMode()));

el.btnQuit.addEventListener('click', () => showScreen('home'));
el.btnHome.addEventListener('click', () => showScreen('home'));
el.btnRetry.addEventListener('click', () => startRound());

// The level name shown in the dashboard (e.g. "N3") is read straight off
// the matching grade button rather than duplicated in a lookup table — strip
// its key-badge/count child spans and what's left is the label text.
function gradeDisplayName(grade) {
  const btn = document.querySelector(`.grade-btn[data-grade="${grade}"]`);
  if (!btn) return '';
  const clone = btn.cloneNode(true);
  clone.querySelectorAll('span').forEach((span) => span.remove());
  return clone.textContent.trim();
}

// Total question counts per level/mode are already known statically (see the
// grade-count data attributes in index.html) — register them once so the
// dashboard can show a completion percentage without fetching any data.
function registerTotalQuestionCounts() {
  el.gradeButtons.forEach((btn) => {
    const grade = Number(btn.dataset.grade);
    const counts = btn.querySelector('.grade-count');
    ProgressManager.setTotalQuestions('kanji', grade, parseInt(counts.dataset.kanjiCount, 10));
    ProgressManager.setTotalQuestions('word', grade, parseInt(counts.dataset.wordCount, 10));
    // Reverse mode covers the same kanji set, so its per-level total matches
    // kanji mode — needed for the dashboard's completion percentage.
    ProgressManager.setTotalQuestions('reverse', grade, parseInt(counts.dataset.kanjiCount, 10));
  });
}

// The mode toggle only flips which mode the grade buttons will launch (see
// its click handler below) — state.mode itself isn't set until a level is
// actually started, so the dashboard reads the active toggle directly to
// know which mode's per-level progress to show.
function getSelectedMode() {
  return document.querySelector('.mode-btn.active').dataset.mode;
}

function renderDashboard() {
  const mode = getSelectedMode();
  const grades = [...el.gradeButtons].map((btn) => {
    const grade = Number(btn.dataset.grade);
    return { grade, name: gradeDisplayName(grade) };
  });
  ProgressView.renderAll(mode, grades);
  // Kept in step with the dashboard rather than called separately: the two
  // read the same progress data, and finishing a level for the first time is
  // exactly what flips review from unavailable to available.
  renderReviewButton();
}

// Settings dialog: a plain modal (backdrop click / Escape / close button
// dismiss it) rather than something wired into the arrow-key nav groups —
// it's reached by mouse/touch or Tab, matching how a native <dialog> would
// behave, without the added complexity of a full focus trap.
function applyMeaningVisibility() {
  el.quizMeaning.classList.toggle('hidden', !SettingsManager.get('showMeaning'));
}

// Resolves the tri-state playAudio preference (see settings.js): an explicit
// user choice wins; `null` (never chosen) falls back to off in an installed/
// standalone PWA (where a ja-JP voice is often network-dependent and offline-
// unavailable) and on in a browser tab.
function audioEnabled() {
  const pref = SettingsManager.get('playAudio');
  return pref === null ? !isStandaloneDisplay() : pref;
}

// Speaks a reading when audio is enabled and supported; a silent no-op
// otherwise. The okurigana dot (e.g. "ひと.つ") is a display marker, not
// something to pronounce, so it's stripped before speaking.
function speakReading(reading, onEnd) {
  const text = reading ? reading.replace(/\./g, '') : '';
  if (text && audioEnabled() && AudioPlayer.isSupported()) {
    AudioPlayer.speak(text, onEnd);
  } else if (onEnd) {
    onEnd();
  }
}

// How long the revealed answer stays on screen before auto-advancing, scaled to
// how much there is to read: a short reading needs less time than a long word or
// compound. `text` is the reading being shown/spoken; a wrong answer gets a
// larger base, and the result is clamped so nothing is instant or interminable.
// With audio on this is only the floor — the advance also waits for the
// utterance to finish (see handleAnswer).
function advanceDelayMs(text, isCorrect) {
  const len = (text || '').length;
  const ms = (isCorrect ? 900 : 1600) + len * 120;
  return Math.min(isCorrect ? 6000 : 8000, Math.max(isCorrect ? 900 : 2400, ms));
}

// Auto-advance's floor while the post-answer detail panel is on screen (see
// handleAnswer) — on'yomi/kun'yomi, compounds, pitch accent, etc. need more
// reading time than the reading-length formula above accounts for.
const DETAIL_READ_MS = 10000;

function isSettingsOpen() {
  return !el.settingsOverlay.classList.contains('hidden');
}

function openSettings() {
  el.settingsOverlay.classList.remove('hidden');
  renderInstallRow();
  el.btnSettingsClose.focus();
}

function closeSettings() {
  el.settingsOverlay.classList.add('hidden');
  el.btnSettings.focus();
}

// PWA install: Chrome/Edge/Android fire `beforeinstallprompt`, which we
// stash until the user taps the Settings button. Browsers with no such
// event (iOS Safari, desktop Safari/Firefox) get manual "Add to Home
// Screen" instructions instead, since there's no install API to call there.
let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function renderInstallRow() {
  if (isStandaloneDisplay()) {
    el.installButton.classList.add('hidden');
    el.installHint.textContent = 'インストール済み — Already installed';
    el.installHint.classList.remove('hidden');
    return;
  }
  if (deferredInstallPrompt) {
    el.installButton.classList.remove('hidden');
    el.installHint.classList.add('hidden');
    return;
  }
  el.installButton.classList.add('hidden');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  el.installHint.textContent = isIOS
    ? '共有ボタン → ホーム画面に追加 — Share button → Add to Home Screen'
    : 'ブラウザメニューの「インストール」から追加できます — Use your browser menu → Install app';
  el.installHint.classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  renderInstallRow();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  renderInstallRow();
});

function initSettingsPanel() {
  el.settingShowMeaning.checked = SettingsManager.get('showMeaning');
  applyMeaningVisibility();

  const roundSize = String(SettingsManager.get('roundSize'));
  el.settingRoundSizeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === roundSize);
  });

  el.settingShowMeaning.addEventListener('change', () => {
    SettingsManager.set('showMeaning', el.settingShowMeaning.checked);
    applyMeaningVisibility();
  });

  el.settingAutoNext.checked = SettingsManager.get('autoNext');
  el.settingAutoNext.addEventListener('change', () => {
    SettingsManager.set('autoNext', el.settingAutoNext.checked);
  });

  el.settingShowDetail.checked = SettingsManager.get('showDetail');
  el.settingShowDetail.addEventListener('change', () => {
    SettingsManager.set('showDetail', el.settingShowDetail.checked);
    // If this question is already answered (options disabled), reflect the
    // change on the live panel. Toggling the setting on before answering must
    // not reveal the details early and give the reading away.
    const answered = state.screen === 'quiz'
      && el.quizOptions.children[0] && el.quizOptions.children[0].disabled;
    if (answered) {
      renderDetail(state.currentQuestion);
      // A timed advance may already be pending from before the panel was
      // turned on, sized for the bare reading — extend it to the full
      // detail-reading floor so the just-revealed panel isn't skipped past.
      if (SettingsManager.get('showDetail') && advanceTimer !== null) {
        clearAdvanceTimer();
        advanceTimer = setTimeout(advanceQuestion, DETAIL_READ_MS);
      }
    }
  });

  // Init from the resolved default (audioEnabled()), not the raw tri-state
  // preference, so a never-chosen `null` renders on/off per context.
  el.settingPlayAudio.checked = audioEnabled();
  el.settingPlayAudio.addEventListener('change', () => {
    SettingsManager.set('playAudio', el.settingPlayAudio.checked);
  });

  el.settingRoundSizeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.settingRoundSizeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      SettingsManager.set('roundSize', btn.dataset.value === 'all' ? 'all' : Number(btn.dataset.value));
    });
  });

  el.btnSettings.addEventListener('click', openSettings);
  el.btnSettingsClose.addEventListener('click', closeSettings);
  el.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === el.settingsOverlay) closeSettings();
  });

  el.installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallRow();
  });

  renderInstallRow();
}

// The About panel's version is read from CHANGELOG.md (the single source of
// truth — see its header) rather than duplicated here: parse the newest
// `## [x.y.z]` heading and show it. The static v-number in index.html is the
// offline/pre-fetch fallback, so a failed fetch just leaves that in place.
async function loadAppVersion() {
  try {
    const res = await fetch('CHANGELOG.md');
    if (!res.ok) return;
    const text = await res.text();
    const match = text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
    if (match && el.aboutVersion) el.aboutVersion.textContent = `v${match[1]}`;
  } catch {
    // offline / fetch blocked — keep the static fallback from index.html
  }
}

initSettingsPanel();
loadAppVersion();
registerTotalQuestionCounts();
ProgressView.init();
renderDashboard();

el.gradeProgressList.addEventListener('click', (e) => {
  const btn = e.target.closest('.grade-row-reset');
  if (!btn) return;
  const grade = Number(btn.dataset.grade);
  const mode = getSelectedMode();
  const name = gradeDisplayName(grade);
  if (!confirm(`${name}の成績をリセットしますか？\nReset progress for ${name}?`)) return;
  ProgressManager.reset(mode, grade);
  renderDashboard();
});

if (location.protocol === 'file:') {
  el.fileWarning.classList.remove('hidden');
}

function showScreen(name) {
  // Any screen change abandons a pending "tap/press a key to continue" —
  // otherwise a leftover continue click could fire after navigating away
  // (e.g. quitting mid-reveal) and re-render a question the learner just
  // backed out of. See armContinue()/onContinueClick().
  cancelContinue();
  // Also cancel a pending autoNext timer, so quitting mid-pause doesn't fire
  // advanceQuestion() against the screen we're navigating to.
  clearAdvanceTimer();
  // Cut off any reading still being spoken so it can't play over the next
  // screen when the user quits mid-reveal or lands on the summary.
  AudioPlayer.stop();
  state.screen = name;
  Object.entries(el.screens).forEach(([key, section]) => {
    section.classList.toggle('hidden', key !== name);
  });
}

// The pending autoNext advance-to-next-question timeout, tracked so it can be
// cancelled if the learner quits mid-pause — otherwise a stale timer from an
// abandoned question fires later and calls advanceQuestion() against whatever
// screen is active by then (state.index/renderQuestion are shared module
// state), re-rendering a question the learner just backed out of. Only used
// when autoNext is on; the manual-continue path has no timer.
let advanceTimer = null;

// Bumped every time a question renders. An audio-gated auto-advance captures
// this at answer time and only fires if it still matches — so a spoken reading
// that finishes (or is cancelled) after the learner has moved on, quit, or
// started a new round can't trigger a stray skip.
let renderGen = 0;

// --- Stroke-order animation (kanji mode only) ---------------------------
// KanjiVG data (jōyō kanji only, ~2,136 characters) mirrored into the
// kanji-data submodule specifically for this — see stroke-order/kanjivg/
// there. This app's kanji lists (N5-N1) can include a handful of kanji
// outside jōyō, so a fetch miss silently leaves the plain character in
// place (set synchronously by renderQuestion before this resolves) rather
// than showing an error; this is a quiz prompt, not a dictionary lookup.
const strokeOrderCache = new Map();

function kanjivgFilename(char) {
  return char.codePointAt(0).toString(16).padStart(5, '0') + '.svg';
}

function fetchKanjivgSvg(char) {
  const path = `vendor/kanji-data/stroke-order/kanjivg/${kanjivgFilename(char)}`;
  if (!strokeOrderCache.has(path)) {
    const p = fetch(path).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    strokeOrderCache.set(path, p);
  }
  return strokeOrderCache.get(path);
}

// Ported verbatim from jed's js/app.js: sets each stroke's
// stroke-dasharray/stroke-dashoffset to its own length and transitions the
// offset to 0 with a per-stroke delay, giving a draw-in-order effect with no
// animation library. kvg: paths are always in stroke order regardless of
// nesting depth, so a plain query in document order is correct.
function animateStrokeOrder(svg) {
  const paths = svg.querySelectorAll('[id^="kvg:StrokePaths"] path');
  paths.forEach((path, i) => {
    const len = path.getTotalLength();
    path.style.transition = 'none';
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    // force reflow so the transition below animates from this state
    void path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset 0.7s ease-in-out';
    path.style.transitionDelay = `${i * 0.6}s`;
    requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
  });
}

// Swaps #quiz-kanji's plain character for an animated stroke-order SVG once
// fetched. myGen guards against a slow fetch resolving after the learner has
// already advanced to (or the round has rendered) a different question.
async function renderKanjiStrokeOrder(char, myGen) {
  const svgText = await fetchKanjivgSvg(char);
  if (renderGen !== myGen || !svgText) return;
  // The fetched file is a full XML document (declaration, licence comment,
  // internal DOCTYPE subset) ahead of the <svg> element — innerHTML only
  // understands HTML syntax, so keep just the <svg>...</svg> element.
  const svgMatch = svgText.match(/<svg[\s\S]*<\/svg>/);
  if (!svgMatch) return;
  el.quizKanji.innerHTML = svgMatch[0].replace(/stroke:#000000/g, 'stroke:currentColor');
  const svg = el.quizKanji.querySelector('svg');
  animateStrokeOrder(svg);
  svg.addEventListener('click', () => animateStrokeOrder(svg));
}

function clearAdvanceTimer() {
  if (advanceTimer !== null) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

// Advances past the current question, whether triggered by the autoNext
// timer or by armContinue()'s tap/keypress gate — both paths funnel through
// here so there's exactly one place that decides "next question vs. summary".
function advanceQuestion() {
  if (state.screen !== 'quiz') return; // guards a late audio callback after quitting
  clearAdvanceTimer();
  state.index++;
  if (state.index < state.roundTotal) renderQuestion();
  else showSummary();
}

// Fires once on the next click anywhere in the app while awaitingContinue is
// true. Registered via a deferred (setTimeout 0) addEventListener rather
// than directly in handleAnswer — the click that answered the question is
// still bubbling up to `document` at that point, and attaching synchronously
// would let that same click immediately satisfy its own "continue" gate.
function onContinueClick(e) {
  if (!state.awaitingContinue) return;
  // A click that opens/uses the settings overlay must not double as the
  // "continue" tap — otherwise opening settings mid-reveal advances past the
  // question underneath (and the detail panel the learner may be reading). Bail
  // without consuming the gate so the next real tap still advances. Registered
  // without { once: true } precisely so this early return can leave the
  // listener armed; it's removed explicitly once it actually advances.
  if (isSettingsOpen() || (e && e.target && e.target.closest('#settings-overlay'))) return;
  state.awaitingContinue = false;
  document.removeEventListener('click', onContinueClick);
  advanceQuestion();
}

function armContinue() {
  state.awaitingContinue = true;
  el.quizInstruction.innerHTML = 'タップして次へ<span>Tap or press any key to continue</span>';
  setTimeout(() => document.addEventListener('click', onContinueClick), 0);
}

function cancelContinue() {
  if (!state.awaitingContinue) return;
  state.awaitingContinue = false;
  document.removeEventListener('click', onContinueClick);
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Kanji entries use `kanji`, compound entries use `word` — same shape
// otherwise.
function itemText(entry) {
  return entry.kanji ?? entry.word;
}

// Escapes a plain-text value pulled straight from the exported dataset
// before it goes into an innerHTML template literal. Most of this app's data
// is Japanese kana/kanji, which is inert, but English glosses aren't: e.g.
// "counter for bows & stringed instruments" (kanji 張, N1) has a bare "&",
// which is invalid HTML and can swallow whatever follows it. Every raw
// string interpolated into innerHTML below (not textContent, which needs
// none of this) goes through here first.
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A reading like "おぼ.える" marks where kanji-derived reading ends and
// okurigana (kana not carried by the kanji itself) begins. A leading/trailing
// "-" (e.g. "ひと-", "-び") marks a bound (prefix/suffix-only) form; those are
// filtered out of the quiz answer pool by the exporter but still shown as-is
// here in the on'yomi/kun'yomi detail lists.
function readingHTML(reading) {
  const dot = reading.indexOf('.');
  if (dot === -1) return escapeHTML(reading);
  const core = escapeHTML(reading.slice(0, dot));
  const okurigana = escapeHTML(reading.slice(dot + 1));
  return `${core}<span class="okurigana">${okurigana}</span>`;
}

// {id, entry} candidates for a round, id = ProgressManager's stable question
// ID. renderQuestion() repeatedly asks QuestionSelector for the next best
// pick from this pool and splices it out, so a single round never repeats a
// question (QuestionSelector's own recent-history queue additionally keeps
// picks diverse across rounds/retries within the same page session).
// `entry.sourceGrade` rather than a single round-wide grade: in cumulative
// review the pool spans several levels, and a question's progress must stay
// under the level it actually belongs to. Keying it any other way would fork
// one kanji's history into two records.
function buildRemainingPool(itemList, mode) {
  return itemList.map((entry) => ({ id: ProgressManager.getQuestionId(mode, entry.sourceGrade, itemText(entry)), entry }));
}

// Distractor selection is delegated to the Adaptive Learning Engine's
// DistractorGenerator (js/learning/distractors/) instead of a random pick —
// see kanji-drill's README "Adaptive Distractor Generation" for how it ranks
// candidates; this app reuses that engine unmodified.
function buildQuestion(target, itemList, mode) {
  const correctReading = shuffle(target.readings)[0];
  const question = {
    id: ProgressManager.getQuestionId(mode, target.sourceGrade, itemText(target)),
    text: itemText(target),
    reading: correctReading,
    meaning: target.meaning,
    // Feeds SimilarityFeatures' frequency-proximity term (kanji mode only —
    // compound entries don't carry a corpus frequency rank).
    frequency: target.freq,
  };
  const distractors = DistractorGenerator.generate(question, itemList);
  const options = shuffle([correctReading, ...distractors]);
  return {
    text: question.text,
    sourceGrade: target.sourceGrade,
    meaning: target.meaning,
    correctReading,
    options,
    // Full source entry (onyomi/kunyomi/compounds/accent/strokes/etc.) for
    // the post-answer detail panel — see renderDetail().
    detail: target,
  };
}

// Builds a reverse question: the prompt is a reading + meaning and the four
// options are kanji (one correct, three confusable distractors). The correct
// kanji is stored in the same `correctReading` slot the forward modes use, so
// handleAnswer's matching/recording stays mode-agnostic — only rendering and
// the summary row branch on state.mode.
function buildReverseQuestion(target, itemList) {
  const kanji = itemText(target);
  const reading = shuffle(target.readings)[0];
  const question = {
    id: ProgressManager.getQuestionId('reverse', target.sourceGrade, kanji),
    text: kanji,
    reading,
    meaning: target.meaning,
    frequency: target.freq,
  };
  const distractors = DistractorGenerator.generateKanji(question, itemList);
  const options = shuffle([kanji, ...distractors]);
  return {
    text: kanji,
    sourceGrade: target.sourceGrade,
    reading,
    meaning: target.meaning,
    correctReading: kanji,
    options,
    detail: target,
    isReverse: true,
  };
}

// Reverse mode loads the same kanji files as kanji mode.
const MODE_FILE_PREFIX = { kanji: 'kanji-n', word: 'compounds-n', reverse: 'kanji-n' };

// Every entry is tagged with the JLPT level whose file it came from, in both
// single-level and review rounds, so nothing downstream needs to branch on
// which kind of round it is — see buildRemainingPool()/renderQuestion().
async function loadData(mode, grade) {
  const file = `${MODE_FILE_PREFIX[mode]}${grade}`;
  const res = await fetch(`data/${file}.json`);
  if (!res.ok) throw new Error(`Failed to load ${file} data (HTTP ${res.status})`);
  const entries = await res.json();
  return entries.map((entry) => ({ ...entry, sourceGrade: grade }));
}

// Levels that have actually been drilled. This is what makes review
// *cumulative* rather than a firehose: it pools only what you've already
// started, so it never introduces new material — it just stops earlier
// levels from decaying while you work on a later one.
function studiedGrades(mode) {
  return [...el.gradeButtons]
    .map((btn) => Number(btn.dataset.grade))
    .filter((grade) => ProgressManager.getGradeStats(mode, grade).answered > 0);
}

// Enables/labels the review button for the currently selected mode. Called on
// mode switch and after every round, since finishing a level for the first
// time is exactly what makes review become available.
function renderReviewButton() {
  const mode = getSelectedMode();
  const grades = studiedGrades(mode);
  el.btnReview.disabled = grades.length === 0;
  el.reviewCount.textContent = grades.length === 0
    ? 'レベルを1つ終えると使えます'
    : grades.map(gradeDisplayName).join('・');
}

async function startGrade(mode, grade) {
  await startSession(mode, { grade, load: () => loadData(mode, grade) });
}

async function startReview(mode) {
  const grades = studiedGrades(mode);
  if (grades.length === 0) return;
  await startSession(mode, {
    grade: null,
    isReview: true,
    load: async () => (await Promise.all(grades.map((g) => loadData(mode, g)))).flat(),
  });
}

async function startSession(mode, { grade, isReview = false, load }) {
  el.loadError.classList.add('hidden');
  try {
    state.mode = mode;
    state.grade = grade;
    state.isReview = isReview;
    state.itemList = await load();
    renderDashboard();
    startRound();
  } catch (err) {
    console.error(err);
    el.loadError.textContent = location.protocol === 'file:'
      ? '読み込みに失敗しました。サーバー経由で開いてください（上の注意を参照）。'
      : '読み込みに失敗しました。ページを再読み込みしてください。';
    el.loadError.classList.remove('hidden');
  }
}

function startRound() {
  const configuredSize = SettingsManager.get('roundSize');
  const roundSize = configuredSize === 'all' ? state.itemList.length : configuredSize;
  state.roundTotal = Math.min(roundSize, state.itemList.length);
  state.remainingPool = buildRemainingPool(state.itemList, state.mode);
  state.currentQuestion = null;
  state.index = 0;
  state.score = 0;
  state.missed = [];
  state.correctItems = [];
  showScreen('quiz');
  renderQuestion();
}

const INSTRUCTION_TEXT = {
  reverse: ['この読み方の漢字は？', 'Choose the kanji for this reading'],
};
const DEFAULT_INSTRUCTION = ['正しい読み方は？', 'Choose the correct reading'];

// Picks and builds exactly one question — including its distractor set —
// right before it's shown, rather than the whole round upfront. See the
// comment on state.remainingPool for why: this is a real fix for a real
// freeze, not premature optimization.
function renderQuestion() {
  renderGen++;
  const choice = QuestionSelector.select(state.remainingPool);
  if (!choice) { showSummary(); return; }
  state.remainingPool.splice(state.remainingPool.findIndex((p) => p.id === choice.id), 1);
  const isReverse = state.mode === 'reverse';
  const q = isReverse
    ? buildReverseQuestion(choice.entry, state.itemList)
    : buildQuestion(choice.entry, state.itemList, state.mode);
  state.currentQuestion = q;

  // Cut off any reading still being spoken from the previous reveal so audio
  // never bleeds across questions.
  AudioPlayer.stop();

  // Flagged in review mode: the pool spans levels there, so without this a
  // higher-level kanji surfacing mid-round just looks like a bug.
  const counter = `${state.index + 1} / ${state.roundTotal}`;
  el.quizProgress.textContent = state.isReview ? `ふくしゅう ${counter}` : counter;
  el.quizKanji.classList.toggle('is-word', state.mode === 'word');
  el.quizKanji.classList.toggle('is-reverse', isReverse);
  // Reverse prompts a reading (through readingHTML so an okurigana dot renders
  // as the styled span); forward modes prompt the kanji/word.
  if (isReverse) el.quizKanji.innerHTML = readingHTML(q.reading);
  else el.quizKanji.textContent = q.text;
  if (state.mode === 'kanji') renderKanjiStrokeOrder(q.text, renderGen);
  el.quizMeaning.textContent = q.meaning;

  // A leech (a kanji/word this learner keeps missing) gets extra scaffolding:
  // its meaning is shown even when the setting is off, and a "weak spot" marker
  // appears. Reverse mode always shows the meaning too (it disambiguates
  // homophone kanji).
  const leech = ProgressManager.isLeech(ProgressManager.getQuestionId(state.mode, q.sourceGrade, q.text));
  el.quizLeechBadge.classList.toggle('hidden', !leech);
  if (isReverse || leech) el.quizMeaning.classList.remove('hidden');
  else applyMeaningVisibility();

  const [instructionMain, instructionSub] = INSTRUCTION_TEXT[state.mode] || DEFAULT_INSTRUCTION;
  el.quizInstruction.innerHTML = `${instructionMain}<span>${instructionSub}</span>`;
  el.quizOptions.classList.toggle('is-reverse', isReverse);
  el.quizOptions.innerHTML = '';
  q.options.forEach((option, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    // Reverse options are kanji; readingHTML leaves a dot-free kanji untouched.
    btn.innerHTML = `<span class="key-badge key-badge-corner">${i + 1}</span>${readingHTML(option)}`;
    btn.dataset.reading = option;
    btn.addEventListener('click', () => handleAnswer(option, btn));
    el.quizOptions.appendChild(btn);
  });
  el.quizDetail.innerHTML = '';
  el.quizDetail.classList.add('hidden');

  // Reverse speaks the reading up front (it's already on screen, leaks
  // nothing); forward modes wait until the answer is revealed (see
  // handleAnswer), since the reading is the answer there.
  if (isReverse) speakReading(q.reading);

  // Stamped last, once the options are actually on screen, so the measured
  // latency is time-to-answer rather than time-to-answer plus render.
  state.questionShownAt = performance.now();
}

// --- Pitch accent plot ------------------------------------------------
//
// `accent` in the dataset is a kanjium pattern number (or comma-separated
// list of accepted patterns, e.g. "0,3") — meaningless to a learner who
// doesn't already know the convention, so instead of printing the digit we
// plot it as the high/low dot-and-line diagram Japanese pitch-accent
// references (OJAD, kanjium itself) use.

// A small-kana yōon (ゃゅょぁぃぅぇぉ and katakana equivalents) merges into the
// preceding mora instead of counting as its own — っ/ん/ー are real morae on
// their own and are deliberately NOT in this set.
const PITCH_SMALL_KANA = new Set([...'ゃゅょぁぃぅぇぉャュョァィゥェォ']);

function moraSplit(reading) {
  const moras = [];
  for (const ch of reading || '') {
    if (PITCH_SMALL_KANA.has(ch) && moras.length > 0) moras[moras.length - 1] += ch;
    else moras.push(ch);
  }
  return moras;
}

// One 'H'/'L' per mora, standard Japanese pitch-accent rule, plus one
// trailing pseudo-mora for whatever follows the word: high only for heiban
// (accentNum 0), the one pattern where the pitch never falls. That trailing
// dot is what visually tells heiban apart from odaka (accentNum === mora
// count) — the two are identical across the word's own morae and differ
// only in what happens right after it.
function pitchLevels(moraCount, accentNum) {
  const levels = [];
  for (let i = 0; i < moraCount; i++) {
    if (accentNum === 0) levels.push(i === 0 ? 'L' : 'H');
    else if (accentNum === 1) levels.push(i === 0 ? 'H' : 'L');
    else levels.push(i === 0 ? 'L' : (i < accentNum ? 'H' : 'L'));
  }
  levels.push(accentNum === 0 ? 'H' : 'L');
  return levels;
}

// One accepted pattern as a small inline dot-and-line SVG: filled dots for
// the word's own morae, one hollow trailing dot for the pseudo-mora after it.
function pitchAccentSVG(reading, accentNum) {
  const moras = moraSplit(reading);
  if (moras.length === 0) return '';
  const levels = pitchLevels(moras.length, accentNum);
  const stepX = 14;
  const padX = 6;
  const topY = 6;
  const bottomY = 18;
  const width = padX * 2 + stepX * moras.length;
  const height = 24;
  const xAt = (i) => padX + stepX * i;
  const yAt = (level) => (level === 'H' ? topY : bottomY);
  const path = levels.map((level, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(level)}`).join(' ');
  const dots = levels.map((level, i) => {
    const cls = i < moras.length ? 'pitch-dot' : 'pitch-dot pitch-dot-trailing';
    return `<circle cx="${xAt(i)}" cy="${yAt(level)}" r="${i < moras.length ? 3 : 2.5}" class="${cls}" />`;
  }).join('');
  return `<svg class="pitch-plot" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(accentNum)}型">` +
    `<path d="${path}" class="pitch-line" fill="none" />${dots}</svg>`;
}

// `accent` is a comma-separated list when a word has more than one accepted
// pattern (e.g. "0,3") — one small plot per accepted pattern, never the raw
// digits themselves.
function pitchAccentHTML(reading, accent) {
  if (!accent) return '';
  const patterns = String(accent).split(',').map((s) => parseInt(s, 10)).filter(Number.isInteger);
  if (patterns.length === 0) return '';
  return `<span class="pitch-accent-group">${patterns.map((n) => pitchAccentSVG(reading, n)).join('')}</span>`;
}

// Up to `limit` compound examples with kanjium pitch accent, shown in the
// post-answer detail panel (kanji mode) — see renderDetail().
function renderCompoundList(compounds, limit) {
  if (!compounds || compounds.length === 0) return '';
  const items = compounds.slice(0, limit).map((c) => {
    const accent = pitchAccentHTML(c.reading, c.accent);
    return `<li><span class="detail-word">${escapeHTML(c.word)}</span><span class="detail-reading">${readingHTML(c.reading)}</span>${accent}<span class="detail-gloss">${escapeHTML(c.meaning)}</span></li>`;
  }).join('');
  const rest = compounds.length - limit;
  const more = rest > 0 ? `<li class="detail-more">ほか${rest}語<span>+${rest} more</span></li>` : '';
  return `<ul class="detail-compounds">${items}${more}</ul>`;
}

function detailRow(labelJa, labelEn, valueHTML) {
  if (!valueHTML) return '';
  return `<div class="detail-row"><span class="detail-label">${labelJa}<span>${labelEn}</span></span><span class="detail-value">${valueHTML}</span></div>`;
}

// Reveals everything the exported dataset carries beyond the reading itself
// (on'yomi/kun'yomi split, strokes, an example sentence and compound words
// with pitch accent for kanji; pitch accent and source kanji for compound
// words) — shown only after answering, since on'yomi/kun'yomi or the accent
// number would otherwise give the reading away before the question is
// answered.
function renderDetail(q) {
  if (!SettingsManager.get('showDetail')) {
    el.quizDetail.innerHTML = '';
    el.quizDetail.classList.add('hidden');
    return;
  }

  const entry = q.detail;
  let html = '';

  if (state.mode === 'kanji' || state.mode === 'reverse') {
    html += detailRow('音読み', "On'yomi", (entry.onyomi || []).map(readingHTML).join('、'));
    html += detailRow('訓読み', "Kun'yomi", (entry.kunyomi || []).map(readingHTML).join('、'));
    if (entry.strokes) html += detailRow('画数', 'Strokes', `${entry.strokes}`);
    if (entry.sentence) html += detailRow('例文', 'Example', escapeHTML(entry.sentence));
    html += renderCompoundList(entry.compounds, 4);
  } else {
    html += detailRow('アクセント', 'Pitch accent', pitchAccentHTML(entry.reading, entry.accent) || null);
    if (entry.sourceKanji && entry.sourceKanji.length) html += detailRow('漢字', 'Kanji', entry.sourceKanji.map(escapeHTML).join('、'));
  }

  el.quizDetail.innerHTML = html;
  el.quizDetail.classList.toggle('hidden', html === '');
}

// Arrow-key navigation: each screen exposes an ordered list of button
// groups (each with a column count matching its on-screen grid/row/stack
// layout). Left/Right move within a group's row; Up/Down move within a
// group's column and, at a group's top/bottom edge, jump to the
// neighboring group in the same column. Buttons are real <button>
// elements, so once focused, Enter/Space activate them via native
// browser behavior — no extra handling needed here.
function getNavGroups() {
  if (state.screen === 'home') {
    const grids = document.querySelectorAll('.grade-grid');
    return [
      // cols tracks the on-screen layout: the mode toggle is a single flex
      // row, so its column count is however many mode buttons there are.
      { items: [...el.modeButtons], cols: el.modeButtons.length },
      { items: [...grids[0].children], cols: 2 },
      // The review row is a single full-width button, and it's disabled until
      // a level has been studied — so this group is empty on a fresh install
      // and gets dropped below rather than stranding focus on a dead cell.
      { items: [...grids[1].children].filter((item) => !item.disabled), cols: 1 },
    ].filter((group) => group.items.length > 0);
  }
  if (state.screen === 'quiz') {
    return [
      { items: [el.btnQuit], cols: 1 },
      { items: [...el.quizOptions.children], cols: 2 },
    ];
  }
  if (state.screen === 'summary') {
    return [{ items: [el.btnRetry, el.btnHome], cols: 1 }];
  }
  return [];
}

function findFocusPosition(groups) {
  for (let g = 0; g < groups.length; g++) {
    const i = groups[g].items.indexOf(document.activeElement);
    if (i !== -1) return { g, i };
  }
  return null;
}

function navigate(dRow, dCol) {
  const groups = getNavGroups().filter((grp) => grp.items.length > 0);
  if (groups.length === 0) return;

  const pos = findFocusPosition(groups);
  if (!pos) {
    groups[0].items[0].focus();
    return;
  }

  const { g, i } = pos;
  const group = groups[g];
  const row = Math.floor(i / group.cols);
  const col = i % group.cols;

  if (dCol !== 0) {
    const newCol = col + dCol;
    if (newCol < 0 || newCol >= group.cols) return;
    const newIndex = row * group.cols + newCol;
    if (newIndex >= group.items.length) return;
    group.items[newIndex].focus();
    return;
  }

  const newRow = row + dRow;
  const withinIndex = newRow * group.cols + col;
  if (newRow >= 0 && withinIndex < group.items.length) {
    group.items[withinIndex].focus();
    return;
  }

  const targetGroupIndex = g + dRow;
  if (targetGroupIndex < 0 || targetGroupIndex >= groups.length) return;
  const targetGroup = groups[targetGroupIndex];
  let targetIndex;
  if (dRow > 0) {
    targetIndex = Math.min(col, targetGroup.cols - 1, targetGroup.items.length - 1);
  } else {
    const lastRow = Math.floor((targetGroup.items.length - 1) / targetGroup.cols);
    const candidate = lastRow * targetGroup.cols + Math.min(col, targetGroup.cols - 1);
    targetIndex = candidate < targetGroup.items.length ? candidate : targetGroup.items.length - 1;
  }
  targetGroup.items[targetIndex].focus();
}

const ARROW_DELTAS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// Keyboard shortcuts, mirrored by the on-screen key-badges: k/w switch mode
// and 1-5 pick N1-N5 on the home screen, 1-4 pick a quiz option (matching
// the 2x2 grid order) and 0 quits, 1/2 retry or return home on the summary
// screen. Arrow keys move focus between on-screen buttons on every screen.
document.addEventListener('keydown', (e) => {
  if (isSettingsOpen()) {
    if (e.key === 'Escape') closeSettings();
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // "Tap or press any key to continue" — see armContinue(). Takes priority
  // over every other shortcut below, matching what the instruction line
  // actually promises.
  if (state.awaitingContinue) {
    state.awaitingContinue = false;
    document.removeEventListener('click', onContinueClick);
    advanceQuestion();
    return;
  }

  if (ARROW_DELTAS[e.key]) {
    e.preventDefault();
    navigate(...ARROW_DELTAS[e.key]);
    return;
  }

  if (state.screen === 'home') {
    const key = e.key.toLowerCase();
    if (key === 'k') {
      document.querySelector('.mode-btn[data-mode="kanji"]').click();
      return;
    }
    if (key === 'w') {
      document.querySelector('.mode-btn[data-mode="word"]').click();
      return;
    }
    if (key === 'g') {
      document.querySelector('.mode-btn[data-mode="reverse"]').click();
      return;
    }
    if (key === 'r') {
      if (!el.btnReview.disabled) el.btnReview.click();
      return;
    }
    const btn = document.querySelector(`.grade-btn[data-grade="${e.key}"]`);
    if (btn) btn.click();
    return;
  }

  if (state.screen === 'quiz') {
    if (e.key === '0') {
      el.btnQuit.click();
      return;
    }
    const index = Number(e.key) - 1;
    if (!(index >= 0 && index < OPTIONS_COUNT)) return;
    const btn = el.quizOptions.children[index];
    if (!btn || btn.disabled) return;
    btn.click();
    return;
  }

  if (state.screen === 'summary') {
    if (e.key === '1') el.btnRetry.click();
    else if (e.key === '2') el.btnHome.click();
  }
});

function handleAnswer(selected, btnEl) {
  const q = state.currentQuestion;
  const isCorrect = selected === q.correctReading;

  const latencyMs = state.questionShownAt === null ? null : performance.now() - state.questionShownAt;
  state.questionShownAt = null;

  [...el.quizOptions.children].forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.reading === q.correctReading) btn.classList.add('correct');
    else if (btn === btnEl) btn.classList.add('incorrect');
  });

  renderDetail(q);
  const detailShown = !el.quizDetail.classList.contains('hidden');

  // q.sourceGrade, not state.grade — in review mode state.grade is null and
  // each question belongs to its own level's progress record.
  ProgressManager.recordAnswer(state.mode, q.sourceGrade, q.text, isCorrect, selected, latencyMs);
  if (isCorrect) { state.score++; state.correctItems.push(q); }
  else state.missed.push(q);

  renderDashboard();

  // Forward modes speak the reading now that it's revealed (it's the answer, in
  // correctReading). Reverse mode already spoke it at render time.
  const spokenText = state.mode !== 'reverse' ? q.correctReading : '';
  const readText = state.mode === 'reverse' ? q.reading : q.correctReading;

  if (SettingsManager.get('autoNext')) {
    // A wrong answer gets a longer pause than a correct one: that's the moment
    // the revealed reading and detail panel actually need to be read. Length-
    // adaptive so a long word/compound gets more time than a short reading —
    // floored to DETAIL_READ_MS when the detail panel is also on screen, since
    // that needs its own reading time the reading-length formula doesn't know
    // about.
    const delay = Math.max(advanceDelayMs(readText, isCorrect), detailShown ? DETAIL_READ_MS : 0);
    const willSpeak = !!spokenText && audioEnabled() && AudioPlayer.isSupported();
    if (willSpeak) {
      // With audio on, don't cut the spoken reading off: advance only once BOTH
      // the reading pause has elapsed AND the utterance has finished. renderGen
      // + the screen check guard against a late speech callback (from quitting
      // or retrying mid-reading) triggering a stray skip.
      const gen = renderGen;
      let waited = false;
      let spoken = false;
      const maybeAdvance = () => {
        if (waited && spoken && gen === renderGen && state.screen === 'quiz') advanceQuestion();
      };
      advanceTimer = setTimeout(() => { advanceTimer = null; waited = true; maybeAdvance(); }, delay);
      speakReading(spokenText, () => { spoken = true; maybeAdvance(); });
    } else {
      advanceTimer = setTimeout(advanceQuestion, delay);
    }
  } else {
    // Manual advance: speak the reading (forward modes), then wait.
    if (spokenText) speakReading(spokenText);
    armContinue();
  }
}

// One review row. Reverse mode's "answer" is a reading (correctReading holds
// the kanji there — see buildReverseQuestion), so it shows the kanji as the
// prompt and the reading as the answer, the mirror of the forward rows.
function summaryRowHTML(q) {
  const answer = state.mode === 'reverse' ? q.reading : q.correctReading;
  return `<span>${escapeHTML(q.text)}</span><span class="missed-item-meaning">${escapeHTML(q.meaning)}</span><span>${readingHTML(answer)}</span>`;
}

function showSummary() {
  showScreen('summary');
  // state.index, not state.roundTotal: they match on the normal path, but
  // index is the actual count answered even if a round ended early (the
  // defensive "pool exhausted" branch in renderQuestion).
  el.summaryScore.innerHTML = `${state.score} / ${state.index} 正解<span>Correct</span>`;
  el.summaryMissed.innerHTML = '';
  if (state.missed.length > 0) {
    const heading = document.createElement('h3');
    heading.textContent = 'まちがえたもの';
    el.summaryMissed.appendChild(heading);
    state.missed.forEach((q) => {
      const row = document.createElement('div');
      row.className = 'missed-item';
      row.innerHTML = summaryRowHTML(q);
      el.summaryMissed.appendChild(row);
    });
  }

  el.summaryCorrect.innerHTML = '';
  if (state.correctItems.length > 0) {
    const details = document.createElement('details');
    details.className = 'summary-correct-details';
    const summary = document.createElement('summary');
    summary.textContent = `せいかいしたもの（${state.correctItems.length}）`;
    details.appendChild(summary);
    state.correctItems.forEach((q) => {
      const row = document.createElement('div');
      row.className = 'missed-item';
      row.innerHTML = summaryRowHTML(q);
      details.appendChild(row);
    });
    el.summaryCorrect.appendChild(details);
  }
}
