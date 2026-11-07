# KISA 초대 전용 Telegram 알림 봇

KISA 보호나라 보안공지를 Telegram 개인 메시지로 전달하는 초대 전용 봇입니다. 소스 코드는 공개하지만, 초대 코드가 없으면 구독할 수 없습니다. 구독자의 Telegram `chat_id`와 초대 코드 해시는 Cloudflare D1에만 저장하며 GitHub 저장소에는 기록하지 않습니다.

## 주요 기능

- 일회용·다회용 만료 초대 링크
- `/start`, `/stop`, `/status`, `/help` 구독 명령
- 관리자 전용 `/invite`, `/subscribers`, `/revoke`
- 구독자 수 상한 강제 적용(기본 50명)
- 한 번에 최대 20명씩 분할 발송
- 실패 지수 백오프 재시도
- 봇 차단·탈퇴 사용자의 구독 자동 정리
- KISA 기존 공지로 최초 상태를 만들고 과거 공지는 발송하지 않음
- 국문·영문 공지 페이지 연결

```text
GitHub Public 저장소 ──배포──> Cloudflare Worker
                                  ├─ Telegram Webhook
                                  ├─ KISA RSS 1분 확인
                                  └─ Cloudflare D1 (비공개 구독 정보)
```

## 접근 통제

봇 사용자 이름을 알더라도 일반 `/start`로는 가입할 수 없습니다. 관리자가 만든 링크로만 가입합니다.

```text
https://t.me/BOT_USERNAME?start=ONE_TIME_INVITE_CODE
```

- 초대 코드 원문은 DB에 저장하지 않고 SHA-256 해시만 저장합니다.
- 사용 횟수는 1~20회, 유효기간은 1~30일로 제한합니다.
- 구독자 최대 인원은 배포 변수로 제한합니다.
- 관리자가 아닌 사용자는 초대 생성·구독자 조회·강제 해제를 실행할 수 없습니다.
- 승인되지 않은 사용자의 명령에는 응답하지 않으므로 외부인이 봇 발송량을 소모할 수 없습니다.

## 비용과 한도

팀 단위 사용은 Cloudflare Workers와 D1 무료 범위에서 운영할 수 있습니다. 기본 발송 묶음은 20명으로 Telegram 무료 대량 발송 제한과 Workers 외부 요청 제한 아래에 둡니다.

