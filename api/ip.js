// IP lookup + enrichment.
// Primary upstream: ip-api.com (free over HTTP).
// Adds:
//  - _meta: derived info (ip version + IPv4 classification)
//  - _ptr: reverse DNS (PTR) via DNS-over-HTTPS
//  - _rdap: registration info via rdap.org (best-effort)

import net from "node:net";

function isIPv4(ip){ return net.isIP(ip) === 4; }
function isIPv6(ip){ return net.isIP(ip) === 6; }

function classifyIPv4(ip){
  const parts = ip.split(".").map(x => Number(x));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return { ok:false };
  const [a,b] = parts;

  const inRange = (p, a1,a2,b1,b2,c1,c2,d1,d2)=>{
    const v = (p[0]<<24) + (p[1]<<16) + (p[2]<<8) + p[3];
    const s = (a1<<24)+(b1<<16)+(c1<<8)+d1;
    const e = (a2<<24)+(b2<<16)+(c2<<8)+d2;
    return v >= s && v <= e;
  };

  const isLoopback = a === 127;
  const isLinkLocal = a === 169 && b === 254;
  const isPrivate = (a === 10) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  const isCarrierGradeNAT = a === 100 && b >= 64 && b <= 127;
  const isMulticast = a >= 224 && a <= 239;
  const isBroadcast = ip === "255.255.255.255";
  const isUnspecified = ip === "0.0.0.0";
  const isDocumentation =
    inRange(parts, 192,192, 0,0, 2,2, 0,255) ||
    inRange(parts, 198,198, 51,51, 100,100, 0,255) ||
    inRange(parts, 203,203, 0,0, 113,113, 0,255);
  const isBenchmark = inRange(parts, 198,198, 18,18, 0,19, 0,255);
  const isReserved = isBroadcast || isUnspecified || isDocumentation || isBenchmark;

  return {
    ok:true,
    is_private: isPrivate,
    is_loopback: isLoopback,
    is_link_local: isLinkLocal,
    is_cgnat: isCarrierGradeNAT,
    is_multicast: isMulticast,
    is_reserved: isReserved,
    is_broadcast: isBroadcast,
    is_unspecified: isUnspecified,
    is_documentation: isDocumentation,
  };
}

function ipv6ToArpa(ip){
  try{
    const raw = ip.toLowerCase();
    if(!raw.includes(":")) return null;
    const [left, right] = raw.split("::");
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = (raw.includes("::") && right) ? right.split(":").filter(Boolean) : [];
    const fill = 8 - (leftParts.length + rightParts.length);
    if(fill < 0) return null;
    const parts = [
      ...leftParts,
      ...Array(fill).fill("0"),
      ...rightParts,
    ].map(p => p.padStart(4,"0"));
    const hex = parts.join("");
    return hex.split("").reverse().join(".") + ".ip6.arpa";
  }catch{ return null; }
}

function ipv4ToArpa(ip){
  return ip.split(".").reverse().join(".") + ".in-addr.arpa";
}

async function fetchJson(url, { timeoutMs = 7000, headers = {} } = {}){
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const r = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    const ctype = (r.headers.get("content-type") || "").toLowerCase();
    let data = {};
    if(ctype.includes("application/json")) data = await r.json().catch(()=> ({}));
    else data = await r.text().catch(()=> "");
    return { ok: r.ok, status: r.status, data };
  }catch(e){
    if(e && e.name === "AbortError") return { ok:false, status: 504, data: { message: "Timeout" } };
    return { ok:false, status: 502, data: { message: "Network error" } };
  }finally{
    clearTimeout(timer);
  }
}

