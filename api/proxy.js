import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { proxy } = req.query;
    if (!proxy) {
      return res.status(400).json({ ok: false, error: 'Missing proxy parameter' });
    }

    // Ожидаемый формат: ip:port или protocol://ip:port
    let proxyUrl = proxy.trim();
    if (!proxyUrl.includes('://')) {
      proxyUrl = 'http://' + proxyUrl; // по умолчанию http
    }

    // Проверяем, работает ли прокси, делая запрос к тестовому серверу (например, httpbin.org/ip)
    const testUrl = 'http://httpbin.org/ip';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(testUrl, {
        agent: new HttpsProxyAgent(proxyUrl),
        signal: controller.signal,
        timeout: 8000
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({
          ok: true,
          data: {
            proxy: proxy,
            working: true,
            externalIp: data.origin,
            message: 'Proxy is working'
          }
        });
      } else {
        return res.status(200).json({
          ok: true,
          data: {
            proxy: proxy,
            working: false,
            message: `Proxy returned status ${response.status}`
          }
        });
      }
    } catch (error) {
      clearTimeout(timeout);
      return res.status(200).json({
        ok: true,
        data: {
          proxy: proxy,
          working: false,
          message: error.message
        }
      });
    }
  } catch (error) {
    console.error('Proxy checker error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}