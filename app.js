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
  // 합의(양방향) 관문: 규칙 기반 지적은 상대를 벼랑 끝(합의 GATE%)까지만,
  // 최종 타결은 학생이 직접 작성하는 합의문으로만 이뤄진다.
  consensusUnlocked:false, consensusStatement:'', consensusSubmitting:false, busy:false,
  // 페르소나 연속 도전
  cleared:{A:false,B:false,C:false},
  round:1, roundHistory:[], roundRecorded:false,
  rows:[]   // 연구 기록(전체 라운드 누적): {t, round, persona, turn, speaker, msg, det, ...}
};

// 규칙 기반 지적만으로 도달 가능한 합의 역량 상한 (나머지 20%는 합의문으로만)
const CONSENSUS_GATE = 80;

const MODE_LABEL = {offline:'🔌 오프라인', proxy:'🏫 교사 프록시', anthropic:'🔑 Claude 직접', gemini:'🔑 Gemini 직접'};

// localStorage가 차단된 환경(학교 PC 보안 정책·시크릿 모드)에서도 앱이 죽지 않도록 안전 래퍼
function lsGet(k){ try{return localStorage.getItem(k);}catch(_){return null;} }
function lsSet(k,v){ try{localStorage.setItem(k,v);}catch(_){/* 저장 불가 환경 — 세션 내 메모리로만 동작 */} }

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
// 핵심 설계: 이 시뮬레이션의 만점 실천은 "규칙 기반 토론"이다.
//  - 학생이 가이드라인(약속한 규칙)을 근거로 상대의 위반을 지적하고 시정을 요구하거나,
//  - 원리·규칙을 명시하며 발화할 때 → 완전한 실천 (FULL)
//  - 규칙 근거 없는 좋은 말(다양성·공감 등)만으로는 부분 인정 (PARTIAL, 합의 60% 상한)
const DETS = {
  WITHDRAWAL:   {label:'🚪 거리두기 선언 감지', cls:'warn'},
  RULE_ENFORCE: {label:'📏 규칙 기반 위반 지적·시정 요구 감지 (핵심 실천!)', cls:'pos'},
  U_PRINCIPLE:  {label:'🔵 보편화 원리(U) 실천 감지', cls:'pos'},
  D_PRINCIPLE:  {label:'🟣 담화 원리(D) 실천 감지', cls:'pos'},
  COMMON_GROUND:{label:'🟢 공존 규칙 제안 감지', cls:'pos'},
  EMPATHY:      {label:'🤝 상호 존중·경청 감지 (부분 인정)', cls:'pos'},
  MUTUAL_CONSENSUS:{label:'🤝 합의문 — 양방향 합의 도달', cls:'pos'},
  NONE:         {label:'⚫ 숙의 문법 미감지 — 가이드라인의 규칙을 근거로 말해 보세요', cls:'neu'}
};

// 규칙·원리를 명시적으로 언급하는가 (근거 제시 여부)
const RULE_REF=/규칙|약속(한|했|대로)|가이드라인|원칙|원리|합의(한|했)|우리가 정한|함께 정한|정했던|기로 (했|한)/;
// 위반을 짚는 표현
const VIOLATION=/위반|어기고|어겼|어기시|어긋|지키지 않|지켜지지 않|안 지키|벗어나|깨고 있|깨뜨리|깨트리|무시하|반하는|반합니다|허점/;
// 준수·시정을 요구하는 표현
const DEMAND=/에 따라|에 따르|따라 주|지켜 ?주|준수|돌아(와|오|가)|규칙대로|원칙대로|기반으로 (답|말|대화)|근거해서/;
// 상대의 조작 전술을 이름 붙여 식별하는 표현 (미디어 리터러시 실천)
const TACTIC=/악마화|마녀사냥|낙인|이분법|양자택일|편 가르|프레임(에 가두|을 씌|으로 몰)|인신공격|매도하|일반화하|감정에 호소|감정적으로 몰|우월감|침묵을 강요/;

