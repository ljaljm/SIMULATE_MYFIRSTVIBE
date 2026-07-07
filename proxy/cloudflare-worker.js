// ═══════════════════════════════════════════════════════════════════════════
// 디지털 공론장 토론 시뮬레이터 — 교사용 프록시 서버 (Cloudflare Worker)
//
// 역할: 교사의 Anthropic API 키를 서버에만 숨겨두고, 학생들은 키 없이
//       이 서버 주소만으로 AI 토론을 사용할 수 있게 합니다.
//
// 배포 방법은 저장소의 PROXY_SETUP.md 를 참고하세요.
//
// 환경 변수 (Cloudflare 대시보드 → Settings → Variables 에서 설정):
//   ANTHROPIC_API_KEY  (필수, Secret) — 교사의 Anthropic API 키
//   ACCESS_CODE        (선택, Secret) — 수업용 접속 코드. 설정하면 코드를
//                                       아는 학생만 사용할 수 있습니다.
//   DAILY_LIMIT        (선택)         — 하루 최대 요청 수. 기본 2000.
//                                       (KV 네임스페이스 USAGE 바인딩 시 동작)
// ═══════════════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST')
      return json({ error: { message: 'POST 요청만 허용됩니다.' } }, 405);

    // 접속 코드 검사 (설정된 경우)
    if (env.ACCESS_CODE && request.headers.get('X-Access-Code') !== env.ACCESS_CODE)
      return json({ error: { message: '접속 코드가 올바르지 않습니다. 선생님께 확인하세요.' } }, 403);

    // 일일 사용량 상한 (KV 네임스페이스 USAGE가 바인딩된 경우에만 동작)
    if (env.USAGE) {
      const today = new Date().toISOString().slice(0, 10);
      const used = parseInt((await env.USAGE.get(today)) || '0', 10);
      const limit = parseInt(env.DAILY_LIMIT || '2000', 10);
      if (used >= limit)
        return json({ error: { message: '오늘의 수업용 사용량 한도에 도달했습니다.' } }, 429);
      await env.USAGE.put(today, String(used + 1), { expirationTtl: 172800 });
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: { message: '잘못된 요청 형식입니다.' } }, 400); }

    // 비용 안전장치: 모델 고정(Haiku), 토큰 상한, 히스토리/본문 길이 제한
    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(Number(body.max_tokens) || 400, 500),
      system: String(body.system || '').slice(0, 8000),
      messages: (Array.isArray(body.messages) ? body.messages : [])
        .slice(-12)
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 2000),
        })),
    };
    if (payload.messages.length === 0)
      return json({ error: { message: '메시지가 비어 있습니다.' } }, 400);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  },
};
