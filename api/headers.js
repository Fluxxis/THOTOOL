function normUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    return url.toString();
  } catch {
    return null;
  }
}
export default async function handler(req, res) {
  const url = normUrl(req.query.url);
  if (!url) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, url: r.url, status: r.status, headers });
  } catch (e) {
    res.status(500).json({ error: "Fetch failed (blocked/timeout)" });
  }
}
