const CACHE_VERSION = 'jlpt-quiz-v7';

const CORE_ASSETS = [
  '.',
  'index.html',
  'style.css',
  'manifest.json',
  'js/settings.js',
  'js/audio.js',
  'js/progress.js',
  'js/progress-view.js',
  'js/learning/QuestionSelectionStrategy.js',
  'js/learning/review/ReviewSchedulerConfig.js',
  'js/learning/review/ReviewScheduler.js',
  'js/learning/strategies/WeightedScoreStrategy.js',
  'js/learning/strategies/SpacedRepetitionStrategy.js',
  'js/learning/QuestionSelectorConfig.js',
  'js/learning/QuestionSelector.js',
  'js/learning/distractors/DistractorStrategy.js',
  'js/learning/distractors/features/SimilarityFeatures.js',
  'js/learning/distractors/strategies/WeightedDistractorStrategy.js',
  'js/learning/distractors/DistractorConfig.js',
  'js/learning/distractors/DistractorGenerator.js',
  'js/app.js',
  'data/kanji-n1.json',
  'data/kanji-n2.json',
  'data/kanji-n3.json',
  'data/kanji-n4.json',
  'data/kanji-n5.json',
  'data/compounds-n1.json',
  'data/compounds-n2.json',
  'data/compounds-n3.json',
  'data/compounds-n4.json',
  'data/compounds-n5.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate: serve from cache instantly, then refresh the
// cache in the background so the app works fully offline while still
// picking up updates whenever the network is available.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