- [Cloudflare Workers Free 한도](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 가격과 무료 한도](https://developers.cloudflare.com/d1/platform/pricing/)
- [Telegram Bot 발송 제한](https://core.telegram.org/bots/faq#broadcasting-to-users)

## 1. 새 Telegram 봇 만들기

1. Telegram에서 공식 `@BotFather`를 엽니다.
2. `/newbot`으로 이 프로젝트 전용 봇을 만듭니다.
3. 봇 사용자 이름과 HTTP API token을 복사합니다.
4. BotFather의 `/setjoingroups`에서 이 봇의 그룹 추가를 **Disable**로 설정합니다.
5. 새 봇에게 `/start`를 한 번 보냅니다.

봇 token은 Issue, 채팅, 코드에 올리지 마세요.

### 관리자 Telegram ID 확인

Webhook을 연결하기 전에 개인 PC PowerShell에서 실행합니다.

```powershell
$env:TELEGRAM_BOT_TOKEN = "BotFather_token"
node scripts/get-admin-id.mjs
Remove-Item Env:TELEGRAM_BOT_TOKEN
```

출력된 숫자는 나중에 Cloudflare Worker Secret `ADMIN_TELEGRAM_USER_ID`로 등록합니다.

## 2. Cloudflare D1 만들기

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)에 무료 계정을 만듭니다.
2. **Storage & databases → D1 SQL database → Create database**로 이동합니다.
3. 데이터베이스 이름을 `kisa-public-bohonara-support`로 지정합니다.
4. 생성된 **Database ID**를 복사합니다.

D1 데이터는 GitHub에 공개되지 않습니다.

## 3. Cloudflare API token 만들기

Cloudflare **My Profile → API Tokens → Create Token**에서 이 계정에 한정된 배포용 token을 만듭니다.

필요한 권한:

- Account → Workers Scripts → Edit
- Account → D1 → Edit

Cloudflare Account ID도 Dashboard에서 확인합니다.

## 4. GitHub 설정

저장소 **Settings → Secrets and variables → Actions**에서 설정합니다.

### Repository secrets

| 이름 | 값 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 앞 단계의 제한된 Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

Telegram token은 GitHub에 등록하지 않습니다. 첫 배포 후 Cloudflare Worker Secret에 직접 등록합니다.

### Repository variables

| 이름 | 값 |
| --- | --- |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 Database ID |
| `CLOUDFLARE_D1_DATABASE_NAME` | `kisa-public-bohonara-support` |
| `BOT_USERNAME` | `@`를 제외한 BotFather 봇 사용자 이름 |
| `NOTICE_PAGES_BASE_URL` | `https://doraemyon.github.io/KISA-Bohonara-Support` |
| `MAX_SUBSCRIBERS` | 권장 `50` |
| `BROADCAST_BATCH_SIZE` | 권장 `20`, 최대 `20` |
| `CLOUDFLARE_DEPLOY_ENABLED` | 첫 배포를 시작할 때 `true` |
| `ENABLE_CRON` | 처음에는 반드시 `false` |

`CLOUDFLARE_DEPLOY_ENABLED`가 `true`가 되기 전에는 GitHub Actions가 테스트만 실행하고 Cloudflare에는 배포하지 않습니다.

## 5. 첫 배포

1. **Actions → Verify and deploy bot → Run workflow**를 실행합니다.
2. D1 migration과 Worker 배포가 성공했는지 확인합니다.
3. Cloudflare **Workers & Pages**에서 생성된 `kisa-public-bohonara-support` Worker를 엽니다.
4. Worker의 `workers.dev` 주소를 복사합니다.

첫 배포에서는 `ENABLE_CRON=false`이므로 아직 RSS 확인 작업이 실행되지 않습니다.

## 6. Worker Secrets 등록

Cloudflare Worker의 **Settings → Variables and Secrets → Add**에서 모두 **Secret** 유형으로 등록합니다.

| Secret | 값 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather HTTP API token |
| `TELEGRAM_WEBHOOK_SECRET` | 영문·숫자·`_`·`-`로 만든 16자 이상의 임의 문자열 |
| `ADMIN_TELEGRAM_USER_ID` | 앞에서 확인한 관리자 숫자 ID |

이 값들은 Cloudflare에 암호화되어 저장되고 공개 GitHub 저장소에는 들어가지 않습니다.

## 7. Telegram Webhook 연결

개인 PC PowerShell에서 실행합니다. `WORKER_BASE_URL`은 Cloudflare에 표시된 `https://...workers.dev` 주소입니다.

```powershell
$env:TELEGRAM_BOT_TOKEN = "BotFather_token"
$env:TELEGRAM_WEBHOOK_SECRET = "Cloudflare에_등록한_동일한_값"
$env:WORKER_BASE_URL = "https://worker-name.account.workers.dev"
node scripts/set-webhook.mjs
Remove-Item Env:TELEGRAM_BOT_TOKEN
Remove-Item Env:TELEGRAM_WEBHOOK_SECRET
Remove-Item Env:WORKER_BASE_URL
```

상태 확인:

```text
https://worker-name.account.workers.dev/healthz
```

## 8. 1분 공지 확인 활성화

1. GitHub Repository variable `ENABLE_CRON`을 `true`로 변경합니다.
2. **Verify and deploy bot** workflow를 다시 실행합니다.
3. 첫 Cron 실행은 현재 RSS를 기준 상태로만 저장하며 기존 공지를 발송하지 않습니다.

## 9. 초대 링크 만들기

관리자 계정으로 새 봇에게 보냅니다.

```text
/invite 1 7
```

한 번 사용할 수 있고 7일 뒤 만료되는 초대 링크가 생성됩니다. 여러 명이 함께 사용할 링크는 다음처럼 만들 수 있습니다.

```text
/invite 10 3
```

### 명령어

| 명령 | 권한 | 설명 |
| --- | --- | --- |
| `/start 초대코드` | 초대 사용자 | 구독 시작 |
| `/status` | 사용자 | 구독 상태 확인 |
| `/stop` | 사용자 | 구독 해제 및 구독 데이터 삭제 |
| `/invite [횟수] [일수]` | 관리자 | 초대 링크 생성 |
| `/subscribers` | 관리자 | 현재 구독자 수 확인 |
| `/revoke CHAT_ID` | 관리자 | 특정 구독 해제 |

## 로컬 검증

```powershell
npm ci
npm run check
```

## 보안 원칙

- 모든 Secret은 GitHub 또는 Cloudflare의 Secret 저장소에만 입력합니다.
- 구독자 목록을 저장소, 로그, Artifact에 출력하지 않습니다.
- 관리자 ID 외에는 Telegram 사용자 프로필을 저장하지 않습니다.
- 초대 링크는 필요한 사람에게만 전달하고 넉넉한 다회용 링크를 만들지 않습니다.
- `MAX_SUBSCRIBERS`와 `BROADCAST_BATCH_SIZE`를 불필요하게 높이지 않습니다.

취약점 제보 방법은 [SECURITY.md](SECURITY.md), 저장 데이터 범위는 [PRIVACY.md](PRIVACY.md)를 참고하세요.
