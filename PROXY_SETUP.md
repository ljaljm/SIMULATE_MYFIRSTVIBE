# 🏫 교사용 프록시 서버 설치 가이드

학생들이 **API 키 없이** AI 토론 모드를 사용할 수 있게 하는 방법입니다.
교사의 키는 서버(Cloudflare) 안에만 저장되고, 학생 브라우저에는 절대 노출되지 않습니다.

소요 시간: 약 10~15분 · 비용: Cloudflare 무료 플랜으로 충분

---

## 💰 먼저, 요금 걱정에 대한 답

이 앱은 가장 저렴한 모델(Claude Haiku 4.5)만 쓰도록 프록시에서 **강제 고정**되어 있습니다.

| 항목 | 수치 |
|---|---|
| 1회 응답 비용 | 약 0.004~0.006달러 (약 6~8원) |
| 학생 30명 × 25턴 (1차시 수업) | **약 3~5달러 (약 4,500~7,000원)** |
| 4차시 전체 프로그램 | 약 15~20달러 |

추가 안전장치 3중 구조:
1. **프록시가 모델·토큰 상한을 강제** — 학생이 조작해도 비싼 모델 호출 불가
2. **일일 요청 수 상한(DAILY_LIMIT)** — 기본 2,000회/일, 초과 시 자동 차단 (아래 4단계)
3. **Anthropic 콘솔 지출 한도** — [console.anthropic.com](https://console.anthropic.com) → Settings → Limits 에서 월 지출 한도(예: $20)를 직접 설정 가능. 이 한도를 넘으면 어떤 경우에도 과금되지 않습니다. **이것을 꼭 설정하세요.**

---

## 1단계 — Cloudflare 계정 만들기 (무료)

1. https://dash.cloudflare.com/sign-up 접속 → 이메일로 가입
2. 로그인 후 왼쪽 메뉴에서 **Workers & Pages** 클릭

## 2단계 — Worker 만들기

1. **Create(생성)** → **Create Worker** 클릭
2. 이름을 원하는 대로 입력 (예: `debate-proxy`) → **Deploy** 클릭
3. 배포 후 **Edit code(코드 편집)** 클릭
4. 기존 코드를 전부 지우고, 이 저장소의 **`proxy/cloudflare-worker.js`** 파일 내용을 그대로 붙여넣기
5. 오른쪽 위 **Deploy** 클릭

## 3단계 — API 키 등록 (가장 중요)

1. Worker 화면에서 **Settings → Variables and Secrets** 이동
2. **Add** 클릭 후:
   - Type: **Secret**
   - Variable name: `ANTHROPIC_API_KEY`
   - Value: 교사의 Anthropic API 키 (`sk-ant-...`)
3. (권장) 하나 더 추가:
   - Type: **Secret**
   - Variable name: `ACCESS_CODE`
   - Value: 수업에서 쓸 접속 코드 (예: `우리반2026`)
   - → 이 코드를 아는 학생만 사용할 수 있게 됩니다
4. **Deploy** 로 다시 배포

## 4단계 — (선택) 일일 사용량 상한 걸기

1. Cloudflare 메뉴 **Storage & Databases → KV** → **Create a namespace** (이름: `USAGE`)
2. Worker의 **Settings → Bindings → Add → KV namespace**
   - Variable name: `USAGE` / KV namespace: 방금 만든 것 선택
3. (선택) Variables에 `DAILY_LIMIT` 추가 (예: `1500`) — 미설정 시 2,000회/일

## 5단계 — 앱에 연결하기

1. Worker 메인 화면에 표시된 주소 복사 (예: `https://debate-proxy.홍길동.workers.dev`)
2. 토론 시뮬레이터 접속 → 상단 모드를 **🏫 교사 프록시 서버** 로 변경
3. 프록시 주소 붙여넣기 + 접속 코드 입력 → **저장**
4. 끝! 학생들에게는 **앱 주소 + 접속 코드**만 알려주면 됩니다.

---

## 문제 해결

| 증상 | 해결 |
|---|---|
| "접속 코드가 올바르지 않습니다" | 3단계의 ACCESS_CODE와 학생이 입력한 코드가 일치하는지 확인 |
| "오늘의 수업용 사용량 한도에 도달" | DAILY_LIMIT 값을 올리거나 다음 날 사용 |
| 401/인증 오류 | ANTHROPIC_API_KEY가 정확한지, 키가 활성 상태인지 확인 |
| 응답이 느림/끊김 | 일시적 과부하 — 앱이 자동으로 3회 재시도하고, 실패하면 오프라인 엔진으로 자동 전환되므로 수업은 중단되지 않습니다 |
