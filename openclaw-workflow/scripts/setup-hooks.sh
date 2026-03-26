#!/bin/bash
# OpenClaw git hooks 설정 스크립트
# 각 프로젝트 레포에서 실행하면 git hooks가 설정됩니다.
#
# 사용법:
#   1. 이 파일과 git-hooks/ 폴더를 프로젝트 레포의 scripts/에 복사
#   2. package.json에 추가: "prepare": "bash scripts/setup-hooks.sh"
#   3. npm install 하면 자동 적용
#
# 또는 수동 실행: bash scripts/setup-hooks.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="${SCRIPT_DIR}/git-hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "[openclaw] git-hooks directory not found: $HOOKS_DIR"
  exit 0
fi

# git hooks 경로를 프로젝트 내 scripts/git-hooks로 설정
git config core.hooksPath "$HOOKS_DIR"
echo "[openclaw] git hooks configured: $HOOKS_DIR"