function isGrounded(msg){ return RULE_REF.test(msg); }

function detectDeliberation(msg){
  const m = msg;
  if(/대화.*중단|더 이상.*대화.*않|더 이상.*논의.*않|물러서겠|물러나겠|소통.*불가|그만.*두겠|중단하겠|대화.*의미.*없|의사소통.*규칙.*지켜지지|대화.*포기|떠나겠|이탈.*선언/.test(m))
    return 'WITHDRAWAL';
  if(RULE_REF.test(m)&&(VIOLATION.test(m)||DEMAND.test(m)||TACTIC.test(m)))
    return 'RULE_ENFORCE';
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

// 발화 하나에 대한 종합 판정: 무엇이 감지됐고(det) 어떤 등급인가(tier)
function judgeMessage(msg){
  const det=detectDeliberation(msg);
  let tier;
  if(det==='WITHDRAWAL'||det==='NONE') tier='NONE';
  else if(det==='RULE_ENFORCE') tier='FULL';
  else if(det==='EMPATHY') tier='PARTIAL';
  else tier=isGrounded(msg)?'FULL':'PARTIAL';   // U/D/공존규칙: 규칙·원리 명시 시에만 만점
  return {det,tier};
}

// 합의 역량 상승 규칙:
//  - FULL(규칙 기반 실천): 합의 역량을 GATE(80%)까지만 끌어올림 → 상대를 벼랑 끝으로
//  - PARTIAL(근거 없는 표현·공감): 60%까지만 상승
//  - 마지막 GATE→100%는 오직 학생의 합의문 작성으로만 (submitConsensus)
function computeDelta(tier){
  if(tier==='FULL'){
    const dl={...DELTAS.FULL};
    dl.c=Math.max(0,Math.min(dl.c, CONSENSUS_GATE-S.scores.c));
    return dl;
  }
  if(tier==='PARTIAL'){
    const dl={...DELTAS.PARTIAL};
    dl.c=Math.max(0,Math.min(dl.c, 60-S.scores.c));
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
        '잠깐, 그 질문은... 아니, 아무리 그래도 우리가 옳다는 사실은 변하지 않습니다. 변할 수 없어요.',
        '규칙 위반이라고요? 흥. 그 규칙에 우리도 동의했다는 건... 인정합니다. 하지만 정의 앞에서는 규칙도 사소한 겁니다!'
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
        '당신은 계속 프레임 밖에서 말하는군요. 짜증나지만, 솔직히 그 위치가 조금 부럽기도 합니다.',
        '제가 약속한 토론 규칙을 어기고 있다는 지적... 뼈아프군요. 좋습니다, 이번엔 편 가르기 없이 당신 논거에 답해 보죠.'
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
        '감정을 인정하면서 규칙을 말하는 사람은 드물어요. 경계는 안 풀리지만, 계속 말해보세요.',
        '규칙이라... 그래요, 그 규칙엔 우리도 동의했었죠. 감정이 앞서서 잊고 있었다는 건... 인정할게요.'
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
// ※ 엔딩1(숙의 타결)은 더 이상 점수만으로 발생하지 않는다 → 합의문(submitConsensus)으로만.
function offlineTurn(msg){
  const {det,tier} = judgeMessage(msg);
  if(det==='WITHDRAWAL')
    return {det, tier:'NONE', delta:{d:0,r:0,c:0}, ending:2, reply:fillTopic(OFF[S.persona].WITHDRAWAL)};
  const delta = computeDelta(tier);
  applyDeltaPure(delta);
  const reply = pickScripted(tier==='NONE'?'NO_CHANGE':'PROGRESS');
  return {det, tier, delta, ending:null, reply};
}

// ── SOS (오프라인 범용 대본 — API 모드에선 맥락형 힌트 시도 후 실패 시 이걸 사용)
const SOSG = {
  A:`🔍 [상대 전술 분석]
'진영이'는 도덕적 정당화 기제를 사용합니다. 자기 진영의 공격을 "정의로운 실천"으로 신성시하고, 반대나 중립을 "악의 방조"로 매도해 대화를 차단합니다.

💡 [추천 숙의 전략 — 규칙 기반 위반 지적]
우리가 약속한 가이드라인을 근거로, 상대의 '악마화' 전술이 어떤 규칙을 위반하는지 짚고 시정을 요구하세요.

📝 [예시 문장]
• "우리는 상대를 이기는 것이 아니라 상호 이해를 목표로 대화하기로 약속했습니다. 지금 저를 '위선자'로 규정하는 것은 그 규칙을 위반하는 인신공격입니다. 규칙에 따라 제 논거에 답해 주세요."
• "보편화 원리에 따르면, 정의를 위해 상대를 악마화해도 된다는 당신의 기준은 당신 진영에도 똑같이 적용되어야 합니다. 그래도 옳다고 할 수 있습니까?"

⚠️ [주의] "당신이 틀렸다"는 직접 공격은 역효과입니다. 규칙을 인용해 절차적으로 지적하세요.`,
  B:`🔍 [상대 전술 분석]
'프레임'은 양자택일 강요 기제를 사용합니다. "아군이냐 적군이냐"라는 이분법으로 복합적 논의를 "말장난"으로 매도하고 선택을 강요합니다.

💡 [추천 숙의 전략 — 규칙 기반 위반 지적]
우리가 약속한 가이드라인을 근거로, '양자택일 강요'가 어떤 규칙을 위반하는지 짚고 시정을 요구하세요.

📝 [예시 문장]
• "우리는 대화에 영향받는 모든 사람의 평등한 참여를 보장하기로 약속했습니다(담화 원리). 아군/적군 양자택일을 강요하는 것은 그 규칙을 위반하는 편 가르기입니다. 이분법 밖의 제 입장에도 규칙대로 답해 주세요."
• "지금 '중립은 회피'라는 프레임으로 몰아가는 것은 우리가 합의한 열린 대화 원칙에 어긋납니다. 규칙에 따라 논거로 반박해 주세요."

⚠️ [주의] "저는 중립입니다"라고만 하면 역효과입니다. 규칙 위반을 구체적으로 지적하며 복합적 사고를 주장하세요.`,
  C:`🔍 [상대 전술 분석]
'희생양'은 피해의식 기반 감정 폭주 기제를 사용합니다. 이성적 논의를 "차가운 논리"로 비판하고 감정적 공감만을 정당성의 근거로 삼습니다.

💡 [추천 숙의 전략 — 공감 먼저, 그 다음 규칙 기반 지적]
먼저 상대의 감정과 고통을 인정한 뒤, 우리가 약속한 가이드라인을 근거로 '질문을 공격으로 규정하는' 위반을 부드럽게 짚으세요.

📝 [예시 문장]
• "그동안 겪어온 아픔이 실재한다는 것, 저도 인정합니다. 다만 우리는 서로의 질문을 공격이 아닌 이해의 시도로 받기로 약속했습니다. 제 질문을 음모로 규정하는 것은 그 규칙에 어긋납니다. 규칙에 따라 답해 주시겠어요?"
• "저도 그 고통을 가볍게 보지 않습니다. 그래서 우리가 합의한 상호 이해의 원칙 위에서, 양쪽 모두 지킬 수 있는 기준을 함께 확인하고 싶습니다."

⚠️ [주의] "감정적으로 반응하지 마세요"라는 말은 절대 금물입니다. 감정을 인정하면서 규칙을 인용하세요.`
};

// ── 연결(모드/키) 관리 ──────────────────────────────────────────────────────
function onModeChange(){
  S.mode = document.getElementById('modeSel').value;
  lsSet('sim_mode', S.mode);
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
    lsSet('sim_proxy_url',u);
    lsSet('sim_proxy_code',c);
    renderConn();
  }else{
    const ki=document.getElementById('keyIn');
    if(ki.disabled){ ki.disabled=false; ki.value=''; ki.focus(); document.getElementById('connBtn').textContent='저장'; return; }
    const v=ki.value.trim();
    if(!v||v==='저장됨 ✓'){alert('API 키를 입력해 주세요.');return;}
    if(S.mode==='gemini'){ S.keyGemini=v; lsSet('ak_gemini',v); }
    else{ S.keyAnthropic=v; lsSet('ak_anthropic',v); }
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
  S.consensusUnlocked=false; S.consensusStatement=''; S.consensusSubmitting=false; S.busy=false; updateConsensusBtn();
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
  const {det,tier}=judgeMessage(msg);
  // 이탈 선언은 API 호출 없이 로컬에서 즉시 처리 (비용·오판 방지)
  if(det==='WITHDRAWAL'){
    const r={det,tier:'NONE',delta:{d:0,r:0,c:0},ending:2,reply:fillTopic(OFF[S.persona].WITHDRAWAL)};
    pushRow('학생',msg,r); showDetection(r); await sleep(500); finishTurn(r); return;
  }
  const localDelta=computeDelta(tier);
  try{
    const raw=await callAIWithRetry(buildSysPrompt(det,tier), sanitizeMsgs(S.history.slice(-12)), 3, {json:true});
    if(S.endedWith) return;   // 대기 중 라운드가 종료됐으면(이탈 선언 등) 늦은 응답 전체 폐기
    const p=parseAIJson(raw);
    let final, ending=null, reason='';
    if(p.ok){
      final=capConsensusToGate(mergeDeltas(localDelta,p.delta));   // 합의 역량은 GATE까지만
      reason=p.reason;
      applyDeltaPure(final);
      if(p.ending==='2') ending=2;   // 엔딩1은 점수/AI가 아니라 합의문으로만 → 여기서 촉발하지 않음
    }else{
      // 형식 붕괴 → 키워드 채점 폴백 (본문은 그대로 사용)
      final=localDelta;
      applyDeltaPure(final);
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
    if(S.endedWith) return;   // 종료 후 도착한 오류/응답은 폐기
    // API 실패 → 오프라인 엔진으로 자동 대체 (수업 흐름 유지)
    addMsg('sys',`⚠️ AI 연결 실패 (${e.message})\n이번 응답은 오프라인 엔진으로 대신합니다.`);
    const r=offlineTurn(msg);
    pushRow('학생',msg,r); showDetection(r);
    await sleep(400); finishTurn(r);
  }
}

// 합의 역량 상승분을 GATE 상한 안으로 제한 (AI 판정이 과도하게 올리는 것 방지)
function capConsensusToGate(delta){
  delta.c=Math.max(0,Math.min(delta.c, CONSENSUS_GATE-S.scores.c));
  return delta;
}

function finishTurn(r){
  // 응답 대기 중 학생이 이탈 선언 등으로 라운드를 이미 끝낸 경우,
  // 뒤늦게 도착한 응답이 종료된 라운드의 화면·기록을 오염시키지 않도록 폐기
  if(S.endedWith) return;
  updateScores();
  S.history.push({role:'assistant',content:r.reply});
  addMsg('a',r.reply);
  pushRow('상대', r.reply, {});
  if(r.ending===2){ S.endedWith=2; setTimeout(showEnd2,700); return; }
  if(r.ending===1){ S.endedWith=1; setTimeout(showEnd1,900); return; }
  maybeUnlockConsensus();
}

// 상대가 벼랑 끝(합의 역량 GATE 도달)에 이르면 '합의문 작성' 관문을 연다
function maybeUnlockConsensus(){
  if(S.consensusUnlocked||S.endedWith) return;
  if(S.scores.c>=CONSENSUS_GATE){
    S.consensusUnlocked=true;
    updateConsensusBtn();
    addMsg('sys','🤝 상대의 방어가 무너졌습니다. 하지만 이건 승리가 아니라 대화의 시작입니다.\n이제 일방적으로 상대를 이기는 대신, 서로가 동의할 수 있는 지점을 찾아 \'합의\'로 마무리할 차례입니다.\n아래 [🤝 합의문 작성] 버튼을 눌러, 상대의 말 중 내가 동의하는 지점과 우리의 공통 기반을 직접 정리해 보세요.');
    addBadge('✨ 합의문 작성 관문이 열렸습니다 — 진짜 합의를 만들어 보세요!','stage');
  }
}

function showDetection(r){
  const D=DETS[r.det]||DETS.NONE;
  let txt=D.label;
  if(r.tier==='FULL') txt+=`  →  이탈 ${r.delta.d}, 준비 +${r.delta.r}, 합의 +${r.delta.c}`;
  else if(r.tier==='PARTIAL'){
    txt+=`  →  이탈 ${r.delta.d}, 준비 +${r.delta.r}, 합의 +${r.delta.c}`;
    if(r.det!=='EMPATHY') txt+='  (부분 인정 — 우리 가이드라인의 어떤 규칙·원리인지 명시하면 완전한 실천이 됩니다!)';
    else if(r.delta.c===0) txt+='  (공감·일반 표현만으로는 합의 60%까지 — 이제 규칙을 근거로 지적해 보세요!)';
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
  if(S.busy||S.endedWith) return;   // 응답 대기 중·종료 후 중복 실행 방지
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
  if(S.endedWith){ setLoading(false); return; }   // SOS 대기 중 라운드 종료 시 폐기
  addMsg('sos',txt);
  pushRow('중재자',txt,{});
  setLoading(false);
}

// ── 합의문(양방향 합의) ──────────────────────────────────────────────────────
function updateConsensusBtn(){
  const b=document.getElementById('consensusBtn');
  if(b) b.classList.toggle('hidden',!S.consensusUnlocked||!!S.endedWith);
}

function openConsensus(){
  if(S.busy||S.endedWith) return;   // 응답 대기 중·종료 후 열기 방지
  if(!S.consensusUnlocked){
    addMsg('sys','아직 상대의 방어가 충분히 무너지지 않았습니다. 규칙을 근거로 상대의 위반을 지적해 먼저 상대를 흔드세요. (합의 역량 '+CONSENSUS_GATE+'% 도달 시 열립니다)');
    return;
  }
  document.getElementById('consensusModal').style.display='flex';
  const ta=document.getElementById('consensusText');
  ta.value=''; setTimeout(()=>ta.focus(),50);
}
function closeConsensus(){ document.getElementById('consensusModal').style.display='none'; }

async function submitConsensus(){
  if(S.consensusSubmitting||S.endedWith) return;   // 더블클릭 이중 제출 방지
  const ta=document.getElementById('consensusText');
  const text=ta.value.trim();
  if(text.length<15){ alert('합의문을 조금 더 구체적으로 작성해 주세요.\n① 상대의 말 중 내가 동의하는 지점 ② 우리의 공통 기반(교집합) ③ 함께 지킬 공존 규칙을 담아 보세요.'); return; }
  S.consensusSubmitting=true;
  closeConsensus();
  // 학생의 합의문을 발화로 표시 + 연구 기록
  S.consensusStatement=text;
  S.turns++; updateTurn();
  addMsg('u2',text);
  S.history.push({role:'user',content:'[합의문] '+text});
  pushRow('학생(합의문)',text,{det:'MUTUAL_CONSENSUS',tier:'FULL',delta:{d:0,r:0,c:20}});
  // 합의 역량 100% 봉인
  S.scores.c=100; S.scores.d=clamp(S.scores.d); S.scores.r=Math.max(S.scores.r,80);
  updateScores();
  addBadge('🤝 합의문 제출 — 일방적 승리가 아닌 양방향 합의에 도달했습니다!','pos');
  setLoading(true);
  // 상대의 최종 상호수용 응답
  let reply=fillTopic(OFF[S.persona].END);
  if(S.mode!=='offline'){
    try{
      const raw=await callAIWithRetry(buildConsensusReplyPrompt(text), sanitizeMsgs(S.history.slice(-8)), 2, {json:true});
      const p=parseAIJson(raw);
      if(p.ok&&p.reply&&p.reply.length>=2) reply=p.reply;
    }catch(_){/* 실패 시 오프라인 END 대본 사용 */}
  }else{
    await sleep(700);
  }
  S.history.push({role:'assistant',content:reply});
  addMsg('a',reply);
  pushRow('상대',reply,{});
  setLoading(false);
  S.endedWith=1;
  setTimeout(showEnd1,900);
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

// prefill 복원('{' 자동 부착) 때문에 빈 응답이 정상처럼 보이는 것을 방지:
// JSON 구두점을 걷어낸 실질 내용이 있어야 유효한 응답으로 인정
function hasMeaningfulContent(r){
  return !!r && r.replace(/[{}\[\]"'`\s:,]/g,'').length>=3;
}

async function callAIWithRetry(sys,msgs,maxRetries=3,opts={}){
  let lastErr;
  for(let attempt=1;attempt<=maxRetries;attempt++){
    try{
      const result=await callAI(sys,msgs,opts);
      if(hasMeaningfulContent(result)) return result;
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
    body:JSON.stringify({system:sys,messages:withPrefill(msgs,opts),max_tokens:1000})
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
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1000,system:sys,messages:withPrefill(msgs,opts)})
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  return restorePrefill(parseAnthropicShape(await res.json()),opts);
}

async function callGemini(sys,msgs,opts={}){
  const contents=msgs.map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.content}]}));
  // 사고(thinking) 차단 필수: gemini-2.5-flash는 사고 토큰이 maxOutputTokens에서 차감되어
  // 예산을 사고에 다 쓰면 실제 출력이 '{"' 같은 부스러기만 남는 문제가 있음
  const gc={maxOutputTokens:1024, thinkingConfig:{thinkingBudget:0}};
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
  // ── 형식 붕괴 폴백 ──
  // 1) 토큰 한도로 잘린 JSON이라도 "reply" 필드까지 왔다면 대사만 복구
  let cand='';
  const rm=String(raw||'').match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if(rm&&rm[1]){
    cand=rm[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\').trim();
    if(cand&&!/[.!?…。]$/.test(cand)) cand+='…';   // 문장 중간에 잘렸으면 말줄임으로 마무리
  }
  // 2) 복구 실패 시: JSON 부스러기('{', '"reply":' 등)나 초단문은 절대 대사로 내보내지 않음
  //    → 빈 값을 반환해 호출부가 오프라인 대본 응답으로 대체하게 함
  if(!cand){
    const cleaned=String(raw||'').replace(/```(?:json)?/gi,'').replace(/<!--[\s\S]*?-->/g,'').trim();
    const debris=!cleaned||cleaned.length<8||/^[{\[]/.test(cleaned)||/"(reply|score|reason|ending)"\s*:/.test(cleaned);
    cand=debris?'':cleaned;
  }
  return {ok:false, reply:cand, delta:{d:0,r:0,c:0}, reason:'', ending:'none'};
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
    ? `이번 학생 발화는 [${DETS[det].label}] — 좋은 태도이나 규칙·원리를 명시하지 않아 부분 점수만 반영되었습니다. 다소 누그러진 반응을 보이되, 아직 완전히 물러서지는 마세요.`
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

=== 점수 규칙 (핵심: "규칙 기반 토론"만 완전한 실천으로 인정) ===
[완전한 실천 → disengagement:-20, readiness:+20, consensus:+20]
  - 학생이 가이드라인의 규칙·원리를 명시적으로 인용하며, 당신의 위반(악마화·이분법 강요·감정 폭주·인신공격 등)을 짚고 규칙에 따른 답변을 요구할 때 (예: "우리는 ~하기로 약속했는데, 지금 그 규칙을 위반하고 있습니다. 규칙에 따라 답하세요")
  - 규칙·원리를 근거로 당신의 정당화 기제의 논리적 모순을 절차적으로 짚어낼 때
  - 양측이 수용 가능한 공존 규칙을 명시적으로 제시할 때
[부분 인정 → disengagement:-10, readiness:+10, consensus:+10]
  - 어떤 규칙·원리인지 명시하지 않은 좋은 표현(다양성 존중, 공감, 경청 등)
[미실천 → 모두 0]: 단순 반박, 감정적 대응, 진영 논리, 일방적 설득
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
- reason 예시: "약속한 규칙을 인용해 위반을 짚고 시정을 요구했습니다 — 규칙 기반 토론의 완전한 실천입니다" / "좋은 태도지만 어떤 규칙에 근거한 것인지 명시하지 않아 부분 인정입니다" / "일방적 반박에 머물러 숙의 문법이 감지되지 않았습니다"`;
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

// 학생이 제출한 합의문에 대한 페르소나의 최종 상호수용 응답
function buildConsensusReplyPrompt(statement){
  const pp=P[S.persona];
  return `⚠️ 응답 전체는 JSON 객체 하나여야 합니다: {"reply":"...","score":{"disengagement":0,"readiness":0,"consensus":0},"reason":"","ending":"1"}

당신은 '${pp.full}' 페르소나입니다. 주제 "${S.topic}"에서 ${S.aiPos} 입장이었고, 오랜 토론 끝에 방어 논리가 무너진 상태입니다.

학생이 방금 아래 '합의문'을 제출했습니다. 이것은 학생이 당신을 이기려는 게 아니라, 당신의 말 중 동의할 수 있는 지점과 서로의 공통 기반, 함께 지킬 규칙을 정리한 것입니다.

[학생의 합의문]
${statement}

이제 reply에 다음을 담아 200자 이내로 응답하세요:
- 당신의 원래 신념(${S.aiPos})은 여전히 다르다는 점을 인정하면서도,
- 학생이 짚은 공통 기반을 당신도 받아들이고,
- 일방적으로 진 것이 아니라 '함께 지킬 최소한의 규칙'에 합의한다는 상호적 수용의 태도로 마무리하세요.
- 학생의 합의문 내용에 구체적으로 반응하세요.`;
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
    statement:endingNo===1?S.consensusStatement:'',
    start:S.startTime?S.startTime.toISOString():'', end:new Date().toISOString()
  });
}

function endingLabel(no){ return no===1?'엔딩 1 (숙의 타결 성공)':no===2?'엔딩 2 (공론장 위생 격리)':'진행 중'; }

function roundSummaryLines(){
  const lines=S.roundHistory.map(rh=>{
    let l=`라운드 ${rh.round} — ${P[rh.persona].full}: ${rh.turns}턴 · ${endingLabel(rh.ending)} · SOS ${rh.sos}회 · 최종(이탈 ${rh.d}%/준비 ${rh.r}%/합의 ${rh.c}%)`;
    if(rh.statement) l+=`\n    ↳ 합의문: ${rh.statement}`;
    return l;
  });
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
  const roundHead=['라운드','페르소나','턴수','엔딩','SOS사용','최종이탈','최종준비','최종합의','합의문','시작','종료'];
  const roundRows=S.roundHistory.map(rh=>[rh.round,rh.personaName,rh.turns,rh.ending===1?'엔딩1':'엔딩2',rh.sos,rh.d,rh.r,rh.c,rh.statement||'',rh.start,rh.end]);
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
  }else if(type==='u2'){
    el.className='msg u2';
    el.innerHTML=`<div class="sndr" style="color:var(--gold)">🤝 나의 합의문</div><div class="bub">${esc(text)}</div>`;
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
  S.busy=on;   // 응답 대기 중 SOS/합의문/전송의 동시 실행(기록 꼬임) 방지
  const send=document.getElementById('sendBtn');
  const cin=document.getElementById('cin');
  send.disabled=on; cin.disabled=on;
  const sos=document.getElementById('sosBtn');
  if(sos) sos.disabled=on||S.sosLeft<=0;
  const cb=document.getElementById('consensusBtn');
  if(cb) cb.disabled=on;
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
  document.getElementById('e1msg').textContent='상대를 이겨서 굴복시킨 것이 아니라, 서로가 동의할 수 있는 지점과 공통 기반을 찾아 함께 지킬 규칙에 도달했습니다. 이것이 일방적 동의가 아닌 진짜 \'합의\'입니다.\n\n아직 만나지 않은 다른 유형의 유저가 기다리고 있습니다. 같은 가이드라인으로 다른 정당화 기제도 상대할 수 있을까요?';
  const box=document.getElementById('e1statement');
  if(S.consensusStatement){
    box.classList.remove('hidden');
    box.innerHTML=`<div class="stlbl">🤝 내가 작성한 합의문</div>${esc(S.consensusStatement)}`;
  }else box.classList.add('hidden');
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
    S.roundHistory.map(rh=>{
      let l=`라운드 ${rh.round} — ${P[rh.persona].full} : <b>${rh.turns}턴</b> · ${rh.ending===1?'🏆 숙의 타결':'🛡️ 공론장 격리'} · SOS ${rh.sos}회`;
      if(rh.statement) l+=`<br><span style="color:var(--gold);font-size:.8rem">　↳ 합의문: ${esc(rh.statement)}</span>`;
      return l;
    }).join('<br>');
}

// ── 페르소나 연속 도전 ───────────────────────────────────────────────────────
// 라운드 상태만 초기화 (주제·입장·가이드라인·누적 기록은 유지)
function resetRound(){
  S.scores={d:100,r:0,c:0}; S.sosLeft=3; S.history=[]; S.turns=0; S.rot={};
  S.lastStageIdx=0; S.endedWith=null; S.roundRecorded=false; S.startTime=null;
  S.consensusUnlocked=false; S.consensusStatement=''; S.consensusSubmitting=false; S.busy=false;
  document.getElementById('chat').innerHTML='';
  loadEl=null;
  document.getElementById('sosBtn').disabled=false;
  document.getElementById('sendBtn').disabled=false;
  updateConsensusBtn();
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
// (100vh 대신 innerHeight 사용: 모바일 브라우저 주소창에 입력창이 가려지는 문제 방지)
function fitDebateHeight(){
  const dp=document.getElementById('debatePanel');
  if(!dp||dp.style.display==='none') return;
  const h=document.querySelector('header');
  dp.style.height=(window.innerHeight-(h?h.offsetHeight:52))+'px';
}

function clamp(v){return Math.max(0,Math.min(100,v));}

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// ── INIT (브라우저에서만 실행) ───────────────────────────────────────────────
if(typeof document!=='undefined'&&document.getElementById('modeSel')){
  (function(){
    S.keyAnthropic=lsGet('ak_anthropic')||lsGet('ak')||'';
    S.keyGemini=lsGet('ak_gemini')||'';
    S.proxyUrl=lsGet('sim_proxy_url')||'';
    S.proxyCode=lsGet('sim_proxy_code')||'';
    S.mode=lsGet('sim_mode')||'offline';
    if(!MODE_LABEL[S.mode]) S.mode='offline';
    document.getElementById('modeSel').value=S.mode;
    renderConn();
  })();
}
