#!/bin/bash
# Login to tossctl locally, then sync session to atlas
set -euo pipefail

echo "==> 토스증권 로그인 시작..."
tossctl auth login

echo "==> 세션을 atlas로 동기화 중..."
scp ~/Library/Application\ Support/tossctl/session.json atlas:~/Library/Application\ Support/tossctl/

echo "==> atlas 서버 재시작..."
ssh atlas "export PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH && ~/portfolio-admin/scripts/start-server.sh stop && ~/portfolio-admin/scripts/start-server.sh start"

echo "==> 완료! atlas 세션이 갱신되었습니다."
