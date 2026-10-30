#!/usr/bin/env node
/**
 * Deterministic stand-in for the FastAPI AI service.
 *
 * Implements the same endpoints the API provider calls (`/classify`,
 * `/classify/batch`, `/health`, `/model-info`) so the browser suite can run
 * without the Python service or a trained model. Failure modes are triggered by
 * markers in the description:
 *   [lowconf] -> confident=false, low confidence
 *   [offline] -> HTTP 503
 *   [network] -> connection reset
 *
 * Only the request path is logged. Descriptions are never logged.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.AI_STUB_PORT ?? 8011);

const MODEL_NAME = 'tfidf-char-logreg';
const MODEL_VERSION = 'e2e-stub-v1';

const EXPENSE_RULES = [
  { label: 'food', pattern: /cà phê|cafe|cơm|com\b|phở|pho\b|ăn|an trua|bánh|trà sữa|nhà hàng/ },
  { label: 'shopping', pattern: /quần|quan ao|áo|mua sắm|shop|giày/ },
  { label: 'transport', pattern: /xăng|grab|taxi|xe bus|vé xe|di chuyển/ },
  { label: 'housing', pattern: /tiền nhà|tiền điện|tiền nước|thuê nhà/ },
  { label: 'health', pattern: /thuốc|bệnh viện|khám bệnh/ },
  { label: 'entertainment', pattern: /phim|game|ca nhạc|giải trí/ },
  { label: 'education', pattern: /học phí|sách|khóa học/ },
  { label: 'transfer_fee', pattern: /phí chuyển khoản|phí giao dịch/ },
];

/**
 * Alternatives are always ranked and include the top label first, like the real
 * service. The low-confidence case deliberately offers a second plausible
 * category so the UI can show selectable candidates instead of a dead end.
 *
 * @returns {{label: string, confidence: number, isConfident: boolean,
 *   alternatives: Array<{label: string, confidence: number}>}}
 */
export function classifyText(description, type) {
  const text = description.toLowerCase();
  if (text.includes('[lowconf]')) {
    return {
      label: 'food',
      confidence: 0.31,
      isConfident: false,
      alternatives: [
        { label: 'food', confidence: 0.31 },
        { label: 'shopping', confidence: 0.24 },
        { label: 'other', confidence: 0.17 },
      ],
    };
  }
  let label;
  let confidence;
  if (type === 'INCOME') {
    if (/lương|thưởng|thu nhập/.test(text)) {
      label = 'salary';
      confidence = 0.91;
    } else {
      label = 'income_other';
      confidence = 0.72;
    }
  } else {
    const match = EXPENSE_RULES.find((rule) => rule.pattern.test(text));
    label = match ? match.label : 'other';
    confidence = match ? 0.86 : 0.64;
  }
  const runnerUp = label === 'other' ? 'shopping' : 'other';
  const alternatives = [
    { label, confidence },
    { label: runnerUp, confidence: Math.round((1 - confidence) * 40) / 100 },
  ].sort((left, right) => right.confidence - left.confidence);
  return { label, confidence, isConfident: true, alternatives };
}

function toResponse(description, type) {
  const { label, confidence, isConfident, alternatives } = classifyText(description, type);
  return {
    label,
    confidence,
    isConfident,
    alternatives,
    modelName: MODEL_NAME,
    modelVersion: MODEL_VERSION,
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function failMode(description, response) {
  const text = String(description ?? '').toLowerCase();
  if (text.includes('[offline]')) {
    sendJson(response, 503, { detail: 'stub offline' });
    return true;
  }
  if (text.includes('[network]')) {
    response.destroy();
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && pathname === '/model-info') {
    sendJson(response, 200, {
      status: 'ok',
      modelName: MODEL_NAME,
      modelVersion: MODEL_VERSION,
      labels: 11,
      stub: true,
    });
    return;
  }
  if (request.method === 'POST' && pathname === '/classify') {
    try {
      const body = await readJson(request);
      if (failMode(body.description, response)) return;
      sendJson(response, 200, toResponse(body.description ?? '', body.type ?? 'EXPENSE'));
    } catch {
      sendJson(response, 400, { detail: 'invalid json' });
    }
    return;
  }
  if (request.method === 'POST' && pathname === '/classify/batch') {
    try {
      const body = await readJson(request);
      const items = Array.isArray(body.items) ? body.items : [];
      for (const item of items) {
        if (failMode(item.description, response)) return;
      }
      sendJson(response, 200, {
        items: items.map((item) => toResponse(item.description ?? '', item.type ?? 'EXPENSE')),
      });
    } catch {
      sendJson(response, 400, { detail: 'invalid json' });
    }
    return;
  }
  sendJson(response, 404, { detail: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI stub listening on http://127.0.0.1:${PORT}`);
});
