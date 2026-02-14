export default async function handler(req, res) {
  const q = (req.query.q || "").trim();
  const type = (req.query.type || "users").trim();
  if (!q || q.length < 2 || q.length > 80) {
    res.status(400).json({ error: "Query must be 2..80 chars" });
    return;
  }
  const endpoint = type === "repositories"
    ? "https://api.github.com/search/repositories"
    : "https://api.github.com/search/users";
  const url = new URL(endpoint);
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", "20");

  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "tools-hub-vercel"
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["authorization"] = `Bearer ${token}`;

  try {
    const r = await fetch(url.toString(), { headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status).json({ error: data?.message || `GitHub error ${r.status}`, data });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    res.status(200).json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: "Network error" });
  }
}
