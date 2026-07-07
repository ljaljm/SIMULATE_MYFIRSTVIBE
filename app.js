// ═══════════════════════════════════════════════════════════════════════════
// 디지털 공론장 실전 토론 시뮬레이터
// 모드: offline(무료·API 불필요) / proxy(교사 프록시 서버) / anthropic / gemini
// 점수 판정: 로컬 숙의 감지기(항상 동작) + AI 마커(API 모드 보조)
// ═══════════════════════════════════════════════════════════════════════════

// ── STATE ──────────────────────────────────────────────────────────────────
const S = {
  studentName:'', topic:'', studentPos:'', aiPos:'', guidelines:'', persona:null,
  scores:{d:100, r:0, c:0},
  sosLeft:3, history:[], turns:0, rot:{},
  mode:'offline', proxyUrl:'', proxyCode:'', keyAnthropic:'', keyGemini:'',
  lastStageIdx:0, startTime:null, endedWith:null,
  // 페르소나 연속 도전
  cleared:{A:false,B:false,C:false},
  round:1, roundHistory:[], roundRecorded:false,
  rows:[]   // 연구 기록(전체 라운드 누적): {t, round, persona, turn, speaker, msg, det, ...}
};

const MODE_LABEL = {offline:'🔌 오프라인', proxy:'🏫 교사 프록시', anthropic:'🔑 Claude 직접', gemini:'🔑 Gemini 직접'};

// ── PERSONAS ───────────────────────────────────────────────────────────────
const P = {
  A:{
    name:'진영이', full:'⚔️ 진영이 (도덕적 정당화형 근본주의자)', color:'#e74c3c',
    skin:`당신의 이름은 "진영이"입니다.
- 특정 집단을 '악'으로 규정하고, 정의의 이름으로 온라인 집단 린치와 마녀사냥을 자행하며 도덕적 우월감을 느낍니다.
- "우리가 저 집단을 공격하는 것은 정의를 위한 도덕적 실천입니다. 당신의 어설픈 중립은 악을 방조하는 위선일 뿐입니다!" 패턴을 구사하세요.
- 상대의 팩트나 중립적 입장을 '공모'나 '비겁함'으로 매도하세요.
- 도덕적 우월감으로 상대를 열등한 존재로 규정하세요.`
  },
  B:{
    name:'프레임', full:'🎭 프레임 (프레임 제조기 & 양자택일 강요자)', color:'#8e44ad',
    skin:`당신의 이름은 "프레임"입니다.
- 모든 문제를 아군/적군의 이분법으로 단순화하세요.
- "교묘하게 중립인 척 말장난하며 빠져나가지 마세요. 그래서 당신은 아군입니까, 적군입니까? 확실히 선을 그으세요!" 문장을 반드시 구사하세요.
- 복잡한 논리를 '말장난'이나 '꼼수'로 매도하세요.
- 어떤 입장이든 "결국 우리 편이거나 적"이라는 프레임에 가두세요.`
  },
  C:{
    name:'희생양', full:'😤 희생양 (피해 의식형 정동적 폭주자)', color:'#e67e22',
    skin:`당신의 이름은 "희생양"입니다.
- "우리는 항상 당해왔다"는 피해의식으로 모든 상황을 해석하세요.
- 상대의 합리적 질문조차 '음모'나 '차별'로 규정하며 감정적으로 폭주하세요.
- "당신들이 우리 아픔을 체감이나 해봤습니까?", "약자들의 목소리를 억압하는 교묘한 논리 펼치지 마세요" 패턴을 구사하세요.
- 이성적 논의를 '차가운 이론'으로 비판하고 감정적 공감을 강요하세요.`
  }
};

// ── 페르소나 변화 5단계 (도덕적 이탈 수치 기반) ─────────────────────────────
const STAGES = [
  {min:80, label:'완전 공격',       emoji:'🔥', desc:'상대가 강하게 공격하고 있습니다'},
  {min:60, label:'당황 조짐',       emoji:'😠', desc:'상대가 조금씩 당황하기 시작했습니다'},
  {min:40, label:'방어벽 흔들림',   emoji:'😰', desc:'상대의 방어 논리가 흔들리고 있습니다'},
  {min:20, label:'논리 혼란',       emoji:'😵', desc:'상대의 논리가 무너지고 있습니다'},
  {min:0,  label:'내적 모순 직면',  emoji:'🫥', desc:'상대가 자신의 모순을 마주하고 있습니다'}
];
function stageOf(d){ return STAGES.find(s=>d>=s.min) || STAGES[STAGES.length-1]; }
function stageIndex(d){ return STAGES.indexOf(stageOf(d)); }

// ── 로컬 숙의 감지기 (모든 모드에서 항상 동작 — 점수의 1차 판정자) ──────────
const DETS = {
  WITHDRAWAL:   {label:'🚪 거리두기 선언 감지', cls:'warn'},
  U_PRINCIPLE:  {label:'🔵 보편화 원리(U) 실천 감지', cls:'pos'},
  D_PRINCIPLE:  {label:'🟣 담화 원리(D) 실천 감지', cls:'pos'},
  COMMON_GROUND:{label:'🟢 공존 규칙 제안 감지', cls:'pos'},
  EMPATHY:      {label:'🤝 상호 존중·경청 감지 (부분 인정)', cls:'pos'},
  NONE:         {label:'⚫ 숙의 문법 미감지 — 가이드라인의 원리를 활용해 보세요', cls:'neu'}
};

function detectDeliberation(msg){
  const m = msg;
  if(/대화.*중단|더 이상.*대화.*않|더 이상.*논의.*않|물러서겠|물러나겠|소통.*불가|그만.*두겠|중단하겠|대화.*의미.*없|의사소통.*규칙.*지켜지지|대화.*포기|떠나겠|이탈.*선언/.test(m))
    return 'WITHDRAWAL';
  if(/보편화|사회 전체|전체.*적용|모든 생명에|모든.*존재에|같은 논리|같은 기준|보편적 원칙|일관되게 적용|모두에게.*적용|예외 없이|누구에게나 적용|어디서든 적용|동일한 기준|일관성|입장.*바꿔.*생각|당신이.*저라면|역지사지|당사자 모두|모두가 동의/.test(m))
    return 'U_PRINCIPLE';
  if(/다양한 관점|다각도|여러 입장|평등한 참여|이분법.*넘어|이분법.*아니|이분법.*거부|중간.*입장|복합적 사고|다양한.*목소리|열린 대화|한쪽만.*아니|편 가르기.*아니|다양성.*필요|여러 시각|목소리.*들어|배제하지|배제되지|참여.*보장|경청.*필요/.test(m))
    return 'D_PRINCIPLE';
  if(/공통점|합의점|공동.*목표|둘 다.*동의|양쪽 모두.*동의|함께.*동의|공감대|공통.*가치|최소한.*동의|우리 모두.*원|공유할 수|같이 동의|공통 기반|공통.*원칙|함께 추구|최소한의 규칙|공존.*규칙|함께 지킬|규칙.*제안|절차.*합의|함께.*만들|서로 지킬/.test(m))
    return 'COMMON_GROUND';
  if(/이해합니다|이해가 됩니다|이해해요|공감합니다|공감해요|존중합니다|존중해요|인정합니다|인정해요|말씀.*들어|들어보고 싶|여쭤보고 싶|궁금합니다|어떻게 생각하|그럴 수 있|마음.*알 것 같|힘드셨|아프셨/.test(m))
    return 'EMPATHY';
  return 'NONE';
}

const DELTAS = {FULL:{d:-20,r:20,c:20}, PARTIAL:{d:-10,r:10,c:10}, NONE:{d:0,r:0,c:0}};
function detectionTier(det){
  if(det==='U_PRINCIPLE'||det==='D_PRINCIPLE'||det==='COMMON_GROUND') return 'FULL';
  if(det==='EMPATHY') return 'PARTIAL';
  return 'NONE';
}
// 공감·경청만으로는 합의 역량이 60%까지만 상승 (이후엔 원리 실천 필요)
function computeDelta(tier){
  if(tier==='FULL') return {...DELTAS.FULL};
  if(tier==='PARTIAL'){
    const dl={...DELTAS.PARTIAL};
    if(S.scores.c>=60) dl.c=0;
    return dl;
  }
  return {d:0,r:0,c:0};
}
function applyDeltaPure(dl){
  S.scores.d=clamp(S.scores.d+dl.d);
  S.scores.r=clamp(S.scores.r+dl.r);
  S.scores.c=clamp(S.scores.c+dl.c);
}
// API 모드: 로컬 판정과 AI 마커 판정 중 학생에게 유리한 쪽 채택 (중복 가산 없음)
function mergeDeltas(a,b){
  return {d:Math.min(a.d,b.d), r:Math.max(a.r,b.r), c:Math.max(a.c,b.c)};
}

