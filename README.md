# FMDEhub

FMDEhub is a demo network manager for the WMO First Mile Data Exchange (FMDE): a standalone PWA that
can be hosted on GitHub Pages.

It runs entirely in the browser. Enter a broker under **Settings** (a `wss://` URL and read-only
credentials) and it subscribes to the FMDE topics (`firstmile/a/#, firstmile/poc1/#`), decodes
every message, and shows the nodes: status board, map, node pages with parameters, time series,
messages and metadata, and the message inspector. Data is kept in the browser's own database.
Groups listed under **Exclude groups** (by default `wmo`) are ignored, and anything already stored for them is deleted
when the connection starts.

## How it is built

```
apps/fmde-hub/        the Vue 3 + Vuetify PWA
packages/fmde/        FMDE: schema, decoding, topics, normalisation, conformance (ATS) checks (no Vue)
packages/db/          the browser database schema (PGlite)
packages/ingest/      the MQTT source and ingest into the database
packages/components/  charts, tables, map and other Vue components
```

The database schema is described, with a UML diagram, in [`docs/database.md`](docs/database.md).

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds `apps/fmde-hub` on every push to
`main` with `FMDEHUB_BASE` (the base path). It also copies `index.html` to `404.html`, so links to
node pages work.

The app is named "FMDEhub (demo)" by default; a `config.json` with `{ "demo": false }` names it plain
"FMDEhub".

The conformance views (chips, issue lists, the Conformance tab, inspector filters) are off by
default; the checks still run. To show them, serve a `config.json` next to `index.html` with
`{ "showConformance": true }` (in development, put it in `apps/fmde-hub/public/`). The switches
combine, e.g. `{ "demo": false, "showConformance": true }`.

To run it locally:

```
npm ci
npm run dev                  # http://localhost:5173
npm run typecheck
npm test                     # unit tests, and ingest against an in-memory PGlite
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the typecheck and tests on every push and pull request.

## Security

Everything a node publishes (names, units, URLs, namespace URIs) is untrusted input: anyone who can
publish to the First Mile topics controls it. Render it as text: Vue templates escape it, and
tooltips and popups are built as DOM nodes with `textLines()` from `packages/components/src/dom.ts`,
never as HTML strings. Links go through `safeUrl()` from `packages/components/src/html.ts`.

The broker settings, including the password, are stored in the browser's database so that another
tab can take over the connection. Use read-only credentials limited to subscribing to the FMDE topics.

## Licence

Apache-2.0 (see [LICENSE](LICENSE)).
