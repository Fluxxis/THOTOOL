import net from "net";
import dns from "dns/promises";

const DEFAULT_TIMEOUT = 1500;
const MAX_CONCURRENT = 50;

function isValidTarget(target) {
  const ipRegex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return ipRegex.test(target) || domainRegex.test(target);
}

async function resolveTarget(target) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target)) return target;
  const res = await dns.lookup(target);
  return res.address;
}

function scanPort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = "closed";

    socket.setTimeout(timeout);

    socket.once("connect", () => {
      status = "open";
      socket.destroy();
    });

    socket.once("timeout", () => socket.destroy());
    socket.once("error", () => {});
    socket.once("close", () => resolve({ port, status }));

    socket.connect(port, host);
  });
}

async function scanPorts(host, ports) {
  const results = [];
  const queue = [...ports];

  async function worker() {
    while (queue.length) {
      const port = queue.shift();
      const result = await scanPort(host, port, DEFAULT_TIMEOUT);
      results.push(result);
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENT }, worker);
  await Promise.all(workers);

  return results.sort((a, b) => a.port - b.port);
}

export default async function handler(req, res) {
  try {
    const { target, ports } = req.query;

    if (!target || !isValidTarget(target)) {
      return res.status(400).json({ ok: false, error: "Invalid target" });
    }

    const host = await resolveTarget(target);

    const portList = ports
      ? ports.split(",").map(p => parseInt(p.trim(), 10)).filter(Boolean)
      : [21,22,23,25,53,80,110,143,443,3306,8080];

    const results = await scanPorts(host, portList);

    res.status(200).json({
      ok: true,
      target: host,
      scanned: portList.length,
      open: results.filter(r => r.status === "open").map(r => r.port),
      results
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: "Scan failed" });
  }
}
