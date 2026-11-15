#!/bin/sh
# Encode the official FMDE example messages (examples/*/*.textproto) to protobuf binary
# (*.binpb) with protoc, Google's reference protobuf compiler, so the decoder tests use bytes
# produced independently of protobufjs. Rerun after updating the examples or the schema.
#
#   PROTOC=/path/to/protoc ./encode.sh     (default: protoc on PATH)
#
# protoc releases: https://github.com/protocolbuffers/protobuf/releases (verify the sha256 digest).
set -eu
cd "$(dirname "$0")"
PROTOC="${PROTOC:-protoc}"
TYPE=int.wmo.wis.spec.fmde.v1.conf.message_encoding.FirstMileMessage
"$PROTOC" --version
for src in examples/*/*.textproto; do
  out="${src%.textproto}.binpb"
  "$PROTOC" -I schemas --encode="$TYPE" first-mile-message-encoding.proto < "$src" > "$out"
  echo "$src -> $out"
done
