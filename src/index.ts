/**
 * insightql — a tiny CloudWatch Logs Insights-style query language.
 *
 * Self-contained and framework-agnostic: zero runtime dependencies, no DOM,
 * no host-app imports. This barrel is the package's only public entry point.
 */
export { parse } from './parser';
export { serialize } from './serializer';
export { matches, comparator, run } from './evaluator';
export { tokenize, Tokenizer } from './tokenizer';
export type { TokenizeResult } from './tokenizer';

export type {
  Query,
  Condition,
  ComparisonCondition,
  InCondition,
  TermCondition,
  NotCondition,
  AndCondition,
  OrCondition,
  ComparisonOperator,
  ScalarValue,
  SortItem,
  ParseResult,
  ParseError,
  EvalOptions,
  Token,
  TokenType,
} from './types';
