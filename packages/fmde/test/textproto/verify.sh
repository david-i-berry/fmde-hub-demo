#!/bin/sh
# Check that each golden file here (toTextProto() output for an official FMDE example) is valid
# protobuf text format with exactly the example's content: protoc, Google's reference implementation,
# encodes it and the bytes must equal the official example's .binpb. Comments (# …) are ignored by
# protoc. Rerun after the golden files change (npx vitest run -u packages/fmde).
#
#   PROTOC=/path/to/protoc ./verify.sh     (default: protoc on PATH)
set -eu
cd "$(dirname "$0")"
PROTOC="${PROTOC:-protoc}"
SCHEMAS=../../vendor/fmde/schemas
EXAMPLES=../../vendor/fmde/examples
TYPE=int.wmo.wis.spec.fmde.v1.conf.message_encoding.FirstMileMessage
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
"$PROTOC" --version
status=0
for golden in *-*.textproto; do
  name="${golden%.textproto}"            # meteostation-data
  station="${name%-*}"; kind="${name##*-}"
  "$PROTOC" -I "$SCHEMAS" --encode="$TYPE" first-mile-message-encoding.proto < "$golden" > "$tmp"
  if cmp -s "$tmp" "$EXAMPLES/$station/$kind.binpb"; then
    echo "ok    $golden = $station/$kind.binpb"
  else
    echo "FAIL  $golden encodes differently from $station/$kind.binpb"
    status=1
  fi
done
exit $status
