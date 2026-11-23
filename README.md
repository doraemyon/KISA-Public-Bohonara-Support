# 보호나라 보안공지 알리미

KISA 보호나라에 새 보안공지가 올라오면 Telegram 또는 Discord로 알려주는 비공식 서비스입니다. 알림은 관리자 승인 후 받을 수 있습니다. 공개 공지 목록에서는 가입 없이 공지를 찾아보고 국문·영문 문서를 읽을 수 있습니다.

[알림 신청](https://notice.bohonara.workers.dev/) · [공지 목록](https://notice.bohonara.workers.dev/notices/)

![보호나라 RSS의 새 공지 감지부터 Telegram·Discord 알림과 국문·영문 문서 생성·게시까지의 서비스 구성도](docs/images/service-overview.png)

[구성도 편집 파일 · draw.io](docs/images/service-overview.drawio)

## 주요 기능

- **Telegram**에서 봇의 개인 메시지로 새 공지 알림을 받습니다.
- **Discord**에서 각자 연결한 채널로 새 공지 알림을 받습니다.
- **공개 공지 목록**에서 제목을 검색하고, 원문과 국문·영문 문서를 열거나 텍스트로 저장할 수 있습니다.

## 화면

**가입 페이지 · Discord 탭**

![Discord 알림 신청 절차와 QR 코드](docs/images/signup.jpg)

**공개 공지 목록**

![검색창과 최근 보호나라 보안공지가 표시된 공지 목록](docs/images/notices.jpg)

## 공지 감지부터 번역·게시까지

```mermaid
---
config:
  htmlLabels: false
---
flowchart TD
    A(["KISA 공지 등록"]) --> B["RSS 확인<br/>누락 공지 점검"]
    B --> C{"새 공지 또는<br/>미게시 문서?"}
    C -->|NO| D(["다음 확인까지<br/>대기"])
    C -->|YES| E["KISA 원문 읽기<br/>국문 문서 만들기"]
    E --> F["영문 번역<br/>Cloudflare<br/>→ Google"]
    F --> G{"번역 검증<br/>통과?"}
    G -->|YES| L["국문·영문 문서<br/>D1에 함께 게시"]
    G -->|NO| H["Gemini 번역<br/>키가 있을 때"]
    H --> I{"번역 검증<br/>통과?"}
    I -->|YES| L
    I -->|NO| J["MyMemory<br/>→ 오프라인<br/>OPUS-MT"]
    J --> K{"번역 검증<br/>통과?"}
    K -->|YES| L
    K -->|NO| M["복구 큐에 저장<br/>다음 실행에서<br/>재시도"]
    M --> E
    L --> N(["공개 공지 목록<br/>열람 · 복사<br/>다운로드"])
    B --> O{"RSS에 새 공지?"}
    O -->|YES| P["새 공지 알림<br/>Telegram 구독자<br/>Discord 채널"]
    O -->|NO| D

    classDef entry fill:#E5F6EF,stroke:#4B927C,color:#164F3E,stroke-width:1.5px,font-weight:600;
    classDef step fill:#E9F2FF,stroke:#6588B8,color:#223C62,stroke-width:1.5px;
    classDef choice fill:#FFF3D7,stroke:#AF7C2D,color:#604115,stroke-width:1.5px,font-weight:600;
    classDef alternate fill:#F2EAFE,stroke:#9472C2,color:#513274,stroke-width:1.5px;
    classDef retry fill:#FFEDE6,stroke:#B5755C,color:#713C2C,stroke-width:1.5px;
    classDef idle fill:#EDF0F4,stroke:#8793A4,color:#3A475A,stroke-width:1.5px;
    class A,L,N entry;
    class B,E,F step;
    class C,G,I,K,O choice;
    class H,J,P alternate;
    class M retry;
    class D idle;
    linkStyle default stroke:#78869C,stroke-width:1.5px;
```

Cloudflare나 Gemini에 필요한 키가 설정된 경우 해당 서비스를 시도합니다. 번역 검증에서는 문서의 제목·요약·본문과 CVE 번호, 버전, 링크 등 핵심 정보가 보존됐는지 확인합니다. 알림은 문서 게시와 별도로 Telegram 구독자와 구독자가 연결한 Discord 비공개 채널에 발송합니다. 문서가 준비되는 동안 국문·영문 링크에는 준비 상태가 표시됩니다.

## 문서

[설치·운영 안내](docs/operations.md) · [개인정보 처리 안내](PRIVACY.md) · [보안 정책](SECURITY.md) · [MIT 라이선스](LICENSE)
