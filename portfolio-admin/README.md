# portfolio-admin

Toss 증권 OpenAPI 기반 개인 포트폴리오 대시보드.

## 빠른 시작 (AI 에이전트)

```
git clone https://github.com/yeong-hwan/portfolio-admin.git 으로 클론한 뒤, portfolio-admin/portfolio-admin 폴더에서 .env.example을 .env로 복사하고 Toss OpenAPI 키를 입력하라고 안내해줘. 그 다음 npm install && npm run dev 로 서버를 실행해줘.
```

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다.

```bash
cp .env.example .env
```

`.env`를 열어 값을 채웁니다.

```
TOSS_CLIENT_ID={your_client_id}
TOSS_CLIENT_SECRET={your_client_secret}
TOSS_ACCOUNT_SEQ=1  # 계좌 seq (getAccounts API 호출 방지)
CASH_KRW=0          # 현금 잔액 KRW — Toss API 미제공, 수동 설정
```

- `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET`: [Toss 증권 OpenAPI](https://openapi.tossinvest.com) 콘솔에서 발급
- `TOSS_ACCOUNT_SEQ`: 계좌 순번 (보통 `1`)
- `CASH_KRW`: 포트폴리오에 포함할 현금 (원화)

### 3. 서버 실행

```bash
npm run dev
```

`http://localhost:5173` 에서 확인합니다.
