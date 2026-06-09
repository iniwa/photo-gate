#!/bin/sh
set -eu
exec photo-gate-sync sync-once "$@"