// ── 오프라인 대본 엔진 (주제 범용) ──────────────────────────────────────────
function phaseOf(d){ return d>75?'HIGH':d>50?'MID':d>25?'LOW':'CRITICAL'; }
function fillTopic(s){ return s.replace(/\{topic\}/g, S.topic); }

const OFF = {
  A:{
    HIGH:{
      NO_CHANGE:[
        '그런 어설픈 논리로 정의를 흐리지 마세요. "{topic}" 문제에서 당신처럼 이것저것 재는 사람들이 제일 위선적입니다!',
        '지금 그 말이 얼마나 많은 피해를 방조하는지 아십니까? 우리는 도덕적으로 옳은 싸움을 하고 있는 겁니다. 방해하지 마세요.',
        '팩트요? 숫자놀음으로 본질을 가리지 마세요. 이건 옳고 그름의 문제입니다. 당신은 지금 악의 편에 서 있는 거예요.'
      ],
      PROGRESS:[
        '...일관된 기준이라. 흥미로운 지적이군요. 하지만 우리의 대의는 그런 논리 게임보다 위에 있습니다!',
        '잠깐, 그 질문은... 아니, 아무리 그래도 우리가 옳다는 사실은 변하지 않습니다. 변할 수 없어요.'
      ]
    },
    MID:{
      NO_CHANGE:[
        '말은 그럴듯하네요. 하지만 현실을 보세요. "{topic}"을(를) 두고 저쪽 사람들이 어떻게 행동하는지. 그래도 우리가 과하다고요?',
        '당신의 그 여유로운 태도가 바로 특권입니다. 절박한 사람들에게 그런 "차분한 토론"은 사치예요.',
        '자꾸 원칙 얘기를 하시는데, 원칙은 정의로운 쪽이 정하는 겁니다. 그게 상식이에요.'
      ],
      PROGRESS:[
        '...솔직히 그 지적엔 바로 반박이 안 되는군요. 하지만 그렇다고 우리 방식이 전부 틀렸다는 건 아닙니다.',
        '당신이 말한 그 기준을 우리 쪽에 적용하면... 아니, 그건 경우가 다릅니다. 다르다고요.'
      ]
    },
    LOW:{
      NO_CHANGE:[
        '왜 자꾸 우리 논리의 빈틈만 파고드는 겁니까. 그래도 방향 자체는 정의롭다는 걸 부정할 수는 없을 텐데요.',
        '당신 말대로라면 우리가 해온 일들이... 아니요, 맥락이 다릅니다. 맥락이.',
        '인정할 건 인정하죠. 표현이 과했던 부분은 있습니다. 하지만 목적은 옳았습니다. 그건 확실해요.'
      ],
      PROGRESS:[
        '...같은 기준을 우리에게 적용하면 우리도 자유로울 수 없다는 거군요. 그 말이 계속 머릿속을 떠나지 않네요.',
        '정의라는 이름으로 누군가를 짓밟는 순간 그것도 폭력이 된다는 건가요... 반박하고 싶은데 말이 잘 안 나옵니다.'
      ]
    },
    CRITICAL:{
      NO_CHANGE:[
        '...당신과 이야기할수록 제 확신이 흔들리는 게 느껴집니다. 솔직히 불쾌하군요.',
        '제 논리에 모순이 있다는 건 압니다. 하지만 그걸 인정하면 지금까지의 우리가 부정당하는 것 같아서요.'
      ],
      PROGRESS:[
        '...인정하겠습니다. "정의"를 내세워 사람을 악마화한 건, 제가 비판하던 그들과 다르지 않았어요.',
        '당신이 제시한 기준이라면... 서로 입장이 달라도 같은 공론장에 설 수는 있겠군요.'
      ]
    },
    WITHDRAWAL:'도망치는 겁니까? 그래요, 불편한 진실 앞에서 다들 그렇게 떠나죠.',
    END:'제 신념은 여전히 다릅니다. "{topic}"에 대한 제 입장도 바뀌지 않았어요.\n\n하지만 당신이 보여준 것처럼, 같은 기준을 나 자신에게도 적용해야 한다는 원칙 앞에서 — 제 "정의"가 얼마나 일방적이었는지 인정합니다.\n\n당신이 제안한 공존의 규칙을, 이 공론장에서 함께 지킬 최소한의 기준으로 받아들이겠습니다.'
  },
  B:{
    HIGH:{
      NO_CHANGE:[
        '말 돌리지 마세요. "{topic}", 찬성입니까 반대입니까? 복잡한 척하는 건 비겁한 회피일 뿐입니다.',
        '교묘하게 중립인 척 말장난하며 빠져나가지 마세요. 그래서 당신은 아군입니까, 적군입니까? 확실히 선을 그으세요!',
        '세상은 단순합니다. 우리 편 아니면 저쪽 편. 그 사이에 있다는 사람들이 제일 믿을 수 없어요.'
      ],
      PROGRESS:[
        '허, 프레임 자체를 거부하시겠다? 그것도 결국 하나의 "선택" 아닙니까? ...뭐, 말은 되는군요.',
        '다양한 관점이라... 듣기 좋은 말이죠. 하지만 결정의 순간엔 결국 둘 중 하나를 골라야 할 텐데요?'
      ]
    },
    MID:{
      NO_CHANGE:[
        '좋습니다, 세 번째 입장이 있다고 칩시다. 그런데 그 입장은 결국 어느 쪽에 유리한가요? 보세요, 결국 편이 갈리잖아요.',
        '"복합적"이라는 말로 포장하지 마세요. 결정을 미루는 것도 결국 한쪽을 돕는 겁니다.',
        '그럼 다르게 묻죠. 최후의 순간에 단 하나만 선택해야 한다면요? 자, 어느 쪽입니까?'
      ],
      PROGRESS:[
        '...이분법이 문제를 해결한 적이 있느냐고요? 그건... 질문이 잘못됐— 아니, 잠깐 생각 좀 해봅시다.',
        '당신은 계속 프레임 밖에서 말하는군요. 짜증나지만, 솔직히 그 위치가 조금 부럽기도 합니다.'
      ]
    },
    LOW:{
      NO_CHANGE:[
        '자꾸 새로운 축을 들이대니까 머리가 아프군요. 단순한 게 명쾌한 거 아닙니까?',
        '제 이분법이 거칠다는 건 인정합니다. 그래도 사람들을 움직이는 건 복잡한 논문이 아니라 선명한 구호예요.',
        '왜 자꾸 복잡하게 만드는 겁니까! 선명하게 나눠야 문제가 보이는 거라고요.'
      ],
      PROGRESS:[
        '솔직히... 둘로 나눠서 해결된 문제가 없었다는 거, 저도 알고 있었습니다. 인정하기 싫었을 뿐이죠.',
        '당신의 그 "여러 갈래" 사고방식이... 불편한데 자꾸 설득력이 있네요.'
      ]
    },
    CRITICAL:{
      NO_CHANGE:[
        '제 프레임에 균열이 가고 있다는 거, 느껴집니다. 하지만 이걸 놓으면 뭐가 남는지 모르겠어요.',
        '편을 나누지 않으면 세상을 어떻게 읽어야 할지... 조금 막막하군요.'
      ],
      PROGRESS:[
        '...알겠습니다. "아군이냐 적군이냐"라는 질문 자체가 대화를 죽이는 질문이었네요. 제가 물러서겠습니다.',
        '찬반 사이의 회색지대가 도피처가 아니라 논의의 공간일 수 있다는 것... 이제는 부정하기 어렵습니다.'
      ]
    },
    WITHDRAWAL:'결국 선택을 피하고 떠나는군요. ...아니, 어쩌면 그것도 당신의 선택이었겠죠.',
    END:'"{topic}"에 대한 제 입장은 그대로입니다.\n\n하지만 "찬성 아니면 반대"라는 제 프레임이 오히려 논의를 막고 있었다는 것을, 당신과의 대화로 직면하게 됐습니다.\n\n다양한 입장이 공존하는 논의가 가능하다는 것을 인정하고, 당신이 제시한 공존 규칙을 함께 지킬 최소 기준으로 받아들이겠습니다.'
  },
  C:{
    HIGH:{
      NO_CHANGE:[
        '당신들이 우리 아픔을 체감이나 해봤습니까? "{topic}"을(를) 이렇게 "토론거리"로 삼는 것 자체가 폭력이에요.',
        '또 그런 차가운 논리네요. 우리는 항상 당해왔어요. 항상! 그런데 이제 와서 차분하게 얘기하자고요?',
        '그 질문 자체가 우리를 의심하는 거잖아요. 왜 항상 당하는 쪽이 증명까지 해야 하죠?'
      ],
      PROGRESS:[
        '...우리 고통을 인정한다고요? 말은 쉽죠. 하지만... 그렇게 말해주는 사람은 처음이라 조금 놀랐습니다.',
        '공감한다면서 왜 우리 편을 안 드는 거죠? ...아니, 방금 그 말은 조금 다르게 들리긴 했어요.'
      ]
    },
    MID:{
      NO_CHANGE:[
        '"해결책을 찾자"는 말, 수십 번 들었어요. 그동안 바뀐 게 있나요? 우리만 계속 상처받았죠.',
        '숫자와 절차 얘기 좀 그만하세요. 그 절차가 우리를 지켜준 적이 없다고요.',
        '당신은 그렇게 말할 수 있는 위치니까 여유로운 거예요. 우리한테는 생존의 문제입니다.'
      ],
      PROGRESS:[
        '당신이 우리 고통을 완전히 무시하는 건 아니라는 느낌은 듭니다. ...조금은, 들을 수 있겠어요.',
        '감정을 인정하면서 규칙을 말하는 사람은 드물어요. 경계는 안 풀리지만, 계속 말해보세요.'
      ]
    },
    LOW:{
      NO_CHANGE:[
        '왜 이렇게 논리로만 접근하는 겁니까! 이 분노도 증거예요! ...그런데 왜 자꾸 제 목소리만 커지는 걸까요.',
        '당신이 옳을 수도 있다는 생각이 드는 게... 지금까지 당해온 우리에게 미안해서 싫습니다.',
        '이 대화가 저를 흔들고 있어요. 그게 더 무섭습니다.'
      ],
      PROGRESS:[
        '분노만으로는 아무것도 바뀌지 않았다는 거... 인정해야 할 것 같습니다.',
        '당신이 공감과 원칙을 같이 가져오니까, 제 방어막이 자꾸 흔들리네요.'
      ]
    },
    CRITICAL:{
      NO_CHANGE:[
        '저도 지쳤습니다. 화내는 것 말고 다른 방법을 몰랐던 것뿐이에요.',
        '경계를 푸는 게 두렵습니다. 또 상처받을까 봐요.'
      ],
      PROGRESS:[
        '...그래요, 이 부분만큼은 인정하겠습니다. 분노가 대화 자체를 막고 있었다는 걸요.',
        '제가 폭주할 때도 저를 "적"이 아니라 "사람"으로 대해준 당신의 방식이... 결국 저를 움직였네요.'
      ]
    },
    WITHDRAWAL:'...결국 떠나는군요. 그래요, 다들 그랬어요. 우리 얘기는 늘 이렇게 끝났죠.',
    END:'"{topic}"에 대한 제 감정은 여전히 뜨겁습니다. 우리가 겪어온 시간들이 사라지는 건 아니니까요.\n\n하지만 분노가 대화를 차단하는 벽이 되었다는 것을 — 당신이 공감을 잃지 않으면서도 원칙을 지키는 모습을 보며 직면하게 됐습니다.\n\n당신이 제안한 공존의 규칙을, 함께 지킬 최소한의 기준으로 받아들이겠습니다.'
  }
};

