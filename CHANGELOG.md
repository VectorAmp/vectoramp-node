# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [Unreleased]

### Added

- Add `githubSource` and `gitlabSource` typed source builders.
- Add `client.sources.createGitHub(...)` and `client.sources.createGitLab(...)`.

## [0.3.0] - 2026-07-20

### Added

- Add typed metadata-schema fields when creating datasets.
- Add metadata-schema merge/patch and full replacement operations.
- Document create, merge, and replace schema workflows.

## [0.2.0] - 2026-07-14

### Added

- Add dataset vector deletion helpers (`deleteVectors`) for client and dataset resources.
- Add organization secret helpers for storing/checking OpenAI embedding API keys.
- Add `openaiApiKey` dataset creation convenience for OpenAI-backed datasets.

## [0.1.0] - 2026-07-02

### Added

- Initial public-ready package baseline for VectorAmp SDK/CLI migration to GitHub.
- GitHub Actions CI workflow.
