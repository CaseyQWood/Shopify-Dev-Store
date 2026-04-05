# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Shopify Liquid theme based on the official **Dawn theme** (v15.4.1). It uses no build tools or package managers — all development is done via the Shopify CLI or directly through Shopify admin.

## Development Commands

To work with this theme locally, use the [Shopify CLI](https://shopify.dev/docs/themes/tools/cli):

```bash
shopify theme dev          # Start local development server with hot reload
shopify theme push         # Push theme to store
shopify theme pull         # Pull latest theme from store
shopify theme check        # Lint Liquid files for errors
```

## Architecture

### Directory Structure

| Directory | Purpose |
|-----------|---------|
| `layout/` | Master page wrappers (`theme.liquid` is the root HTML document) |
| `templates/` | Page-level templates (JSON-based, defining section composition per page type) |
| `sections/` | Reusable page sections rendered in templates or the theme editor |
| `snippets/` | Reusable Liquid partials included via `{% render %}` |
| `assets/` | CSS files (~70), JS files (~40), images, fonts |
| `config/` | `settings_schema.json` defines the theme editor UI; `settings_data.json` stores active values |
| `locales/` | Translation files for 30+ languages |
| `.shopify/` | Shopify metafield definitions for custom product/shop data |

### How Pages Are Built

Templates (`templates/*.json`) define which sections appear on each page and in what order. Sections (`sections/*.liquid`) are self-contained components with their own Liquid, HTML, CSS, and schema for editor customization. Snippets (`snippets/*.liquid`) are small reusable fragments included with `{% render 'snippet-name' %}`.

### JavaScript

Vanilla JS only — no framework. Core modules:
- `assets/pubsub.js` — pub/sub event system used for cross-component communication
- `assets/global.js` — shared utilities and custom element base classes
- `assets/constants.js` — shared constants

Cart, search, product, and media functionality are each in dedicated JS files.

### Styling

CSS is split per-component and per-section. Color schemes and typography are driven by CSS variables set dynamically from `config/settings_data.json` values in `layout/theme.liquid`.

### Localization

All user-facing strings should use `{{ 'key' | t }}` and be defined in `locales/en.default.json`. Schema translations for the theme editor go in `locales/en.default.schema.json`.

### Metafields

Custom metafields are defined in `.shopify/metafields.json` and accessed in Liquid via `product.metafields.*` or `shop.metafields.*`.