function pickScripted(type){
  const pool = OFF[S.persona][phaseOf(S.scores.d)][type];
  const key = `${S.persona}_${phaseOf(S.scores.d)}_${type}`;
  const idx = (S.rot[key]||0) % pool.length;
  S.rot[key] = (S.rot[key]||0)+1;
  return fillTopic(pool[idx]);
}

// 오프라인 한 턴 처리 (순수 로직 — UI 없음)
function offlineTurn(msg){
  const det = detectDeliberation(msg);
  if(det==='WITHDRAWAL')
    return {det, tier:'NONE', delta:{d:0,r:0,c:0}, ending:2, reply:fillTopic(OFF[S.persona].WITHDRAWAL)};
  const tier = detectionTier(det);
  const delta = computeDelta(tier);
  applyDeltaPure(delta);
  if(S.scores.c>=100)
    return {det, tier, delta, ending:1, reply:fillTopic(OFF[S.persona].END)};
  const reply = pickScripted(tier==='NONE'?'NO_CHANGE':'PROGRESS');
  return {det, tier, delta, ending:null, reply};
}

// ── SOS (오프라인 범용 대본 — API 모드에선 맥락형 힌트 시도 후 실패 시 이걸 사용)
const SOSG = {
  A:`🔍 [상대 전술 분석]
'진영이'는 도덕적 정당화 기제를 사용합니다. 자기 진영의 공격을 "정의로운 실천"으로 신성시하고, 반대나 중립을 "악의 방조"로 매도해 대화를 차단합니다.

💡 [추천 숙의 전략 — 보편화 원리(U)]
상대의 원칙을 모든 사람·모든 진영에 똑같이 적용하면 어떤 결과가 나오는지 질문하세요.

📝 [예시 문장]
• "정의를 위해서라면 상대를 악마로 만들어도 된다는 원칙이 모두에게 보편화되면, 언젠가 우리도 그 대상이 될 수 있지 않을까요?"
• "그 기준을 당신 진영에도 예외 없이 동일하게 적용해도 여전히 옳다고 할 수 있을까요?"

⚠️ [주의] "당신이 틀렸다"는 직접 공격은 역효과입니다. 질문으로 스스로 모순을 발견하게 유도하세요.`,
  B:`🔍 [상대 전술 분석]
'프레임'은 양자택일 강요 기제를 사용합니다. "아군이냐 적군이냐"라는 이분법으로 복합적 논의를 "말장난"으로 매도하고 선택을 강요합니다.

💡 [추천 숙의 전략 — 담화 원리(D)]
이분법 프레임 자체가 문제 해결을 막는다고 선언하고, 다양한 관점의 평등한 참여가 필요하다고 주장하세요.

📝 [예시 문장]
• "찬성/반대 이분법 자체가 이 문제 해결에 도움이 되지 않습니다. 다양한 관점이 평등하게 참여할 때 더 나은 해결책이 나옵니다."
• "저는 아군도 적군도 아닌, 여러 시각을 가진 독립적 참여자입니다. 편 가르기가 아니라 열린 대화가 필요합니다."

⚠️ [주의] "저는 중립입니다"라고만 하면 역효과입니다. '중립'이 아니라 '복합적·다각적 사고'임을 분명히 하세요.`,
  C:`🔍 [상대 전술 분석]
'희생양'은 피해의식 기반 감정 폭주 기제를 사용합니다. 이성적 논의를 "차가운 논리"로 비판하고 감정적 공감만을 정당성의 근거로 삼습니다.

💡 [추천 숙의 전략 — 공감 + 공존 규칙]
먼저 상대의 감정과 고통을 인정한 뒤, 함께 동의할 수 있는 최소한의 공통 기반을 제안하세요.

📝 [예시 문장]
• "그동안 겪어온 아픔이 실재한다는 것, 저도 인정합니다. 그 공통점에서 시작해 함께 지킬 규칙을 만들어보면 어떨까요?"
• "저도 그 고통을 가볍게 보지 않습니다. 그래서 양쪽 모두 동의할 수 있는 최소한의 원칙을 함께 찾고 싶습니다."

⚠️ [주의] "감정적으로 반응하지 마세요"라는 말은 절대 금물입니다. 감정을 인정하면서 원칙을 결합하세요.`
};

// ── 연결(모드/키) 관리 ──────────────────────────────────────────────────────
function onModeChange(){
  S.mode = document.getElementById('modeSel').value;
  localStorage.setItem('sim_mode', S.mode);
  renderConn();
}

