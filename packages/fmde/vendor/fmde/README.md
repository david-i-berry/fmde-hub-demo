# Official FMDE schema and examples

Copied unchanged from [wmo-im/fmde](https://github.com/wmo-im/fmde) at commit
[`693cc14`](https://github.com/wmo-im/fmde/tree/693cc14496bf78f653c9659c0a86d2d22936f251)
(2026-10-22):

| File | Source |
|---|---|
| `schemas/first-mile-message-encoding.proto` | `schemas/first-mile-message-encoding.proto` |
| `examples/meteostation/metadata.textproto`, `data.textproto` | `examples/meteostation/` |
| `examples/hydrostation/metadata.textproto`, `data.textproto` | `examples/hydrostation/` |

Used by:
- `scripts/generate-fmde-json.ts`, which converts the schema to `src/generated/fmde.json`
  (`npm run generate:fmde -w packages/fmde`).
- The tests. The `*.binpb` files are the examples encoded to protobuf binary by `encode.sh` with
  protoc (libprotoc 36.2), independently of protobufjs. `test/proto.test.ts` decodes them and checks
  the result against the `.textproto` values, and checks that `src/generated/fmde.json` matches the
  schema; `test/ats.test.ts` runs the conformance checks on them.

To update: copy the files again from a newer wmo-im/fmde commit, update the commit above, then run
`npm run generate:fmde -w packages/fmde` and `./encode.sh`.