async function reversePTR(ip){
  const arpa = isIPv4(ip) ? ipv4ToArpa(ip) : (isIPv6(ip) ? ipv6ToArpa(ip) : null);
  if(!arpa) return null;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(arpa)}&type=PTR`;
  const r = await fetchJson(url, { timeoutMs: 4000 });
  if(!r.ok) return null;
  const ans = Array.isArray(r.data?.Answer) ? r.data.Answer : [];
  const ptr = ans.find(a => a?.type === 12 && typeof a?.data === "string");
  return ptr?.data ? String(ptr.data).replace(/\.$/, "") : null;
}

async function fetchRdap(ip){
  const url = `https://rdap.org/ip/${encodeURIComponent(ip)}`;
  const r = await fetchJson(url, { timeoutMs: 6000 });
  if(!r.ok) return null;
  return (r.data && typeof r.data === "object") ? r.data : null;
}

function buildMapUrl(lat, lon){
  if(lat == null || lon == null) return null;
  const a = Number(lat), b = Number(lon);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=12/${a}/${b}`;
}

function firstForwardedFor(req){
  const h = String(req.headers["x-forwarded-for"] || "");
  const ip = h.split(",").map(s => s.trim()).find(Boolean);
  return ip || "";
}

function parseAsNumber(asString){
  const s = String(asString || "");
  const m = s.match(/\bAS(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

export default async function handler(req, res) {
  const q = String(req.query.ip || "").trim();
  const fromHeader = firstForwardedFor(req);
  const target = q || fromHeader;

  if(!target){
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, error: "Введите IP" });
    return;
  }

  if(net.isIP(target) === 0){
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, error: "Invalid IP" });
    return;
  }

  // ip-api.com free plan is HTTP only. Server-to-server requests are fine.
  const fields = [
    "status","message","query",
    "country","countryCode",
    "regionName","region",
    "city","zip",
    "lat","lon",
    "timezone",
    "isp","org",
    "as","asname",
    "reverse",
    "mobile","proxy","hosting",
  ].join(",");
  const url = `http://ip-api.com/json/${encodeURIComponent(target)}?fields=${encodeURIComponent(fields)}`;
  const up = await fetchJson(url, { timeoutMs: 7000 });

  const body = (up.data && typeof up.data === "object") ? up.data : {};
  const logicalOk = body?.status === "success";
  if(!up.ok || !logicalOk){
    const msg = body?.message || (up.status === 429 ? "Rate limit exceeded" : "Upstream error");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, error: msg, status: up.status || 0 });
    return;
  }

  const ipUsed = String(body.query || target).trim();
  const meta = {
    ip: ipUsed,
    ip_version: isIPv4(ipUsed) ? 4 : (isIPv6(ipUsed) ? 6 : 0),
    fetched_at_iso: new Date().toISOString(),
  };
  if(isIPv4(ipUsed)) Object.assign(meta, classifyIPv4(ipUsed));

  const skipNetEnrich = !!(meta.is_private || meta.is_loopback || meta.is_link_local || meta.is_reserved || meta.is_cgnat);
  const [ptr, rdap] = await Promise.all([
    ipUsed ? reversePTR(ipUsed) : Promise.resolve(null),
    (!skipNetEnrich && ipUsed) ? fetchRdap(ipUsed) : Promise.resolve(null),
  ]);

  const map = buildMapUrl(body.lat, body.lon);
  const asn = parseAsNumber(body.as);

  // Cache explicit lookups a bit, but do not cache "my IP" derived from headers.
  if(q){
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  }else{
    res.setHeader("Cache-Control", "no-store");
  }

  res.status(200).json({
    ok: true,
    data: {
      ip: ipUsed,
      country: body.country || "",
      country_code: body.countryCode || "",
      region: body.regionName || "",
      region_code: body.region || "",
      city: body.city || "",
      postal: body.zip || "",
      timezone: body.timezone || "",
      isp: body.isp || "",
      organization: body.org || "",
      as_number: asn,
      as_text: body.as || "",
      reverse: body.reverse || "",
      latitude: body.lat,
      longitude: body.lon,
      mobile: body.mobile,
      proxy: body.proxy,
      hosting: body.hosting,
      _meta: meta,
      _ptr: ptr,
      _rdap: rdap,
      _raw: body,
    },
    ...(map ? { map } : {}),
  });
}
