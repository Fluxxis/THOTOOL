import sites from "../sites.json" assert { type: "json" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function headOrGet(url, timeoutMs = 3500) {
  const ua = "Mozilla/5.0 (compatible; UsernameChecker/6.0; +https://vercel.com)";

  const tryFetch = async (method, headers) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": ua,
          "accept": "text/html,*/*",
          ...headers
        }
      });
      clearTimeout(t);
      return { status: resp.status, finalUrl: resp.url };
    } catch (e) {
      clearTimeout(t);
      return null;
    }
  };

  // HEAD first (fast). Many sites block it, so fallback to tiny GET.
  let r = await tryFetch("HEAD", {});
  if (r) return r;

  r = await tryFetch("GET", { "range": "bytes=0-0" });
  if (r) return r;

  return { status: "error", finalUrl: url };
}

function normalizeUsername(u) {
  return (u || "").trim();
}

function buildUrl(pattern, u) {
  return pattern.replaceAll("{u}", encodeURIComponent(u));
}

async function runPool(items, worker, concurrency = 4, launchDelayMs = 120) {
  const results = new Array(items.length);
  let idx = 0;

  async function runner() {
    while (true) {
      const current = idx++;
      if (current >= items.length) break;

      if (launchDelayMs > 0) {
        await sleep(launchDelayMs + Math.floor(Math.random() * 80));
      }
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runner());
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  const username = normalizeUsername(req.query.username);
  const total = sites.length;

  const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);

  // Smaller defaults to avoid Vercel function timeouts
  const pageSizeRaw = parseInt(req.query.page_size || "20", 10) || 20;
  const page_size = Math.min(Math.max(pageSizeRaw, 10), 40);

  const concurrencyRaw = parseInt(req.query.concurrency || "4", 10) || 4;
  const concurrency = Math.min(Math.max(concurrencyRaw, 2), 6);

  if (!username || username.length < 2 || username.length > 64) {
    res.status(400).json({ error: "Invalid username (2..64 chars)." });
    return;
  }

  const slice = sites.slice(offset, Math.min(offset + page_size, total));

  const startedAt = Date.now();
  const out = await runPool(
    slice,
    async (entry) => {
      const url = buildUrl(entry.pattern, username);
      const r = await headOrGet(url);
      return {
        name: entry.name,
        kind: entry.kind,
        url,
        status: r.status,
        finalUrl: r.finalUrl
      };
    },
    concurrency,
    120
  );

  const annotated = out.map((x) => {
    const s = x.status;
    let verdict = "unknown";
    if (s === 200 || s === 201) verdict = "maybe";
    else if ([301,302,303,307,308].includes(s)) verdict = "maybe";
    else if (s === 404) verdict = "no";
    else if (s === "error") verdict = "error";
    return { ...x, verdict };
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    username,
    offset,
    page_size,
    total,
    took_ms: Date.now() - startedAt,
    results: annotated
  });
}
