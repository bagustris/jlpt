// User preferences (as opposed to js/progress.js, which tracks learning
// history), saved to their own localStorage entry so resetting progress
// never wipes a user's configured preferences and vice versa.

const SettingsManager = (() => {
  const STORAGE_KEY = 'jlpt-quiz-settings';
  // autoNext defaults to true: after answering, the quiz advances after a short
  // timed pause. Turning it off makes it wait for a tap/keypress instead, which
  // suits the post-answer detail panel (on'yomi/kun'yomi, compounds, pitch
  // accent) when you want unlimited time to read it.
  // playAudio defaults to false (spoken readings off); turning it on speaks the
  // reading. It stays a real boolean here (audioEnabled() in app.js still
  // treats a legacy `null` from earlier versions as "never chosen").
  const DEFAULTS = { showMeaning: true, roundSize: 10, autoNext: true, playAudio: false };

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
