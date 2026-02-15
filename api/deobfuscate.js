import beautify from 'js-beautify';
import { minify } from 'uglify-js';
import * as phpUnserialize from 'php-unserialize';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { mode, lang } = req.query;
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Missing code' });
  }

  try {
    let result = '';
    const langLower = (lang || 'js').toLowerCase();

    if (mode === 'deobfuscate') {
      // Попытка декомпрессии/деобфускации
      if (langLower === 'js') {
        // Используем js-beautify для форматирования
        result = beautify(code, { indent_size: 2, space_in_empty_paren: true });
      } else if (langLower === 'html') {
        result = beautify.html(code, { indent_size: 2 });
      } else if (langLower === 'php') {
        // Для PHP просто удаляем лишние пробелы и форматируем (нет библиотеки, упрощенно)
        result = code.replace(/\?>\s*<\?php/g, '?>\n<?php')
          .replace(/\s+/g, ' ')
          .replace(/[{;}]/g, "$&\n")
          .replace(/\n\s*\n/g, '\n');
      } else {
        result = code;
      }
    } else if (mode === 'obfuscate') {
      // Минификация/обфускация
      if (langLower === 'js') {
        const minified = minify(code);
        if (minified.error) throw new Error(minified.error);
        result = minified.code;
      } else if (langLower === 'html') {
        // Просто удаляем лишние пробелы
        result = code.replace(/\s+/g, ' ').replace(/> </g, '><');
      } else if (langLower === 'php') {
        // Удаляем комментарии и лишние пробелы (грубо)
        result = code
          .replace(/\/\/.*?\n/g, '')
          .replace(/#.*?\n/g, '')
          .replace(/\/\*.*?\*\//gs, '')
          .replace(/\s+/g, ' ');
      } else {
        result = code;
      }
    } else {
      return res.status(400).json({ ok: false, error: 'Invalid mode' });
    }

    return res.status(200).json({
      ok: true,
      data: {
        originalLength: code.length,
        resultLength: result.length,
        result
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}