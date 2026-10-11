// Integration-style check: mimic a host app's data path (run + injected
// getValue) against realistic mixed logs (objects + plain strings).
import { describe, it, expect } from '@jest/globals';
import { parse, run } from '../index';
import type { EvalOptions } from '../index';

// A getValue that handles literal dotted keys as well as nested paths.
const getValue: NonNullable<EvalOptions['getValue']> = (obj: any, path: string) => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (path in obj) return obj[path];
  const parts = path.split('.');
  for (let i = 1; i < parts.length; i++) {
    let current: any = obj;
    let valid = true;
    for (const part of parts.slice(0, i)) {
      if (current && typeof current === 'object' && part in current) current = current[part];
      else {
        valid = false;
        break;
      }
    }
    const literalKey = parts.slice(i).join('.');
    if (valid && current && typeof current === 'object' && literalKey in current) return current[literalKey];
  }
  return parts.reduce((c: any, k) => (c == null ? undefined : c[k]), obj);
};

const logs: unknown[] = [
  'Application started successfully on port 3000', // plain string log
  { '@timestamp': '2026-02-01T10:00:05Z', level: 'error', service: 'payments-svc', status: 500, latency: 820, msg: 'db timeout' },
  { '@timestamp': '2026-02-01T10:00:01Z', level: 'info', service: 'auth-gateway', status: 200, latency: 40, msg: 'login ok' },
  { '@timestamp': '2026-02-01T10:00:09Z', level: 'error', service: 'payments-svc', status: 503, latency: 1200, msg: 'upstream' },
  { '@timestamp': '2026-02-01T10:00:03Z', level: 'warn', service: 'cart-svc', status: 429, latency: 95, msg: 'throttled' },
  { '@timestamp': '2026-02-01T10:00:07Z', level: 'error', service: 'auth-gateway', status: 401, latency: 30, msg: 'bad token' },
  { '@timestamp': '2026-02-01T10:00:02Z', nested: { service: { name: 'payments-svc' } }, level: 'error', status: 500 },
];

const q = (s: string) => {
  const r = parse(s);
  if (!r.ok) throw new Error(s + ' -> ' + JSON.stringify(r.errors));
  return r.query;
};

describe('full pipeline on mixed logs', () => {
  const query = q(
    'fields @timestamp, level, service | filter level = "error" and service in ["payments-svc","auth-gateway"] | sort @timestamp desc | limit 10',
  );
  const { rows, fields } = run(logs, query, { getValue });

  it('projects the requested fields', () => expect(fields).toEqual(['@timestamp', 'level', 'service']));
  it('filters by error + in (3 matches)', () => expect(rows).toHaveLength(3));
  it('sorts desc by @timestamp', () => expect((rows[0] as any)['@timestamp']).toBe('2026-02-01T10:00:09Z'));
  it('excludes the plain string log via a field filter', () => expect(rows).not.toContain(logs[0]));
});

describe('numeric comparison + limit', () => {
  it('keeps the single highest-latency row', () => {
    const { rows } = run(logs, q('filter latency > 500 | sort latency desc | limit 1'), { getValue });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).latency).toBe(1200);
  });
});

describe('nested field via injected getValue', () => {
  it('matches a nested path', () => {
    const { rows } = run(logs, q('filter nested.service.name = "payments-svc"'), { getValue });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe(500);
  });
});

describe('bare term across the whole record', () => {
  it('free-text matches a plain string log', () => {
    const { rows } = run(logs, q('port'), { getValue });
    expect(rows).toContain(logs[0]);
  });
});

describe('no filter keeps all, in original order', () => {
  it('limit-only keeps the first N rows', () => {
    const { rows } = run(logs, q('limit 3'), { getValue });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(logs[0]);
  });
});
