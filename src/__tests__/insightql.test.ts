import { describe, it, expect } from '@jest/globals';
import { parse, run, matches, serialize } from '../index';
import type { Query } from '../index';

function parseOk(input: string): Query {
  const r = parse(input);
  if (!r.ok) {
    throw new Error(`expected parse ok for "${input}", got errors: ${JSON.stringify(r.errors)}`);
  }
  return r.query;
}

describe('tokenizer / parser', () => {
  it('parses a full pipeline', () => {
    const q = parseOk(
      'fields @timestamp, level, service, message | filter level = "error" and service in ["payments-svc","auth-gateway"] | sort @timestamp desc | limit 20',
    );
    expect(q.fields).toEqual(['@timestamp', 'level', 'service', 'message']);
    expect(q.limit).toBe(20);
    expect(q.sort).toEqual([{ field: '@timestamp', direction: 'desc' }]);
    expect(q.filter?.kind).toBe('and');
  });

  it('treats a bare expression as an implicit filter', () => {
    expect(parseOk('level = "error"').filter?.kind).toBe('comparison');
  });

  it('supports the wildcard field selector', () => {
    expect(parseOk('fields *').fields).toEqual(['*']);
    expect(serialize(parseOk('fields * | sort ts desc'))).toBe('fields *\n| sort ts desc');
  });

  it('AND-s multiple filter clauses together', () => {
    expect(parseOk('filter a = 1 | filter b = 2').filter?.kind).toBe('and');
  });
});

describe('parse errors (as values, with spans)', () => {
  it('reports a missing value with a span', () => {
    const r = parse('filter level = ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.errors[0].start).toBe('number');
      expect(r.errors[0].end).toBeGreaterThan(r.errors[0].start);
    }
  });

  it('rejects a non-numeric limit', () => {
    expect(parse('limit abc').ok).toBe(false);
  });

  it('rejects trailing garbage', () => {
    expect(parse('level = "error" extra garbage').ok).toBe(false);
  });
});

describe('evaluator — matches', () => {
  const records = [
    { level: 'error', service: 'payments-svc', status: 500, msg: 'db timeout' },
    { level: 'info', service: 'auth-gateway', status: 200, msg: 'ok' },
    { level: 'error', service: 'cart-svc', status: 503, msg: 'upstream' },
    { level: 'warn', service: 'payments-svc', status: 429, msg: 'throttled' },
  ];
  const m = (input: string, rec: unknown) => matches(parseOk(input), rec);

  it('equals string (case-insensitive)', () => expect(m('level = "ERROR"', records[0])).toBe(true));
  it('not equals', () => expect(m('level != "info"', records[0])).toBe(true));
  it('in list (positive)', () => expect(m('service in ["payments-svc","auth-gateway"]', records[1])).toBe(true));
  it('in list (negative)', () => expect(m('service in ["payments-svc","auth-gateway"]', records[2])).toBe(false));
  it('numeric >= (positive)', () => expect(m('status >= 500', records[0])).toBe(true));
  it('numeric >= (negative)', () => expect(m('status >= 500', records[1])).toBe(false));
  it('and', () => expect(m('level = "error" and status >= 500', records[0])).toBe(true));
  it('or', () => expect(m('level = "warn" or status >= 500', records[0])).toBe(true));
  it('not', () => expect(m('not level = "info"', records[0])).toBe(true));
  it('like substring', () => expect(m('msg like "timeout"', records[0])).toBe(true));
  it('like regex (quoted)', () => expect(m('msg like "/^db/"', records[0])).toBe(true));
  it('like regex (literal)', () => expect(m('msg like /^db/', records[0])).toBe(true));
  it('like regex literal (negative)', () => expect(m('msg like /^xyz/', records[0])).toBe(false));
  it('bare term full-text', () => expect(m('throttled', records[3])).toBe(true));
  it('missing field: only != is true', () => {
    expect(m('nope != "x"', records[0])).toBe(true);
    expect(m('nope = "x"', records[0])).toBe(false);
  });
  it('paren grouping', () =>
    expect(m('(level = "warn" or level = "error") and service = "payments-svc"', records[3])).toBe(true));
});

describe('evaluator — run (filter + sort + limit)', () => {
  const records = [
    { level: 'error', service: 'payments-svc', ts: 3 },
    { level: 'info', service: 'auth-gateway', ts: 1 },
    { level: 'error', service: 'payments-svc', ts: 5 },
    { level: 'error', service: 'cart-svc', ts: 4 },
  ];

  it('filters, sorts and limits', () => {
    const q = parseOk(
      'filter level = "error" and service in ["payments-svc","auth-gateway"] | sort ts desc | limit 1',
    );
    const { rows } = run(records, q);
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe(5);
  });

  it('sorts ascending', () => {
    const { rows } = run(records, parseOk('sort ts asc'));
    expect(rows[0].ts).toBe(1);
    expect(rows[3].ts).toBe(5);
  });
});

describe('custom getValue (nested)', () => {
  it('resolves a nested path via an injected accessor', () => {
    const rec = { '@message': { service: { name: 'api' } } };
    const getValue = (obj: any, path: string): unknown => {
      if (obj && typeof obj === 'object' && path in obj) return obj[path];
      return path.split('.').reduce((c: any, k) => (c == null ? undefined : c[k]), obj);
    };
    expect(matches(parseOk('@message.service.name = "api"'), rec, { getValue })).toBe(true);
  });
});

describe('serializer round-trips', () => {
  const roundtrip = (input: string) => {
    const q1 = parseOk(input);
    const q2 = parseOk(serialize(q1));
    return JSON.stringify(q1) === JSON.stringify(q2);
  };

  it.each([
    ['simple comparison', 'filter level = "error"'],
    ['full pipeline', 'fields @timestamp, level, service | filter level = "error" and status >= 500 | sort @timestamp desc | limit 20'],
    ['in list', 'filter service in ["payments-svc","auth-gateway"]'],
    ['and/or precedence', 'filter a = 1 or b = 2 and c = 3'],
    ['not + parens', 'filter not (a = 1 or b = 2)'],
    ['regex literal', 'filter msg like /timeout/'],
    ['multi sort', 'sort a desc, b asc'],
  ])('round-trips: %s', (_name, input) => {
    expect(roundtrip(input)).toBe(true);
  });

  it('produces canonical text', () => {
    expect(serialize(parseOk('level="error"|sort ts desc'))).toBe('filter level = "error"\n| sort ts desc');
  });
});
