import beautify from 'js-beautify';
import { minify } from 'uglify-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { mode, lang } = req.query;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ ok: false, error: 'Missing code' });
    }

    let result = '';
    const langLower = (lang || 'js').toLowerCase();

    if (mode === 'deobfuscate') {
      if (langLower === 'js') {
        result = beautify(code, { indent_size: 2, space_in_empty_paren: true });
      } else if (langLower === 'html') {
        result = beautify.html(code, { indent_size: 2 });
      } else if (langLower === 'php') {
        // Простое форматирование PHP (удаление лишних пробелов, но без полноценной деобфускации)
        result = code.replace(/\?>\s*<\?php/g, "?>\n<?php")
          .replace(/\s+/g, ' ')
          .replace(/[{;}]/g, "$&\n")
          .replace(/\n\s*\n/g, '\n');
      } else {
        result = code;
      }
    } else if (mode === 'obfuscate') {
      if (langLower === 'js') {
        const minified = minify(code);
        if (minified.error) throw new Error(minified.error);
        result = minified.code;
      } else if (langLower === 'html') {
        result = code.replace(/\s+/g, ' ').replace(/> </g, '><');
      } else if (langLower === 'php') {
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
  } catch (error) {
    console.error('Deobfuscate error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}