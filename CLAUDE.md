# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`coembank` (康貝客主目錄) is the umbrella and governed operations repository for Combek (康貝客). It may contain documentation and reviewed publishing automation, but it is not the production application repository. The actual product code lives in the sibling repository `combek-interior-design`.

## Repository Boundary

- Application features and runtime code belong in `combek-interior-design` unless the task explicitly changes repository ownership.
- Publishing and content-migration scripts may live here only when they default to validation/dry-run, create drafts by default, and require a separate explicit approval to publish.
- Never treat a successful CI check as publication approval or evidence that production WordPress was updated.
- Do not store WordPress credentials, application passwords, access tokens, or production backups in this repository.

## Conventions

- Documentation and commit messages may be written in Traditional Chinese, matching the existing history.
- CI must run on pull requests, use least-privilege token permissions, and validate every executable script added here.
- Any production-capable workflow must follow: read-only inventory → reviewable plan → explicit approval → small write batch → readback verification.
- Keep pull requests in Draft until their checks pass and a human reviewer confirms the intended repository, content, and publication status.
