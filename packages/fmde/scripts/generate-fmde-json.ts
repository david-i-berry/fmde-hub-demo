// Regenerate src/generated/fmde.json, the protobufjs JSON descriptor that proto.ts loads, from the
// official FMDE schema in vendor/fmde/schemas (copied from wmo-im/fmde; see vendor/fmde/README.md).
// protobufjs/light (used at runtime) cannot parse .proto files, so the schema is converted here with
// the full protobufjs build. google.protobuf.Empty and Timestamp come from protobufjs's bundled copies
// of Google's well-known types.
//
//   npm run generate:fmde -w packages/fmde
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'

const schema = fileURLToPath(new URL('../vendor/fmde/schemas/first-mile-message-encoding.proto', import.meta.url))
const out = fileURLToPath(new URL('../src/generated/fmde.json', import.meta.url))

const root = new protobuf.Root().loadSync(schema, { keepCase: true })
writeFileSync(out, `${JSON.stringify(root.toJSON(), null, 2)}\n`)
console.log(`${schema} -> ${out}`)
