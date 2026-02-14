function normDomain(d) {
  return (d || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}
export default async function handler(req, res) {
  const domain = normDomain(req.query.domain);
  if (!domain || domain.length < 3 || !domain.includes(".")) {
    res.status(400).json({ error: "Invalid domain" });
    return;
  }
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
  try {
    const r = await fetch(url, { headers: { "accept": "application/json" } });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      res.status(r.status || 500).json({ error: `crt.sh error ${r.status}` });
      return;
    }
    const set = new Set();
    for (const row of data) {
      const name = (row?.name_value || "").toLowerCase();
      for (const part of name.split("\n")) {
        const s = part.trim();
        if (!s) continue;
        if (s.includes("*")) continue;
        if (s.endsWith("." + domain) || s === domain) set.add(s);
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, domain, count: set.size, subdomains: Array.from(set).sort() });
  } catch (e) {
    res.status(500).json({ error: "Network error" });
  }
}
