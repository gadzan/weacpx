#!/bin/zsh
set -euo pipefail

command_path="$1"
cwd="$2"
shift 2

cd "$cwd"
exec "$command_path" "$@"
