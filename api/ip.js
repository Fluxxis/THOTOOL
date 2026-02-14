// IP lookup + enrichment.
// Returns ipapi.co fields at top-level (for backward compatibility) and adds:
//  - _meta: derived info
//  - _ptr: reverse DNS (PTR) via DNS-over-HTTPS
//  - _rdap: network registration info via rdap.org

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
    inRange(parts, 192,192, 0,0, 2,2, 0,255) ||   // 192.0.2.0/24
    inRange(parts, 198,198, 51,51, 100,100, 0,255) || // 198.51.100.0/24
    inRange(parts, 203,203, 0,0, 113,113, 0,255); // 203.0.113.0/24
  const isBenchmark = inRange(parts, 198,198, 18,18, 0,19, 0,255); // 198.18.0.0/15 (rough)
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
  // Expand and convert to nibble-reversed ip6.arpa.
  // Minimal implementation; if parsing fails, return null.
  try{
    const raw = ip.toLowerCase();
    if(!raw.includes(":")) return null;

    // Split on ::
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
  }catch{
    return null;
  }
}

function ipv4ToArpa(ip){
  return ip.split(".").reverse().join(".") + ".in-addr.arpa";
}

async function fetchJson(url){
  const r = await fetch(url, { headers: { "accept": "application/json" } });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function reversePTR(ip){
  const arpa = isIPv4(ip) ? ipv4ToArpa(ip) : (isIPv6(ip) ? ipv6ToArpa(ip) : null);
  if(!arpa) return null;

  // Google DNS-over-HTTPS
  const url = `https://dns.google/resolve?name=${encodeURIComponent(arpa)}&type=PTR`;
  const r = await fetchJson(url);
  if(!r.ok) return null;
  const ans = Array.isArray(r.data?.Answer) ? r.data.Answer : [];
  const ptr = ans.find(a => a?.type === 12 && typeof a?.data === "string");
  return ptr?.data ? String(ptr.data).replace(/\.$/, "") : null;
}

async function fetchRdap(ip){
  const url = `https://rdap.org/ip/${encodeURIComponent(ip)}`;
  const r = await fetchJson(url);
  if(!r.ok) return null;
  return r.data;
}

function buildMapUrl(lat, lon){
  if(lat == null || lon == null) return null;
  const a = Number(lat), b = Number(lon);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=12/${a}/${b}`;
}

export default async function handler(req, res) {
  const ip = (req.query.ip || "").trim();
  const target = ip && ip.length > 1 ? ip : ""; // empty = caller IP

  const url = `https://ipapi.co/${encodeURIComponent(target)}/json/`;

  try {
    const r = await fetch(url, { headers: { "accept": "application/json" } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status).json({ error: data?.reason || data?.error || `Upstream error ${r.status}` });
      return;
    }

    const ipUsed = (data?.ip || target || "").trim();

    // Derived meta
    const meta = {
      ip: ipUsed,
      ip_version: isIPv4(ipUsed) ? 4 : (isIPv6(ipUsed) ? 6 : 0),
      fetched_at_iso: new Date().toISOString(),
    };

    if(isIPv4(ipUsed)) Object.assign(meta, classifyIPv4(ipUsed));

    // Enrichment (best-effort)
    const [ptr, rdap] = await Promise.all([
      ipUsed ? reversePTR(ipUsed) : Promise.resolve(null),
      ipUsed ? fetchRdap(ipUsed) : Promise.resolve(null),
    ]);

    const map = buildMapUrl(data?.latitude, data?.longitude);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      // Keep original ipapi fields at top-level for existing UI/tools
      data: {
        ...data,
        _meta: meta,
        _ptr: ptr,
        _rdap: rdap,
      },
      ...(map ? { map } : {}),
    });
  } catch (_e) {
    res.status(500).json({ error: "Network error" });
  }
}