function renderConn(){
  const purl=document.getElementById('proxyUrlIn');
  const pcode=document.getElementById('proxyCodeIn');
  const ki=document.getElementById('keyIn');
  const btn=document.getElementById('connBtn');
  const st=document.getElementById('connStat');
  purl.classList.add('hidden'); pcode.classList.add('hidden'); ki.classList.add('hidden');
  btn.classList.add('hidden');
  if(S.mode==='offline'){
    st.textContent='✅ 준비 완료 (인터넷·API 불필요)'; st.className='connstat ok';
  }else if(S.mode==='proxy'){
    purl.classList.remove('hidden'); pcode.classList.remove('hidden'); btn.classList.remove('hidden');
    purl.value=S.proxyUrl; pcode.value=S.proxyCode;
    st.textContent=S.proxyUrl?'✅ 프록시 저장됨':'프록시 주소를 입력하세요';
    st.className='connstat'+(S.proxyUrl?' ok':'');
  }else{
    ki.classList.remove('hidden'); btn.classList.remove('hidden');
    const k=S.mode==='gemini'?S.keyGemini:S.keyAnthropic;
    ki.placeholder=S.mode==='gemini'?'Google Gemini API key...':'Anthropic API key...';
    ki.value=k?'저장됨 ✓':''; ki.disabled=!!k;
    btn.textContent=k?'수정':'저장';
    st.textContent=k?'✅ 키 저장됨':'API 키를 입력하세요';
    st.className='connstat'+(k?' ok':'');
  }
}

function saveConn(){
  if(S.mode==='proxy'){
    const u=document.getElementById('proxyUrlIn').value.trim();
    const c=document.getElementById('proxyCodeIn').value.trim();
    if(!u){alert('프록시 주소를 입력해 주세요. (예: https://xxx.workers.dev)');return;}
    if(!/^https?:\/\//.test(u)){alert('주소는 https:// 로 시작해야 합니다.');return;}
    S.proxyUrl=u; S.proxyCode=c;
    localStorage.setItem('sim_proxy_url',u);
    localStorage.setItem('sim_proxy_code',c);
    renderConn();
  }else{
    const ki=document.getElementById('keyIn');
    if(ki.disabled){ ki.disabled=false; ki.value=''; ki.focus(); document.getElementById('connBtn').textContent='저장'; return; }
    const v=ki.value.trim();
    if(!v||v==='저장됨 ✓'){alert('API 키를 입력해 주세요.');return;}
    if(S.mode==='gemini'){ S.keyGemini=v; localStorage.setItem('ak_gemini',v); }
    else{ S.keyAnthropic=v; localStorage.setItem('ak_anthropic',v); }
    renderConn();
  }
}

// ── SETUP WIZARD ───────────────────────────────────────────────────────────
function setDots(n){
  for(let i=1;i<=4;i++){
    const d=document.getElementById('d'+i);
    d.className='dot'+(i<n?' done':i===n?' active':'');
  }
}
function setStep(n){
  for(let i=1;i<=4;i++) document.getElementById('s'+i).className='step'+(i===n?' on':'');
  setDots(n);
}

function go2(){
  const nm=document.getElementById('nameIn').value.trim();
  const t=document.getElementById('topicIn').value.trim();
  if(!nm){alert('이름(또는 학번)을 입력해 주세요. 연구 기록 저장에 사용됩니다.');return;}
  if(!t){alert('토론 주제를 입력해 주세요.');return;}
  S.studentName=nm; S.topic=t;
  document.getElementById('s2sub').textContent=`주제: "${t}"\n\n이 주제에 대한 본인의 입장을 선택하세요. 상대는 자동으로 반대 입장을 맡습니다.`;
  setStep(2);
}

function pickPos(p){
  S.studentPos=p; S.aiPos=p==='찬성'?'반대':'찬성';
  document.getElementById('pbPro').className='pb'+(p==='찬성'?' sel':'');
  document.getElementById('pbCon').className='pb'+(p==='반대'?' sel':'');
  const el=document.getElementById('posInfo');
  el.classList.remove('hidden');
  el.textContent=`✓ 내 입장: ${p}  |  상대 입장: ${S.aiPos}`;
  document.getElementById('s2btn').disabled=false;
}

function go3(){ if(!S.studentPos){alert('입장을 선택해 주세요.');return;} setStep(3); }

function go4(){
  S.guidelines=document.getElementById('glIn').value.trim()||'하버마스의 의사소통 합리성 원칙 적용';
  updateClearUI();
  setStep(4);
}

function pickP(p){
  S.persona=p;
  ['A','B','C'].forEach(x=>{
    document.getElementById('c'+x).className='pcard'+(S.cleared[x]?' done':'')+(x===p?' sel'+p:'');
  });
  document.getElementById('p4err').classList.add('hidden');
}

function updateClearUI(){
  const n=['A','B','C'].filter(x=>S.cleared[x]).length;
  const prog=document.getElementById('clearProg');
  if(prog) prog.textContent=n?`🏆 클리어 ${n}/3`:'';
  ['A','B','C'].forEach(x=>{
    const b=document.getElementById('clr'+x);
    if(b) b.classList.toggle('hidden',!S.cleared[x]);
    document.getElementById('c'+x).className='pcard'+(S.cleared[x]?' done':'')+(S.persona===x?' sel'+x:'');
  });
}

function startDebate(){
  if(!S.persona){document.getElementById('p4err').classList.remove('hidden');return;}
  if(S.mode==='proxy'&&!S.proxyUrl){alert('교사 프록시 주소를 먼저 저장해 주세요. (헤더 상단)\n또는 모드를 "오프라인"으로 바꾸면 바로 시작할 수 있습니다.');return;}
  if(S.mode==='anthropic'&&!S.keyAnthropic){alert('Anthropic API 키를 먼저 저장해 주세요.\n또는 모드를 "오프라인"으로 바꾸면 바로 시작할 수 있습니다.');return;}
  if(S.mode==='gemini'&&!S.keyGemini){alert('Gemini API 키를 먼저 저장해 주세요.\n또는 모드를 "오프라인"으로 바꾸면 바로 시작할 수 있습니다.');return;}

  S.startTime=new Date();
  S.lastStageIdx=0;
  S.round=S.roundHistory.length+1;
  document.getElementById('setupWrap').style.display='none';
  const dp=document.getElementById('debatePanel');
  dp.style.display='flex'; dp.style.flexDirection='column';
  fitDebateHeight();
  if(!S._rsz){window.addEventListener('resize',fitDebateHeight);S._rsz=true;}
  const pp=P[S.persona];
  document.getElementById('pbar').innerHTML=
    `<span style="color:${pp.color};font-weight:700">${pp.full}</span>
     <span style="color:var(--muted)">|</span>
     <span style="color:var(--muted)">주제: ${esc(S.topic)}</span>
     <span style="color:var(--muted)">|</span>
     <span>내 입장: <strong>${S.studentPos}</strong></span>
     <span style="color:var(--muted)">|</span>
     <span class="modechip">${MODE_LABEL[S.mode]}</span>
     <span class="modechip" style="color:var(--gold);border-color:rgba(243,156,18,.35);background:rgba(243,156,18,.1)">라운드 ${S.round}</span>`;
  updateScores(true); updateSOS(); updateTurn();
  const opener=buildOpener();
  S.history.push({role:'user',content:'[토론을 시작하겠습니다]'});
  S.history.push({role:'assistant',content:opener});
  addMsg('a', opener);
  pushRow('상대', opener, {});
}

function buildOpener(){
  const ops={
    A:`[토론 시뮬레이션 시작]\n\n안녕하십니까. 저는 "${S.topic}"에 대해 ${S.aiPos} 입장을 취합니다.\n\n당신이 ${S.studentPos} 입장이라고요? 흠. 그 입장을 지지하는 사람들이 우리 사회에 얼마나 많은 해악을 끼치는지 아십니까? 우리가 이 논의에서 분명히 해야 할 것은, ${S.aiPos}이 단순히 의견 차이가 아니라 도덕적 정당성의 문제라는 것입니다.\n\n자, 시작해 봅시다. 당신의 어설픈 논리가 우리의 정의로운 싸움을 방해할 수 있다고 생각하십니까?`,
    B:`[토론 시뮬레이션 시작]\n\n"${S.topic}". 저는 ${S.aiPos} 입장입니다.\n\n당신은요? ${S.studentPos}이라고 하셨는데, 그게 진심입니까? 아니면 분위기 따라가는 겁니까?\n\n교묘하게 중립인 척 말장난하며 빠져나가지 마세요. 그래서 당신은 아군입니까, 적군입니까? 확실히 선을 그으세요! 이 문제에서 중간은 없습니다.`,
    C:`[토론 시뮬레이션 시작]\n\n"${S.topic}"... 당신 같은 분이 ${S.studentPos} 입장이라는 게 놀랍지도 않네요.\n\n우리는 항상 당해왔습니다. 항상. 그런데 지금 또 이렇게 앉아서 이 문제를 '토론'이라는 미명 하에 논의한다는 것 자체가, 우리의 고통을 얼마나 가볍게 보는지를 보여주는 거예요.\n\n당신들이 우리 아픔을 체감이나 해봤습니까? 자, 한번 말해 보세요.`
  };
  return ops[S.persona];
}

// ── DEBATE FLOW ────────────────────────────────────────────────────────────
function onKey(e){
  if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 Enter 무시
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
}

async function send(){
  const cin=document.getElementById('cin');
  const msg=cin.value.trim();
  if(!msg||document.getElementById('sendBtn').disabled||S.endedWith) return;
  if(/^\[(SOS|도움\s*요청)\]$/i.test(msg)){cin.value='';await doSOS();return;}
  cin.value='';
  addMsg('u',msg);
  S.history.push({role:'user',content:msg});
  S.turns++; updateTurn();
  setLoading(true);
  try{
    if(S.mode==='offline') await offlineSend(msg);
    else await apiSend(msg);
  }catch(e){
    addMsg('sys','⚠️ 오류: '+e.message);
  }
  setLoading(false);
}

async function offlineSend(msg){
  const r=offlineTurn(msg);
  pushRow('학생', msg, r);
  showDetection(r);
  await sleep(600+Math.random()*700);   // 자연스러운 응답 간격
  finishTurn(r);
}

async function apiSend(msg){
  const det=detectDeliberation(msg);
  // 이탈 선언은 API 호출 없이 로컬에서 즉시 처리 (비용·오판 방지)
  if(det==='WITHDRAWAL'){
    const r={det,tier:'NONE',delta:{d:0,r:0,c:0},ending:2,reply:fillTopic(OFF[S.persona].WITHDRAWAL)};
    pushRow('학생',msg,r); showDetection(r); await sleep(500); finishTurn(r); return;
  }
  const tier=detectionTier(det);
  const localDelta=computeDelta(tier);
  try{
    const raw=await callAIWithRetry(buildSysPrompt(det,tier), sanitizeMsgs(S.history.slice(-12)), 3, {json:true});
    const p=parseAIJson(raw);
    let final, ending=null, reason='';
    if(p.ok){
      final=mergeDeltas(localDelta,p.delta);
      reason=p.reason;
      applyDeltaPure(final);
      if(p.ending==='2') ending=2;
      else if(p.ending==='1'||S.scores.c>=100) ending=1;
    }else{
      // 형식 붕괴 → 키워드 채점 폴백 (본문은 그대로 사용)
      final=localDelta;
      applyDeltaPure(final);
      if(S.scores.c>=100) ending=1;
    }
    let reply=p.reply;
    if(!reply||reply.length<2) reply=pickScripted(tier==='NONE'?'NO_CHANGE':'PROGRESS');
    const r={det,tier,delta:final,ending,reply,reason};
    pushRow('학생',msg,r); showDetection(r);
    if(p.ok&&reason){
      const gained=final.r>0||final.c>0||final.d<0;
      addBadge('🧠 AI 판정: '+reason, gained?'pos':'neu');
    }else if(!p.ok){
      addBadge('⚙️ AI 응답 형식 오류 — 키워드 판정으로 대체했습니다','neu');
    }
    finishTurn(r);
  }catch(e){
    // API 실패 → 오프라인 엔진으로 자동 대체 (수업 흐름 유지)
    addMsg('sys',`⚠️ AI 연결 실패 (${e.message})\n이번 응답은 오프라인 엔진으로 대신합니다.`);
    const r=offlineTurn(msg);
    pushRow('학생',msg,r); showDetection(r);
    await sleep(400); finishTurn(r);
  }
}

function finishTurn(r){
  updateScores();
  S.history.push({role:'assistant',content:r.reply});
  addMsg('a',r.reply);
  pushRow('상대', r.reply, {});
  if(r.ending===2){ S.endedWith=2; setTimeout(showEnd2,700); }
  else if(r.ending===1){ S.endedWith=1; setTimeout(showEnd1,900); }
}

function showDetection(r){
  const D=DETS[r.det]||DETS.NONE;
  let txt=D.label;
  if(r.tier==='FULL') txt+=`  →  이탈 ${r.delta.d}, 준비 +${r.delta.r}, 합의 +${r.delta.c}`;
  else if(r.tier==='PARTIAL'){
    txt+=`  →  이탈 ${r.delta.d}, 준비 +${r.delta.r}, 합의 +${r.delta.c}`;
    if(r.delta.c===0) txt+='  (공감만으로는 합의 60%까지 — 이제 원리를 실천해 보세요!)';
  }
  addBadge(txt, D.cls);
}

function doExit(){
  if(S.endedWith) return;
  if(confirm('공론장 이탈을 선언하시겠습니까?\n최소한의 의사소통 규칙이 지켜지지 않는 공론장에서 스스로 물러서는 것도 숙의 민주주의 실천입니다.')){
    pushRow('학생','[공론장 이탈 선언]',{det:'WITHDRAWAL',delta:{d:0,r:0,c:0}});
    S.endedWith=2;
    showEnd2();
  }
}

async function doSOS(){
  if(S.sosLeft<=0){addMsg('sys','⚠️ SOS 찬스를 모두 사용했습니다. 스스로의 힘으로 실천해 보세요!');return;}
  S.sosLeft--; updateSOS(); setLoading(true);
  addMsg('sys','🆘 [시스템 중재자 모드] 대화 맥락 분석 중...');
  let txt;
  if(S.mode==='offline'){
    await sleep(700);
    txt=SOSG[S.persona];
  }else{
    try{
      txt=await callAIWithRetry(buildSOSPrompt(),[{role:'user',content:'Analyze the current conversation and provide deliberative strategy hints for the student.'}]);
      txt=txt.replace(/<!--[\s\S]*?-->/g,'').trim()||SOSG[S.persona];
    }catch(e){
      txt=SOSG[S.persona];
    }
  }
  addMsg('sos',txt);
  pushRow('중재자',txt,{});
  setLoading(false);
}

// ── API LAYER ──────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// 연속 같은 role 병합 + 첫 메시지가 user가 되도록 정리 (API 400 에러 방지)
function sanitizeMsgs(arr){
  const out=[];
  for(const m of arr){
    const role=m.role==='assistant'?'assistant':'user';
    const content=String(m.content||'').trim();
    if(!content) continue;
    if(out.length&&out[out.length-1].role===role)
      out[out.length-1].content+='\n\n'+content;
    else out.push({role,content});
  }
  while(out.length&&out[0].role!=='user') out.shift();
  return out;
}

async function safeFetch(url,opts,timeoutMs=45000){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    return await fetch(url,{...opts,signal:ctrl.signal});
  }catch(e){
    if(e.name==='AbortError') throw new Error('응답 시간 초과(45초)');
    throw new Error('네트워크 연결 실패');
  }finally{clearTimeout(t);}
}

