function normDomain(d) {
  return (d || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}
export default async function handler(req, res) {
  const domain = normDomain(req.query.domain);
  if (!domain || domain.length < 3 || !domain.includes(".")) {
    res.status(400).json({ error: "Invalid domain" });
    return;
  }
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    const r = await fetch(url, { headers: { "accept": "application/rdap+json,application/json" } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status).json({ error: data?.error || `RDAP error ${r.status}`, data });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: "Network error" });
  }
}
