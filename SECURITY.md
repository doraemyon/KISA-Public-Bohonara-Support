# Security Policy

## Secret 취급

다음 값을 코드, Commit, Issue, Discussion, Action 로그에 올리지 마세요.

- Telegram bot token
- Telegram webhook secret
- Cloudflare API token
- Cloudflare Worker Secret

공개 가입 페이지에는 관리자 기능이나 D1 직접 접근 경로를 추가하지 않습니다. 가입 승인은 Telegram webhook secret 검증과 `ADMIN_TELEGRAM_USER_ID` 일치 확인을 모두 통과해야 합니다.

유출이 의심되면 해당 서비스에서 즉시 폐기하고 새 값으로 교체하세요.

## 취약점 제보

실제 Secret이나 구독자 정보를 포함한 공개 Issue를 만들지 마세요. 저장소 소유자에게 GitHub의 비공개 보안 제보 기능으로 알려 주세요.