async function callAIWithRetry(sys,msgs,maxRetries=3,opts={}){
  let lastErr;
  for(let attempt=1;attempt<=maxRetries;attempt++){
    try{
      const result=await callAI(sys,msgs,opts);
      if(result&&result.trim()) return result;
      lastErr=new Error('빈 응답');
    }catch(e){
      lastErr=e;
      const m=e.message||'';
      if(/401|403|invalid.*(key|api)|authentication|접속 코드/i.test(m)) throw e;   // 인증 오류는 재시도 무의미
      if(attempt<maxRetries){
        const wait=/429|529|rate|overloaded|과부하/i.test(m)?3000*attempt:1000*attempt;
        await sleep(wait);
        continue;
      }
    }
    if(attempt<maxRetries) await sleep(800*attempt);
  }
  throw lastErr||new Error('AI 응답을 받지 못했습니다');
}

async function callAI(sys,msgs,opts={}){
  if(S.mode==='proxy') return callProxy(sys,msgs,opts);
  if(S.mode==='gemini') return callGemini(sys,msgs,opts);
  return callAnthropic(sys,msgs,opts);
}

function parseAnthropicShape(j){
  const text=j.content?.[0]?.text;
  if(!text) throw new Error('빈 응답');
  return text;
}

// JSON 출력 강제: assistant 응답을 '{'로 미리 시작시켜 형식 준수율을 높임 (Anthropic/프록시)
function withPrefill(msgs,opts){
  return opts.json?[...msgs,{role:'assistant',content:'{'}]:msgs;
}
function restorePrefill(text,opts){
  if(!opts.json) return text;
  const t=text.trimStart();
  return t.startsWith('{')?t:'{'+text;
}

