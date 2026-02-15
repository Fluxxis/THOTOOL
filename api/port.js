import net from 'net';

// Список популярных портов для сканирования (можно расширить)
const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5900, 8080, 8443
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { host, ports } = req.query;
    if (!host) {
      return res.status(400).json({ ok: false, error: 'Missing host parameter' });
    }

    // Если передан список портов через запятую, используем его, иначе сканируем популярные
    let portList = COMMON_PORTS;
    if (ports) {
      portList = ports.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0 && p < 65536);
      if (portList.length === 0) {
        return res.status(400).json({ ok: false, error: 'Invalid ports list' });
      }
    }

    const openPorts = [];
    const timeout = 2000; // таймаут на каждый порт (мс)

    // Сканируем порты последовательно, чтобы не перегружать сеть
    for (const port of portList.slice(0, 50)) { // ограничим 50 портами за раз
      const isOpen = await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, host);
      });

      if (isOpen) {
        openPorts.push(port);
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        host,
        scanned: portList.length,
        openPorts
      }
    });
  } catch (error) {
    console.error('Port scanner error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}