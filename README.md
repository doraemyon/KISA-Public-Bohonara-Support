# KISA 승인형 Telegram 알림 봇

KISA 보호나라 보안공지를 Telegram 개인 메시지로 전달하는 소규모 승인형 알림 서비스입니다. 공개 가입 페이지의 QR로 봇을 열고 본인의 성명을 제출하면 관리자가 가입 신청을 검토합니다. Telegram bot token과 관리자 ID는 Cloudflare Worker Secret으로 관리합니다. 신청·구독 데이터는 공개 저장소에 넣지 않습니다.

## 주요 기능

- 반응형 가입 안내 페이지와 Telegram QR
- 관리자 개인 Telegram의 가입 승인·거절 버튼
- 시간당 신청·승인 대기·구독자 수 상한
- 일회용·다회용 만료 초대 링크도 보조 수단으로 유지
- `/start`, `/stop`, `/status`, `/help` 구독 명령
- 관리자 전용 `/applications`, `/approve`, `/reject`, `/reopen`, `/invite`, `/subscribers`, `/revoke`
- 구독자 수 상한 강제 적용(기본 50명)
- 한 번에 최대 20명씩 분할 발송
- 실패 지수 백오프 재시도
- 봇 차단·탈퇴 사용자의 구독 자동 정리
- KISA 기존 공지로 최초 상태를 만들고 과거 공지는 발송하지 않음
- Worker 주소에서 국문·영문 공지 열람, 복사, 다운로드

```text
GitHub Public 저장소 ──배포──> Cloudflare Worker
                                  ├─ 공개 가입 페이지 + Telegram QR
                                  ├─ Telegram Webhook + 관리자 승인
                                  ├─ KISA RSS 1분 확인
                                  └─ Cloudflare D1 (비공개 신청·구독 정보)
```

## 가입 신청과 접근 통제

Worker 첫 화면의 QR 또는 버튼으로 Telegram 봇을 열고 **시작**을 누릅니다. 봇의 개인 채팅에 `/알림신청 성명`을 입력합니다. 예를 들어 `/알림신청 이예원`처럼 보냅니다. 관리자가 성명과 Telegram 신청자를 확인해 승인하면 구독이 시작됩니다.

```text
[KISA 알림 봇 가입 신청]
표시 이름: ...
Telegram 사용자명: @...
성명: ...
Chat ID: ...

[승인] [거절]
```

- 가입 페이지에는 관리자 API나 신청자 목록이 없습니다.
- 승인 callback은 webhook secret과 `ADMIN_TELEGRAM_USER_ID`를 모두 확인합니다.
- 표시 이름, Telegram 사용자명, 신청 성명은 승인 또는 거절 시 D1 신청 기록에서 삭제합니다.
- 같은 chat ID는 한 번만 신청할 수 있습니다.
- 시간당 신규 신청은 기본 20건, 전체 승인 대기는 기본 100건입니다.
- 관리자 신청 알림은 분당 최대 5건으로 제한합니다.
- 성명 입력 안내는 같은 대화에 분당 한 번, 봇 전체에서 분당 최대 5회로 제한합니다. 신청 결과는 관리자 처리 후 전달됩니다.
- 기존 제한형 초대 링크도 관리자가 필요할 때 사용할 수 있습니다.
- 초대 코드 원문은 DB에 저장하지 않고 SHA-256 해시만 저장합니다.
- 사용 횟수는 1~20회, 유효기간은 1~30일로 제한합니다.
- 구독자 최대 인원은 배포 변수로 제한합니다.
- 관리자가 아닌 사용자는 초대 생성, 승인·거절, 신청자·구독자 조회와 강제 해제를 실행할 수 없습니다.

## 공지 열람

국문·영문 문서는 기존 공지 생성 작업에서 완성합니다. Worker는 내부 문서 주소에서 결과를 읽고 `/notices/` 아래의 공개 주소로 제공합니다. 양쪽 문서가 준비되기 전에는 같은 주소에서 게시 상태를 자동으로 확인합니다.

## 비용과 한도

팀 단위 사용은 Cloudflare Workers와 D1 무료 범위에서 운영할 수 있습니다. 예약 실행 한 번에 공지 알림 20건과 관리자 신청 알림 5건 이하로 제한해 Telegram 대량 발송 제한과 Workers 외부 요청 제한 아래에 둡니다.