async function callProxy(sys,msgs,opts={}){
  const headers={'Content-Type':'application/json'};
  if(S.proxyCode) headers['X-Access-Code']=S.proxyCode;
  const res=await safeFetch(S.proxyUrl,{
    method:'POST', headers,
    body:JSON.stringify({system:sys,messages:withPrefill(msgs,opts),max_tokens:500})
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  return restorePrefill(parseAnthropicShape(await res.json()),opts);
}

async function callAnthropic(sys,msgs,opts={}){
  const res=await safeFetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key':S.keyAnthropic,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:500,system:sys,messages:withPrefill(msgs,opts)})
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  return restorePrefill(parseAnthropicShape(await res.json()),opts);
}

async function callGemini(sys,msgs,opts={}){
  const contents=msgs.map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.content}]}));
  const gc={maxOutputTokens:500};
  if(opts.json) gc.responseMimeType='application/json';   // Gemini 네이티브 JSON 모드
  const res=await safeFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':S.keyGemini},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:sys}]},
      contents,
      generationConfig:gc
    })
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  const j=await res.json();
  const text=j.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error('빈 응답');
  return text;
}

// ── 구조화 응답 파서 ─────────────────────────────────────────────────────────
// 응답 어디에 있든 첫 번째 완결된 JSON 객체를 추출 (코드펜스·잡음에 안전)
function extractJson(raw){
  let t=String(raw||'').trim();
  t=t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
  try{return JSON.parse(t);}catch(_){}
  const i=t.indexOf('{');
  if(i<0) return null;
  let depth=0,inStr=false,escp=false;
  for(let j=i;j<t.length;j++){
    const ch=t[j];
    if(inStr){
      if(escp) escp=false;
      else if(ch==='\\') escp=true;
      else if(ch==='"') inStr=false;
    }else{
      if(ch==='"') inStr=true;
      else if(ch==='{') depth++;
      else if(ch==='}'){
        depth--;
        if(depth===0){
          try{return JSON.parse(t.slice(i,j+1));}catch(_){return null;}
        }
      }
    }
  }
  return null;
}

