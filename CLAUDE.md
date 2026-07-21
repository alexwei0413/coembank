# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`coembank` (康貝客主目錄) is currently a placeholder/umbrella repository for the Combek (康貝客) organization — it contains no application code yet. The actual product code lives in the sibling repository `combek-interior-design` (React 19 + Vite + Express + tRPC + Drizzle/MySQL interior-design site with a headless CMS).

## Current Contents

- `README.md` — repo title only ("康貝客主目錄" = "Combek main directory")
- `.github/workflows/blank.yml` — a hello-world CI workflow (`echo` steps) that runs on every push; it builds nothing and tests nothing

## Conventions

- Documentation and commit messages may be written in Traditional Chinese, matching the existing history.
- If application code is added here, replace the placeholder CI workflow in `.github/workflows/blank.yml` with real build/test steps at the same time.
- Before adding features, check whether they belong in `combek-interior-design` instead — this repo is intended as the organization's main directory, not the app codebase.
