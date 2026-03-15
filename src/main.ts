import './style.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Video {
  videoId: string;
  title: string;
}

interface InvidiousItem {
  videoId?: string;
  title?: string;
  type?: string;
  lengthSeconds?: number;
}

interface RssItem {
  link?: string;
  title?: string;
  description?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CHANNEL_ID = 'UC7tfwBouSjBIcFegohPa0tQ';

/**
 * Hard-coded fallback: the 3 most recent confirmed long-form vlogs.
 * These are shown when the live API fetch returns fewer than 3 results.
 * Update this list whenever a new long-form vlog is published.
 */
const STATIC_FALLBACK: Video[] = [
  { videoId: 'pgwE8r7Pp_w', title: 'Singapore Tour Itinerary: Trip Planning, Best Locations & Full Budget' },
  { videoId: 'TVWzz1GAGBs', title: 'DJI Mini 5 Pro: Full Review in Marathi | Best Drone 2025 India' },
  { videoId: 'IQze6y2uXfo', title: 'Best Monsoon Spots near Pune | Hidden Waterfall' },
];

/**
 * Invidious instances to try (in order).
 * In dev, Vite proxies /inv-proxy/* → https://inv.nadeko.net/api/v1/*
 * so the browser never makes a cross-origin request.
 */
const INVIDIOUS_INSTANCES: string[] = import.meta.env.DEV
  ? ['__dev_proxy__']
  : [
      'https://inv.nadeko.net',
      'https://invidious.privacyredirect.com',
      'https://yewtu.be',
      'https://invidious.nerdvpn.de',
    ];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const grid = document.getElementById('vlogsGrid') as HTMLElement;

/** Returns the Invidious API URL for a given instance and page. */
function invidiousUrl(instance: string, page: number): string {
  const path = `/channels/${CHANNEL_ID}/videos?sort_by=newest&page=${page}`;
  return instance === '__dev_proxy__'
    ? `/inv-proxy${path}` // routed through Vite proxy → inv.nadeko.net/api/v1
    : `${instance}/api/v1${path}`;
}

/** Resolves true only if YouTube serves a horizontal thumbnail (not a 120px Short placeholder). */
function thumbOk(videoId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 121);
    img.onerror = () => resolve(false);
    img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  });
}

/** Renders video cards into the grid. */
function renderVideos(videos: Video[]): void {
  grid.innerHTML = videos
    .map((v) => {
      const link = `https://www.youtube.com/watch?v=${v.videoId}`;
      const thumb = `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`;
      const title = (v.title ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return (
        `<div class="content-card">` +
        `<div class="card-img-container"><a href="${link}" target="_blank">` +
        `<img src="${thumb}" alt="${title}" loading="lazy">` +
        `</a></div>` +
        `<div class="card-content"><h3>${title}</h3>` +
        `<a href="${link}" target="_blank">Watch on YouTube</a>` +
        `</div></div>`
      );
    })
    .join('');
}

/** Shows a friendly error with a link to the YouTube channel. */
function renderError(): void {
  grid.innerHTML =
    `<p style="color:#888;padding:10px">Could not load videos. ` +
    `<a href="https://youtube.com/@onroadcouple" target="_blank">Visit our YouTube channel →</a></p>`;
}

/**
 * Filters raw video items: must have a valid videoId, not be a Short by type,
 * have duration > 3 min, AND pass the horizontal thumbnail check.
 */
async function filterHorizontal(candidates: InvidiousItem[]): Promise<Video[]> {
  const eligible = candidates.filter(
    (v): v is Required<Pick<InvidiousItem, 'videoId'>> & InvidiousItem =>
      Boolean(v.videoId) &&
      v.type !== 'shortVideo' &&
      v.type !== 'short' &&
      (v.lengthSeconds ?? 0) > 180,
  );

  const results = await Promise.all(
    eligible.map(async (v) => {
      const ok = await thumbOk(v.videoId!);
      return ok
        ? ({ videoId: v.videoId!, title: v.title ?? '' } as Video)
        : null;
    }),
  );
  return results.filter((v): v is Video => v !== null);
}

// ─── Data sources ─────────────────────────────────────────────────────────────

/** Tries a single Invidious instance, paginating until 3 horizontal videos are found. */
async function fetchFromInvidious(instance: string): Promise<Video[]> {
  const found: Video[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = invidiousUrl(instance, page);
    const data = await fetch(url, { signal: AbortSignal.timeout(7000) }).then(
      (r) => r.json() as Promise<InvidiousItem[] | { videos?: InvidiousItem[] }>,
    );
    const items: InvidiousItem[] = Array.isArray(data) ? data : (data.videos ?? []);
    if (!items.length) break;

    const batch = await filterHorizontal(items);
    for (const v of batch) {
      if (!found.find((x) => x.videoId === v.videoId)) found.push(v);
      if (found.length >= 3) return found;
    }
  }
  return found;
}

/** Iterates through all Invidious instances, returning the first batch ≥ 3 videos. */
async function tryAllInvidious(): Promise<Video[]> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const videos = await fetchFromInvidious(instance);
      if (videos.length > 0) return videos;
    } catch {
      // try next instance
    }
  }
  return [];
}

/** Fetches videos via the rss2json → YouTube RSS fallback path. */
async function tryRssFallback(): Promise<Video[]> {
  const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
  const API = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}`;

  const data = (await fetch(API).then((r) => r.json())) as { items?: RssItem[] };
  if (!data.items?.length) return [];

  const candidates: InvidiousItem[] = [];
  for (const v of data.items) {
    if (
      !(v.link ?? '').includes('/shorts/') &&
      !(`${v.title ?? ''} ${v.description ?? ''}`).toLowerCase().includes('#short')
    ) {
      const id = (v.link ?? '').split('v=')[1];
      if (id) candidates.push({ videoId: id, title: v.title, type: 'video', lengthSeconds: 999 });
    }
  }

  return filterHorizontal(candidates);
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function loadVlogs(): Promise<void> {
  // 1. Try Invidious (paginated, finds videos beyond the last 15)
  let videos: Video[] = [];
  try {
    videos = await tryAllInvidious();
  } catch { /* continue */ }

  // 2. If still < 3, try RSS (last ~15 uploads)
  if (videos.length < 3) {
    try {
      const rssVideos = await tryRssFallback();
      for (const v of rssVideos) {
        if (!videos.find((x) => x.videoId === v.videoId)) videos.push(v);
        if (videos.length >= 3) break;
      }
    } catch { /* continue */ }
  }

  // 3. If still < 3, pad with the static fallback (known non-Short videos)
  if (videos.length < 3) {
    for (const v of STATIC_FALLBACK) {
      if (videos.length >= 3) break;
      if (!videos.find((x) => x.videoId === v.videoId)) videos.push(v);
    }
  }

  if (videos.length > 0) renderVideos(videos);
  else renderError();
}

loadVlogs();