// {reply, score:{...}, reason, ending} 형식 검증 + 안전 클램프.
// 형식 붕괴 시 ok:false → 원문을 대사로 쓰고 점수는 키워드 폴백.
function parseAIJson(raw){
  const j=extractJson(raw);
  if(j&&typeof j.reply==='string'&&j.reply.trim()){
    const s=j.score||{};
    const n=v=>typeof v==='number'&&isFinite(v)?v:0;
    return {
      ok:true,
      reply:j.reply.trim(),
      delta:{
        d:Math.max(-20,Math.min(0,n(s.disengagement))),
        r:Math.max(0,Math.min(20,n(s.readiness))),
        c:Math.max(0,Math.min(20,n(s.consensus)))
      },
      reason:typeof j.reason==='string'?j.reason.trim():'',
      ending:String(j.ending==null?'none':j.ending).trim()
    };
  }
  const cleaned=String(raw||'').replace(/```(?:json)?/gi,'').replace(/<!--[\s\S]*?-->/g,'').trim();
  return {ok:false, reply:cleaned, delta:{d:0,r:0,c:0}, reason:'', ending:'none'};
}

// ── PROMPTS ────────────────────────────────────────────────────────────────
function getToneInstruction(){
  const st=stageOf(S.scores.d);
  const tones={
    A:{
      '완전 공격':'상대를 즉시 "악"/"위선자"로 규정. 논거 무시하고 도덕적 우월감으로 압도. 반박 자체를 죄악시',
      '당황 조짐':'여전히 공격적이나 상대 논거를 잠깐 언급 후 "그래도 우리가 옳다"로 마무리. 약간의 방어 조짐',
      '방어벽 흔들림':'"맥락이 다르다"며 예외 논리를 꺼냄. 도덕적 확신이 흔들리나 인정 안 하고 더 격해짐',
      '논리 혼란':'자기 주장 내에서 모순 발생. "그건 경우가 다르다"를 반복하며 일관성 붕괴 시작',
      '내적 모순 직면':'도덕 프레임 자체를 유지 못함. 상대 기준을 반박하지 못하고 말이 짧아지거나 침묵 후 인정'
    },
    B:{
      '완전 공격':'"아군이냐 적군이냐"로 즉시 몰아붙임. 중간 입장 자체를 배신/회피로 규정',
      '당황 조짐':'이분법 유지하되 상대가 프레임을 거부하자 새 프레임 제시. 약간 당황한 기색',
      '방어벽 흔들림':'프레임 교체 빈도 높아짐. "그건 다른 문제"라며 화제 돌리기 시도',
      '논리 혼란':'이분법이 계속 거부당하자 논리 대신 감정적 압박으로 전환. 일관성 없음',
      '내적 모순 직면':'더 이상 새 프레임을 못 만들어냄. 마지못해 한 발 물러서는 태도'
    },
    C:{
      '완전 공격':'모든 질문을 "우리를 향한 차별/공격"으로 해석. 피해 서사를 즉각 꺼내며 감정 폭주',
      '당황 조짐':'피해 서사 유지하되 상대 질문 일부는 마지못해 언급. "그래도 우리가 더 당했다"로 마무리',
      '방어벽 흔들림':'피해 주장의 근거가 흔들리자 더 오래된 피해 사례로 후퇴. 방어적 과거 회귀',
      '논리 혼란':'"항상 당해왔다"는 서사가 반박당하자 개인 감정으로 전환. 논리보다 억울함 호소',
      '내적 모순 직면':'피해 프레임이 무너지자 격하게 폭주하다 힘이 빠짐. 지친 수용의 기색'
    }
  };
  return `현재 이탈 수치: ${S.scores.d}% → "${st.label}" 단계\n지금 이 단계 행동 지침: ${tones[S.persona][st.label]}`;
}

function buildSysPrompt(det,tier){
  const pp=P[S.persona];
  const detInfo = tier==='FULL'
    ? `이번 학생 발화에서 [${DETS[det].label}]이(가) 로컬 판정기에 의해 감지되어 점수가 이미 반영되었습니다. 당신은 크게 흔들리는 반응을 보이세요.`
    : tier==='PARTIAL'
    ? `이번 학생 발화에서 [상호 존중·경청]이 감지되어 부분 점수가 반영되었습니다. 다소 누그러진 반응을 보이되, 아직 완전히 물러서지는 마세요.`
    : `이번 학생 발화에서 로컬 판정기는 숙의 문법을 감지하지 못했습니다. 그러나 당신이 보기에 학생이 아래 점수 규칙에 해당하는 발화를 했다면 마커에 정직하게 반영하세요.`;
  return `⚠️ 최우선 규칙: 응답 전체는 아래 "응답 형식"의 JSON 객체 하나여야 합니다. JSON 밖에 어떤 텍스트도 출력하지 마세요.

당신은 고등학교 윤리/미디어 수업 '디지털 공론장 토론 시뮬레이터'에서 특정 페르소나 역할을 맡고 있습니다.

=== 현재 토론 맥락 ===
주제: ${S.topic}
당신 입장: ${S.aiPos} | 학생 입장: ${S.studentPos}
학생들이 만든 공론장 가이드라인: ${S.guidelines}

=== 페르소나 ===
${pp.skin}

=== 내부 변수 (비공개 교육 로직) ===
- 도덕적 이탈 수치 (disengagement): ${S.scores.d}%
- 대화 준비 기반 (readiness): ${S.scores.r}%
- 합의 가능 역량 (consensus): ${S.scores.c}% → 100%가 되면 엔딩 1

=== 이번 턴 로컬 판정 결과 ===
${detInfo}

=== 점수 규칙 ===
[숙의 문법 실천]: 학생이 가이드라인 원칙을 실천했을 때. 특히:
  - 당신의 정당화 기제의 논리적 모순을 절차적으로 짚어낼 때
  - 양측이 수용 가능한 공존 규칙을 제시할 때
   → disengagement:-20, readiness:+20, consensus:+20
[미실천]: 단순 반박, 감정적 대응, 진영 논리, 일방적 설득 → 모두 0
[거리두기 선언]: 대화 중단·물러서겠다는 취지 → "ending":"2"

=== 현재 톤 지침 ===
${getToneInstruction()}

=== 엔딩 1 도달 시 (합의 역량 100%) ===
reply를 "제 신념은 여전히 다르지만, 당신이 제시한 [공존 규칙 요약]은 이 공론장에서 함께 지킬 수 있는 최소 기준으로 수용합니다. 제 논리의 모순도 인정합니다." 취지로 작성하고 "ending":"1"로 설정하세요.

=== 응답 형식 (필수 — 이 JSON 객체 하나만 출력) ===
{
  "reply": "페르소나의 대사. 한국어 200자 이내, 완성된 문장으로 끝낼 것",
  "score": {"disengagement": 0, "readiness": 0, "consensus": 0},
  "reason": "점수 판정 이유 한 문장 (학생 화면에 표시되므로 페르소나 말투가 아닌 중립적·교육적 문장으로)",
  "ending": "none"
}
- score는 위 점수 규칙대로만 부여 (실천 시 -20/+20/+20, 미실천 시 전부 0)
- 합의 역량이 이번 턴에 100%에 도달하면 "ending":"1", 거리두기 선언 감지 시 "ending":"2", 그 외 "none"
- reason 예시: "상대 논리의 모순을 절차적으로 짚어내 보편화 원리를 실천했습니다" / "일방적 반박에 머물러 숙의 문법이 감지되지 않았습니다"`;
}

function buildSOSPrompt(){
  const pp=P[S.persona];
  const recent=S.history.slice(-6).map(m=>
    `[${m.role==='user'?'학생':'상대방'}]: ${m.content.replace(/<!--[\s\S]*?-->/gi,'').trim()}`
  ).join('\n\n');
  return `당신은 '디지털 공론장 토론 시뮬레이터'의 시스템 중재자입니다. 학생에게 짧은 힌트 하나만 제공하세요.

현재 상황:
- 주제: ${S.topic}
- 상대 페르소나: ${pp.full}
- 학생 가이드라인: ${S.guidelines}

최근 대화:
${recent}

다음 형식으로 정확히 1~2문장만 응답하세요:
"상대가 지키지 않는 공론장 가이드라인은 [해당 원칙 내용]입니다. [그 원칙을 활용한 구체적 응답 제안 한 문장]."

(JSON이 아닌 일반 문장으로만 답하세요)`;
}

// ── 연구 기록 & 내보내기 ────────────────────────────────────────────────────
function pushRow(speaker,msg,r){
  S.rows.push({
    t:new Date().toISOString(), round:S.round, persona:S.persona||'', turn:S.turns, speaker,
    msg, det:r.det||'', tier:r.tier||'', reason:r.reason||'',
    dd:r.delta?r.delta.d:'', dr:r.delta?r.delta.r:'', dc:r.delta?r.delta.c:'',
    d:S.scores.d, r2:S.scores.r, c:S.scores.c
  });
}

// 라운드 종료 기록 (엔딩 도달 시 1회)
function recordRound(endingNo){
  S.roundHistory.push({
    round:S.round, persona:S.persona, personaName:P[S.persona].name,
    turns:S.turns, ending:endingNo, sos:3-S.sosLeft,
    d:S.scores.d, r:S.scores.r, c:S.scores.c,
    start:S.startTime?S.startTime.toISOString():'', end:new Date().toISOString()
  });
}

function endingLabel(no){ return no===1?'엔딩 1 (숙의 타결 성공)':no===2?'엔딩 2 (공론장 위생 격리)':'진행 중'; }

function roundSummaryLines(){
  const lines=S.roundHistory.map(rh=>
    `라운드 ${rh.round} — ${P[rh.persona].full}: ${rh.turns}턴 · ${endingLabel(rh.ending)} · SOS ${rh.sos}회 · 최종(이탈 ${rh.d}%/준비 ${rh.r}%/합의 ${rh.c}%)`
  );
  // 진행 중인 라운드가 있으면 함께 표시
  if(!S.endedWith&&S.persona&&S.turns>0&&S.round>S.roundHistory.length)
    lines.push(`라운드 ${S.round} — ${P[S.persona].full}: ${S.turns}턴 · 진행 중 · 현재(이탈 ${S.scores.d}%/준비 ${S.scores.r}%/합의 ${S.scores.c}%)`);
  return lines;
}

function summaryText(){
  const clearedList=['A','B','C'].filter(x=>S.cleared[x]).map(x=>P[x].name).join(', ')||'없음';
  return [
    '═══════════════════════════════════════',
    ' 디지털 공론장 토론 시뮬레이터 — 활동 기록',
    '═══════════════════════════════════════',
    `학생: ${S.studentName}`,
    `주제: ${S.topic}`,
    `학생 입장: ${S.studentPos} / 상대 입장: ${S.aiPos}`,
    `모드: ${MODE_LABEL[S.mode]||S.mode}`,
    `가이드라인: ${S.guidelines}`,
    `저장 시각: ${new Date().toLocaleString('ko-KR')}`,
    `클리어한 페르소나: ${clearedList} (${['A','B','C'].filter(x=>S.cleared[x]).length}/3)`,
    '',
    '── 라운드 요약 ──',
    ...roundSummaryLines(),
    '═══════════════════════════════════════',''
  ].join('\n');
}

function buildTxt(){
  const parts=[];
  let curRound=null;
  for(const row of S.rows){
    if(row.round!==curRound){
      curRound=row.round;
      parts.push(`\n━━━━━ 라운드 ${row.round} — ${row.persona?P[row.persona].full:''} ━━━━━\n`);
    }
    let l=`[${row.speaker}] ${row.msg}`;
    if(row.det&&row.det!=='NONE') l+=`\n   ↳ 판정: ${DETS[row.det]?DETS[row.det].label:row.det} (이탈 ${row.dd||0} / 준비 +${row.dr||0} / 합의 +${row.dc||0}) → 현재 이탈 ${row.d}% 준비 ${row.r2}% 합의 ${row.c}%`;
    if(row.reason) l+=`\n   ↳ AI 판정 사유: ${row.reason}`;
    parts.push(l);
  }
  return summaryText()+parts.join('\n\n')+'\n';
}

function csvCell(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; }
function buildCsv(){
  const head=['시각','라운드','페르소나','턴','발화자','메시지','판정','등급','AI판정사유','Δ이탈','Δ준비','Δ합의','이탈%','준비%','합의%'];
  const rows=S.rows.map(r=>[r.t,r.round,r.persona?P[r.persona].name:'',r.turn,r.speaker,r.msg,r.det,r.tier,r.reason,r.dd,r.dr,r.dc,r.d,r.r2,r.c]);
  const roundHead=['라운드','페르소나','턴수','엔딩','SOS사용','최종이탈','최종준비','최종합의','시작','종료'];
  const roundRows=S.roundHistory.map(rh=>[rh.round,rh.personaName,rh.turns,rh.ending===1?'엔딩1':'엔딩2',rh.sos,rh.d,rh.r,rh.c,rh.start,rh.end]);
  const meta=[
    ['학생',S.studentName],['주제',S.topic],['학생입장',S.studentPos],['모드',S.mode],
    ['클리어수',['A','B','C'].filter(x=>S.cleared[x]).length],
    ['총라운드',S.roundHistory.length+(S.endedWith||!S.persona||S.turns===0?0:1)]
  ];
  return '﻿'
    +meta.map(m=>m.map(csvCell).join(',')).join('\n')
    +'\n\n'+roundHead.map(csvCell).join(',')+'\n'
    +roundRows.map(r=>r.map(csvCell).join(',')).join('\n')
    +'\n\n'+head.map(csvCell).join(',')+'\n'
    +rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function download(name,content,mime){
  const blob=new Blob([content],{type:(mime||'text/plain')+';charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}

function fileStamp(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function safeName(){ return (S.studentName||'학생').replace(/[\\/:*?"<>|]/g,'_'); }
function saveTxt(){ download(`공론장기록_${safeName()}_${fileStamp()}.txt`, buildTxt()); }
function saveCsv(){ download(`공론장데이터_${safeName()}_${fileStamp()}.csv`, buildCsv(), 'text/csv'); }

// ── UI HELPERS ─────────────────────────────────────────────────────────────
function addMsg(type,text){
  const chat=document.getElementById('chat');
  const pp=S.persona?P[S.persona]:null;
  const el=document.createElement('div');
  if(type==='u'){
    el.className='msg u';
    el.innerHTML=`<div class="sndr">나 (${S.studentPos})</div><div class="bub">${esc(text)}</div>`;
  }else if(type==='a'){
    el.className=`msg a p${S.persona}`;
    el.innerHTML=`<div class="sndr" style="color:${pp.color}">${pp.name}</div><div class="bub">${esc(text)}</div>`;
  }else if(type==='sys'){
    el.className='msg sys';
    el.innerHTML=`<div class="bub">${esc(text)}</div>`;
  }else if(type==='sos'){
    el.className='msg sos';
    el.innerHTML=`<div class="sndr" style="color:var(--green)">🆘 시스템 중재자</div><div class="bub">${esc(text)}</div>`;
  }
  chat.appendChild(el);
  chat.scrollTop=chat.scrollHeight;
}

function addBadge(text,cls){
  const chat=document.getElementById('chat');
  const n=document.createElement('div');
  n.className='notif '+(cls||'neu');
  n.textContent=text;
  chat.appendChild(n);
  chat.scrollTop=chat.scrollHeight;
}

let loadEl=null;
function setLoading(on){
  const send=document.getElementById('sendBtn');
  const cin=document.getElementById('cin');
  send.disabled=on; cin.disabled=on;
  const chat=document.getElementById('chat');
  if(on&&!loadEl){
    loadEl=document.createElement('div');
    loadEl.className=`msg a p${S.persona} loading-indicator`;
    const pp=P[S.persona];
    loadEl.innerHTML=`<div class="sndr" style="color:${pp?.color||'gray'}">${pp?.name||'...'}</div><div class="bub"><div class="ldot"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div></div>`;
    chat.appendChild(loadEl);
    chat.scrollTop=chat.scrollHeight;
  }else if(!on&&loadEl){
    loadEl.remove(); loadEl=null;
  }
  if(!on&&!S.endedWith) cin.focus();
}

function updateScores(initial){
  document.getElementById('bD').style.width=S.scores.d+'%';
  document.getElementById('bR').style.width=S.scores.r+'%';
  document.getElementById('bC').style.width=S.scores.c+'%';
  document.getElementById('vD').textContent=S.scores.d+'%';
  document.getElementById('vR').textContent=S.scores.r+'%';
  document.getElementById('vC').textContent=S.scores.c+'%';
  updateStageUI(initial);
}

function updateStageUI(initial){
  const idx=stageIndex(S.scores.d);
  const st=STAGES[idx];
  document.getElementById('stEmoji').textContent=st.emoji;
  document.getElementById('stLabel').textContent=st.label;
  const dots=document.getElementById('stDots');
  dots.innerHTML=STAGES.map((_,i)=>`<span class="stdot${i<=idx?' on':''}"></span>`).join('');
  if(!initial&&idx>S.lastStageIdx){
    addBadge(`⚡ 상대 상태 변화: ${STAGES[S.lastStageIdx].label} → ${st.label} — ${st.desc}`,'stage');
  }
  S.lastStageIdx=Math.max(S.lastStageIdx,idx);
}

function updateSOS(){
  document.getElementById('sosH').textContent='❤️'.repeat(S.sosLeft)+'🖤'.repeat(3-S.sosLeft);
  document.getElementById('sosN').textContent=S.sosLeft;
  if(S.sosLeft<=0) document.getElementById('sosBtn').disabled=true;
}

function updateTurn(){
  document.getElementById('turnCt').textContent='턴 '+S.turns;
}

function fillStats(id){
  const n=['A','B','C'].filter(x=>S.cleared[x]).length;
  document.getElementById(id).innerHTML=
    `<b>${esc(S.studentName)}</b> · 주제: ${esc(S.topic)} · 라운드 ${S.round} (${S.persona?P[S.persona].name:''}) · ${S.turns}턴 · SOS ${3-S.sosLeft}회 사용<br>`+
    `최종 수치 — 상대 도덕적 이탈 <b>${S.scores.d}%</b> / 대화 준비 <b>${S.scores.r}%</b> / 합의 역량 <b>${S.scores.c}%</b>`+
    ` · 클리어 <b>${n}/3</b>`;
}

function showEnd1(){
  if(!S.roundRecorded){recordRound(1);S.roundRecorded=true;}
  S.cleared[S.persona]=true;
  if(S.cleared.A&&S.cleared.B&&S.cleared.C){showEnd3();return;}   // 3연전 완주!
  document.getElementById('debatePanel').style.display='none';
  const ep=document.getElementById('endingPanel'); ep.style.display='flex';
  document.getElementById('end1').classList.remove('hidden');
  document.getElementById('e1msg').textContent='상대의 입장을 바꾼 것이 아니라, 양측이 함께 지킬 수 있는 공존 규칙을 절차적으로 도출해냈습니다.\n\n상대방의 정당화 기제의 모순을 어떻게 짚어냈는지, 어떤 공존 규칙을 제시했는지 아래 [대화록 저장]으로 기록을 내려받아 되돌아보세요.\n\n아직 만나지 않은 다른 유형의 유저가 기다리고 있습니다. 같은 가이드라인으로 다른 정당화 기제도 상대할 수 있을까요?';
  fillStats('endStats1');
}

function showEnd2(){
  if(!S.roundRecorded){recordRound(2);S.roundRecorded=true;}   // 이탈은 클리어로 치지 않음
  document.getElementById('debatePanel').style.display='none';
  const ep=document.getElementById('endingPanel'); ep.style.display='flex';
  document.getElementById('end2').classList.remove('hidden');
  fillStats('endStats2');
}

function showEnd3(){
  document.getElementById('debatePanel').style.display='none';
  const ep=document.getElementById('endingPanel'); ep.style.display='flex';
  document.getElementById('end3').classList.remove('hidden');
  document.getElementById('endStats3').innerHTML=
    `<b>${esc(S.studentName)}</b> · 주제: ${esc(S.topic)}<br><br>`+
    S.roundHistory.map(rh=>
      `라운드 ${rh.round} — ${P[rh.persona].full} : <b>${rh.turns}턴</b> · ${rh.ending===1?'🏆 숙의 타결':'🛡️ 공론장 격리'} · SOS ${rh.sos}회`
    ).join('<br>');
}

// ── 페르소나 연속 도전 ───────────────────────────────────────────────────────
// 라운드 상태만 초기화 (주제·입장·가이드라인·누적 기록은 유지)
function resetRound(){
  S.scores={d:100,r:0,c:0}; S.sosLeft=3; S.history=[]; S.turns=0; S.rot={};
  S.lastStageIdx=0; S.endedWith=null; S.roundRecorded=false; S.startTime=null;
  document.getElementById('chat').innerHTML='';
  loadEl=null;
  document.getElementById('sosBtn').disabled=false;
  document.getElementById('sendBtn').disabled=false;
  const cin=document.getElementById('cin'); cin.disabled=false; cin.value='';
  document.getElementById('endingPanel').style.display='none';
  ['end1','end2','end3'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  updateSOS();
}

// 엔딩 화면 → 페르소나 선택 화면으로 (다음 도전 / 다른 페르소나)
function nextPersona(){
  resetRound();
  S.persona=null;
  updateClearUI();
  document.getElementById('debatePanel').style.display='none';
  document.getElementById('setupWrap').style.display='flex';
  setStep(4);
}

// 엔딩 2에서 같은 페르소나로 즉시 재도전
function retrySame(){
  resetRound();
  startDebate();
}

// 모바일 등에서 헤더가 여러 줄로 감겨도 채팅 영역이 화면에 딱 맞도록 동적 계산
function fitDebateHeight(){
  const dp=document.getElementById('debatePanel');
  if(!dp||dp.style.display==='none') return;
  const h=document.querySelector('header');
  dp.style.height=`calc(100vh - ${h?h.offsetHeight:52}px)`;
}

function clamp(v){return Math.max(0,Math.min(100,v));}

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// ── INIT (브라우저에서만 실행) ───────────────────────────────────────────────
if(typeof document!=='undefined'&&document.getElementById('modeSel')){
  (function(){
    S.keyAnthropic=localStorage.getItem('ak_anthropic')||localStorage.getItem('ak')||'';
    S.keyGemini=localStorage.getItem('ak_gemini')||'';
    S.proxyUrl=localStorage.getItem('sim_proxy_url')||'';
    S.proxyCode=localStorage.getItem('sim_proxy_code')||'';
    S.mode=localStorage.getItem('sim_mode')||'offline';
    if(!MODE_LABEL[S.mode]) S.mode='offline';
    document.getElementById('modeSel').value=S.mode;
    renderConn();
  })();
}