- [Cloudflare Workers Free 한도](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 가격과 무료 한도](https://developers.cloudflare.com/d1/platform/pricing/)
- [Telegram Bot 발송 제한](https://core.telegram.org/bots/faq#broadcasting-to-users)

## 1. 새 Telegram 봇 만들기 — 사용자 작업 필요

1. Telegram에서 공식 `@BotFather`를 엽니다.
2. `/newbot`으로 이 프로젝트 전용 봇을 만듭니다.
3. 봇 사용자 이름과 HTTP API token을 복사합니다.
4. BotFather의 `/setjoingroups`에서 이 봇의 그룹 추가를 **Disable**로 설정합니다.
5. 새 봇에게 `/start`를 한 번 보냅니다.

Telegram 정책상 봇 생성과 token 발급은 BotFather에서 계정 소유자가 직접 해야 합니다. 봇 token은 Issue, 채팅, 코드에 올리지 마세요.

### Telegram 초기 설정 자동화

Webhook을 연결하기 전에 개인 PC PowerShell에서 실행합니다.

```powershell
$env:TELEGRAM_BOT_TOKEN = "BotFather_token"
npm ci
npm run setup:telegram
Remove-Item Env:TELEGRAM_BOT_TOKEN
```

스크립트가 bot token 검증, 봇 사용자 이름 조회, 명령어·설명 등록, 관리자 숫자 ID 확인과 webhook secret 생성을 처리합니다. 출력된 `BOT_USERNAME`, `ADMIN_TELEGRAM_USER_ID`, `TELEGRAM_WEBHOOK_SECRET`은 다음 설정에 사용합니다.

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
| `PUBLIC_BOT_CLOUDFLARE_API_TOKEN` | 앞 단계에서 발급한 공개 봇 배포용 Cloudflare API token |
| `PUBLIC_BOT_CLOUDFLARE_ACCOUNT_ID` | 공개 봇을 배포할 Cloudflare Account ID |

Telegram token은 GitHub에 등록하지 않습니다. 첫 배포 후 Cloudflare Worker Secret에 직접 등록합니다.

### Repository variables

| 이름 | 값 |
| --- | --- |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 Database ID |
| `CLOUDFLARE_D1_DATABASE_NAME` | `kisa-public-bohonara-support` |
| `BOT_USERNAME` | `@`를 제외한 BotFather 봇 사용자 이름 |
| `PUBLIC_BASE_URL` | Telegram 버튼에 사용할 Worker의 공개 HTTPS 주소 |
| `MAX_SUBSCRIBERS` | 권장 `50` |
| `BROADCAST_BATCH_SIZE` | 권장 `20`, 최대 `20` |
| `MAX_PENDING_APPLICATIONS` | 권장 `100` |
| `MAX_APPLICATIONS_PER_HOUR` | 권장 `20` |
| `ADMIN_NOTIFICATION_BATCH_SIZE` | 권장 `5`, 최대 `5` |
| `CLOUDFLARE_DEPLOY_ENABLED` | 첫 배포를 시작할 때 `true` |
| `ENABLE_CRON` | 처음에는 반드시 `false` |

`CLOUDFLARE_DEPLOY_ENABLED`가 `true`가 되기 전에는 GitHub Actions가 테스트만 실행하고 Cloudflare에는 배포하지 않습니다.

## 5. 첫 배포

1. **Actions → Verify and deploy bot → Run workflow**를 실행합니다.
2. D1 migration과 Worker 배포가 성공했는지 확인합니다.
3. Cloudflare **Workers & Pages**에서 생성된 `kisa` Worker를 엽니다.
4. `https://kisa.<계정-서브도메인>.workers.dev/` 주소를 복사합니다. 이 주소가 가입 QR 페이지입니다.

첫 배포에서는 `ENABLE_CRON=false`이므로 아직 RSS 확인 작업이 실행되지 않습니다.

## 6. Worker Secrets 등록

Cloudflare Worker의 **Settings → Variables and Secrets → Add**에서 모두 **Secret** 유형으로 등록합니다.

| Secret | 값 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather HTTP API token |
| `TELEGRAM_WEBHOOK_SECRET` | `setup:telegram`이 출력한 값 |
| `ADMIN_TELEGRAM_USER_ID` | `setup:telegram`이 출력한 관리자 숫자 ID |
| `NOTICE_ARCHIVE_ORIGIN` | Worker가 서버에서 읽는 번역 문서의 HTTPS 기본 주소 |

이 값들은 Cloudflare에 암호화되어 저장되고 공개 GitHub 저장소에는 들어가지 않습니다.

## 7. Telegram Webhook 연결 자동화

개인 PC PowerShell에서 실행합니다. `WORKER_BASE_URL`에는 아래 예시의 `YOUR-SUBDOMAIN`을 실제 Cloudflare 계정 서브도메인으로 바꿔 넣습니다.

```powershell
$env:TELEGRAM_BOT_TOKEN = "BotFather_token"
$env:TELEGRAM_WEBHOOK_SECRET = "Cloudflare에_등록한_동일한_값"
$env:ADMIN_TELEGRAM_USER_ID = "관리자_숫자_ID"
$env:WORKER_BASE_URL = "https://kisa.YOUR-SUBDOMAIN.workers.dev"
npm run setup:telegram
Remove-Item Env:TELEGRAM_BOT_TOKEN
Remove-Item Env:TELEGRAM_WEBHOOK_SECRET
Remove-Item Env:ADMIN_TELEGRAM_USER_ID
Remove-Item Env:WORKER_BASE_URL
```

이 실행이 Telegram의 `message`, `callback_query` webhook과 봇 명령·설명을 함께 설정합니다.

상태 확인:

```text
https://kisa.YOUR-SUBDOMAIN.workers.dev/healthz
```

가입 페이지는 Worker 기본 주소입니다.

```text
https://kisa.YOUR-SUBDOMAIN.workers.dev/
```

## 8. 1분 공지 확인 활성화

1. GitHub Repository variable `ENABLE_CRON`을 `true`로 변경합니다.
2. **Verify and deploy bot** workflow를 다시 실행합니다.
3. 첫 Cron 실행은 현재 RSS를 기준 상태로만 저장하며 기존 공지는 발송하지 않습니다. 이후 가입 신청 알림과 새 공지 확인이 매분 실행됩니다.

## 9. 가입 승인과 보조 초대 링크

신규 신청은 관리자 Telegram에 승인·거절 버튼으로 도착합니다. 버튼을 사용할 수 없을 때는 `/approve CHAT_ID` 또는 `/reject CHAT_ID`로 동일하게 처리할 수 있습니다.

신청 정보가 비어 있는 이전 신청은 Telegram에서 `/알림신청 성명`을 보내면 다시 접수됩니다.

거절한 사용자의 재신청을 허용하려면 다음 명령으로 거절 기록을 삭제합니다.

```text
/reopen CHAT_ID
```

승인 절차를 건너뛰는 제한형 링크가 필요할 때만 기존 초대 명령을 사용합니다.

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
| `/start` | 신청자 | 가입 방법 안내 |
| `/알림신청 성명` | 신청자 | 본인의 성명으로 승인 신청 |
| `/start 초대코드` | 초대 사용자 | 관리자 생성 링크로 즉시 구독 |
| `/status` | 사용자 | 구독 상태 확인 |
| `/stop` | 사용자 | 구독 해제 및 구독 데이터 삭제 |
| `/applications` | 관리자 | 승인 대기 신청 수 확인 |
| `/approve CHAT_ID` | 관리자 | 가입 신청 승인 |
| `/reject CHAT_ID` | 관리자 | 가입 신청 거절 |
| `/reopen CHAT_ID` | 관리자 | 다시 신청할 수 있도록 기록 삭제 |
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
- 승인 판단에 사용한 계정명과 Telegram 프로필 정보는 신청 처리 즉시 D1에서 지웁니다.
- 공개 가입 페이지에는 관리자 기능이나 D1 접근 경로를 두지 않습니다.
- 초대 링크는 필요한 사람에게만 전달하고 넉넉한 다회용 링크를 만들지 않습니다.
- `MAX_SUBSCRIBERS`와 `BROADCAST_BATCH_SIZE`를 불필요하게 높이지 않습니다.

취약점 제보 방법은 [SECURITY.md](SECURITY.md), 저장 데이터 범위는 [PRIVACY.md](PRIVACY.md)를 참고하세요.
