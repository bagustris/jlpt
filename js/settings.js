// User preferences (as opposed to js/progress.js, which tracks learning
// history), saved to their own localStorage entry so resetting progress
// never wipes a user's configured preferences and vice versa.

const SettingsManager = (() => {
  const STORAGE_KEY = 'jlpt-quiz-settings';
  // autoNext defaults to off: the post-answer detail panel (on'yomi/kun'yomi,
  // compounds, pitch accent) is worth reading, and a fixed timer is always
  // wrong for someone — too short for an N1 kanji with several compounds,
  // too long for a one-line N5 entry. Off means the learner taps/presses a
  // key to advance instead.
  const DEFAULTS = { showMeaning: true, roundSize: 10, autoNext: false };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — fail silently
    }
  }

  function get(key) {
    return load()[key];
  }

  function set(key, value) {
    const settings = load();
    settings[key] = value;
    save(settings);
  }

  return { get, set };
})();
