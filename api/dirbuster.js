import fetch from 'node-fetch';

// Встроенный словарь (первые 200 самых популярных)
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
  'robots.txt', 'sitemap.xml', 'sitemap', 'crossdomain.xml', 'clientaccesspolicy.xml',
  'web.config', '.htaccess', '.htpasswd', '.bash_history', '.mysql_history',
  'info.php', 'test.php', 'phpinfo.php', 'info', 'status', 'health',
  'healthcheck', 'ping', 'pong', 'stats', 'statistics', 'metrics',
  'monitoring', 'monitor', 'graph', 'graphs', 'dashboard', 'dash',
  'manager', 'manage', 'management', 'administrator', 'administracion',
  'adminarea', 'adminpanel', 'cpanel', 'whm', 'webmail', 'mail',
  'email', 'imap', 'pop3', 'smtp', 'ftp', 'ftps', 'sftp',
  'ssh', 'telnet', 'rdp', 'vnc', 'remote', 'desktop', 'remote-desktop',
  'owa', 'exchange', 'webaccess', 'webmail', 'mail', 'roundcube',
  'squirrelmail', 'horde', 'rainloop', 'webmail', 'zimbra', 'zimlet',
  'calendar', 'cal', 'contacts', 'addressbook', 'tasks', 'notes',
  'doc', 'docs', 'document', 'documents', 'file', 'files', 'folder',
  'folders', 'directory', 'directories', 'list', 'listing', 'index',
  'default', 'home', 'main', 'portal', 'gateway', 'login', 'signin',
  'signup', 'register', 'registration', 'profile', 'user', 'users',
  'account', 'accounts', 'member', 'members', 'customer', 'customers',
  'client', 'clients', 'partner', 'partners', 'affiliate', 'affiliates',
  'forum', 'forums', 'board', 'boards', 'chat', 'talk', 'discuss',
  'discussion', 'support', 'help', 'faq', 'knowledgebase', 'kb',
  'wiki', 'mediawiki', 'dokuwiki', 'confluence', 'jira', 'bugtracker',
  'bug', 'bugs', 'tracker', 'mantis', 'redmine', 'trac', 'gitlab',
  'github', 'bitbucket', 'repository', 'repo', 'code', 'source',
  'src', 'svn', 'cvs', 'hg', 'mercurial', 'bzr', 'git', 'gitweb',
  'cgit', 'stash', 'fisheye', 'crucible', 'review', 'reviews',
  'test', 'tests', 'testing', 'qa', 'quality', 'assurance',
  'stage', 'staging', 'dev', 'development', 'sandbox', 'sandboxes',
  'demo', 'demos', 'example', 'examples', 'sample', 'samples',
  'tutorial', 'tutorials', 'guide', 'guides', 'doc', 'docs',
  'documentation', 'manual', 'manuals', 'help', 'helps', 'faq',
  'faqs', 'support', 'supports', 'knowledge', 'knowledgebase',
  'kb', 'wiki', 'wikis', 'blog', 'blogs', 'news', 'newsletter',
  'mailinglist', 'list', 'lists', 'archive', 'archives', 'history',
  'changelog', 'changes', 'release', 'releases', 'version', 'versions',
  'v1', 'v2', 'v3', 'api', 'apis', 'rest', 'restful', 'soap',
  'xml', 'json', 'rss', 'atom', 'feed', 'feeds', 'rdf', 'rss',
  'atom', 'opml', 'opensearch', 'search', 'searching', 'find',
  'finder', 'lookup', 'lookups', 'resolve', 'resolver', 'dns',
  'whois', 'geoip', 'geolocation', 'location', 'locate', 'locator',
  'map', 'maps', 'place', 'places', 'address', 'addresses',
  'geocode', 'geocoding', 'reverse-geocode', 'reverse-geocoding'
];

export default async function handler(req, res) {
  // Только GET запросы
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { url, exts } = req.query;
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  }

  // Базовый URL
  let baseUrl = url.trim();
  if (!baseUrl.startsWith('http')) {
    baseUrl = 'http://' + baseUrl;
  }
  // Убираем trailing slash
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

  const extensions = exts ? exts.split(',').map(e => e.trim()).filter(Boolean) : ['php','html','htm','asp','aspx','jsp','do','txt','bak','zip','tar.gz','sql'];

  // Формируем список путей: все комбинации с расширениями и без
  const paths = [];
  for (const word of WORDLIST) {
    // путь без расширения (директория)
    paths.push(word + '/');
    // файлы с расширениями
    for (const ext of extensions) {
      paths.push(word + '.' + ext);
    }
  }

  // Ограничим количество запросов, чтобы не превысить таймаут Vercel (макс 60 сек)
  const MAX_CHECKS = 100; // можно настроить
  const toCheck = paths.slice(0, MAX_CHECKS);

  const results = [];
  const errors = [];

  await Promise.all(toCheck.map(async (path) => {
    const testUrl = baseUrl + '/' + path;
    try {
      const response = await fetch(testUrl, {
        method: 'HEAD', // только заголовки, быстрее
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DirBuster/1.0)' }
      });
      const status = response.status;
      // Интересны коды 200, 301, 302, 403 (существует, но закрыто)
      if ([200, 301, 302, 403, 401].includes(status)) {
        results.push({ path, status, url: testUrl });
      }
    } catch (e) {
      errors.push({ path, error: e.message });
    }
  }));

  return res.status(200).json({
    ok: true,
    data: {
      baseUrl,
      checked: toCheck.length,
      found: results,
      errors: errors.slice(0, 20) // ограничим вывод ошибок
    }
  });
}