# FMDEhub

FMDEhub is a demo network manager for the WMO First Mile Data Exchange (FMDE): a standalone PWA that
can be hosted on GitHub Pages.

It runs entirely in the browser. Enter a broker under **Settings** (a `wss://` URL and read-only
credentials) and it subscribes to the FMDE topics (`firstmile/a/#, firstmile/poc1/#`), decodes
every message, and shows the nodes: status board, map, node pages with parameters, time series,
messages and metadata, and the message inspector. Data is kept in the browser's own database.

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
`main` with the Pages settings: `FMDEHUB_BASE` (the base path) and a `config.json`
of `{ "hideConformance": true, "historyRecorder": false }`. It also copies `index.html` to
`404.html`, so links to node pages work.

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
publish to the First Mile topics controls it. Render it as text; where it must go into an HTML string
or a link, use `esc()` and `safeUrl()` from `packages/components/src/html.ts`.

The broker settings, including the password, are stored in the browser's database so that another
tab can take over the connection. Use read-only credentials limited to subscribing to the FMDE topics.

## Licence

Apache-2.0 (see [LICENSE](LICENSE)).
