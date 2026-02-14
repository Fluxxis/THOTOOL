function normEmail(e){
  return (e || "").trim();
}

export default async function handler(req, res) {
  const email = normEmail(req.query.email);
  if (!email || email.length > 254 || !email.includes("@")) {
    res.status(400).json({ ok: false, error: "Invalid email" });
    return;
  }

  // EVA (PingUtil) - free, no key
  const url = new URL("https://api.eva.pingutil.com/email");
  url.searchParams.set("email", email);

  try {
    const r = await fetch(url.toString(), { headers: { "accept": "application/json" } });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j) {
      res.status(502).json({ ok: false, error: `Email service error ${r.status || ""}`.trim() });
      return;
    }

    if (j.status !== "success" || !j.data) {
      res.status(502).json({ ok: false, error: j?.message || "Email service error", data: j });
      return;
    }

    const d = j.data || {};
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      data: {
        email_address: d.email_address || email,
        domain: d.domain || (email.split("@")[1] || ""),
        valid_syntax: !!d.valid_syntax,
        deliverable: d.deliverable === true,
        disposable: d.disposable === true
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Network error" });
  }
}
