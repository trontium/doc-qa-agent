/**
 * highlight.js Web Worker
 *
 * 把语法高亮完全移出主线程：
 * - 主线程只负责 postMessage(code) 和把返回 HTML 塞入 DOM
 * - hljs 的 tokenizer / language 匹配 / regex 全部在 Worker 里跑
 * - CPU 密集的正则匹配不再阻塞主线程 → INP 显著改善
 *
 * 协议：
 *   in:  { id: string, code: string, lang?: string }
 *   out: { id: string, html: string, language?: string, error?: string }
 */

/// <reference lib="webworker" />

import hljs from 'highlight.js/lib/core';

// 只注册常用语言，避免 Worker bundle 过大
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

interface Req {
  id: string;
  code: string;
  lang?: string;
}
interface Resp {
  id: string;
  html: string;
  language?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, code, lang } = e.data;
  try {
    let result;
    if (lang && hljs.getLanguage(lang)) {
      result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    } else {
      // auto-detect
      result = hljs.highlightAuto(code);
    }
    const resp: Resp = {
      id,
      html: result.value,
      language: result.language,
    };
    (self as unknown as Worker).postMessage(resp);
  } catch (err) {
    const resp: Resp = {
      id,
      html: '',
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};
