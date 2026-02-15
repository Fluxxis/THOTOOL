import fetch from 'node-fetch';

// Встроенный словарь (первые 100 самых популярных для экономии времени)
const WORDLIST = [
  'admin', 'wp-admin', 'wp-content', 'wp-includes', 'backup', 'backups',
  'css', 'js', 'images', 'img', 'assets', 'static', 'public', 'private',
  'upload', 'uploads', 'download', 'downloads', 'files', 'data', 'temp',
  'tmp', 'logs', 'log', 'config', 'configuration', 'settings', 'include',
  'includes', 'src', 'source', 'test', 'tests', 'dev', 'development',
  'staging', 'prod', 'production', 'api', 'rest', 'v1', 'v2', 'graphql',
  'phpmyadmin', 'pma', 'mysql', 'db', 'database', 'sql', 'php', 'html',
  'htm', 'asp', 'aspx', 'jsp', 'do', 'cgi', 'cgi-bin', 'bin', 'sbin',
  'vendor', 'node_modules', 'lib', 'libs', 'vendor', 'composer', 'npm',
  'git', 'svn', '.git', '.svn', '.env', '.htaccess', '.htpasswd',
  'robots.txt', 'sitemap.xml', 'sitemap', 'crossdomain.xml'
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { url, exts } = req.query;
    if (!url) {
      return res.status(400).json({ ok: false, error: 'Missing url parameter' });
    }

    let baseUrl = url.trim();
    if (!baseUrl.startsWith('http')) {
      baseUrl = 'http://' + baseUrl;
    }
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    const extensions = exts ? exts.split(',').map(e => e.trim()).filter(Boolean) : ['php','html','htm','asp','aspx','jsp','do','txt','bak','zip','tar.gz','sql'];

    // Формируем список путей: все комбинации с расширениями и без
    const paths = [];
    for (const word of WORDLIST) {
      paths.push(word + '/');
      for (const ext of extensions) {
        paths.push(word + '.' + ext);
      }
    }

    // Ограничим количество запросов, чтобы не превысить таймаут Vercel (макс 10 сек)
    const MAX_CHECKS = 50; // можно уменьшить для быстродействия
    const toCheck = paths.slice(0, MAX_CHECKS);

    const results = [];
    const errors = [];

    // Выполняем запросы параллельно, но с контролем таймаута
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    await Promise.all(toCheck.map(async (path) => {
      const testUrl = baseUrl + '/' + path;
      try {
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DirBuster/1.0)' }
        });
        const status = response.status;
        if ([200, 301, 302, 403, 401].includes(status)) {
          results.push({ path, status, url: testUrl });
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          errors.push({ path, error: e.message });
        }
      }
    }));

    clearTimeout(timeout);

    return res.status(200).json({
      ok: true,
      data: {
        baseUrl,
        checked: toCheck.length,
        found: results,
        errors: errors.slice(0, 20)
      }
    });
  } catch (error) {
    console.error('Dirbuster error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}