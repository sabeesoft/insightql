# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial extraction from the Log Lens VS Code extension into a standalone,
  dependency-free package: tokenizer, recursive-descent parser, evaluator
  (`matches` / `comparator` / `run`), and `serialize`.
- ESM + CJS builds with TypeScript declarations (via `tsup`).
- Jest test suite (unit + integration) migrated from the original hand-rolled
  assertion harness.
