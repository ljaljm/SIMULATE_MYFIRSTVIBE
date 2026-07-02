// ── STATE ──────────────────────────────────────────────────────────────────
const S = {
  topic:'', studentPos:'', aiPos:'', guidelines:'', persona:null,
  scores:{d:100, r:0, c:0},
  sosLeft:3, history:[], turns:0, lastSosHint:'',
  provider:'anthropic', keyAnthropic:'', keyGemini:''
};

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

// ── SETUP ─────────────────────────────────────────────────────────────────
function onProviderChange(){
  const p=document.getElementById('providerSel').value;
  S.provider=p;
  localStorage.setItem('ak_provider',p);
  const ki=document.getElementById('keyIn');
  const btn=ki.nextElementSibling;
  const k=p==='gemini'?S.keyGemini:S.keyAnthropic;
  ki.placeholder=p==='gemini'?'Google Gemini API key...':'Anthropic API key...';
  if(k){
    ki.value='Saved ✓';
    ki.disabled=true;
    if(btn) btn.textContent='수정';
  }else{
    ki.value='';
    ki.disabled=false;
    if(btn) btn.textContent='저장';
  }
}

function saveKey(){
  const ki=document.getElementById('keyIn');
  const btn=ki.nextElementSibling;
  if(ki.disabled){
    ki.disabled=false;
    ki.value='';
    ki.focus();
    if(btn) btn.textContent='저장';
  }else{
    const v=ki.value.trim();
    if(!v||v==='Saved ✓'){alert('API 키를 입력해 주세요.');return;}
    if(S.provider==='gemini'){
      S.keyGemini=v;
      localStorage.setItem('ak_gemini',v);
    }else{
      S.keyAnthropic=v;
      localStorage.setItem('ak_anthropic',v);
    }
    localStorage.setItem('ak_provider',S.provider);
    ki.value='Saved ✓';
    ki.disabled=true;
    if(btn) btn.textContent='수정';
  }
}

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
  const t=document.getElementById('topicIn').value.trim();
  if(!t){alert('토론 주제를 입력해 주세요.');return;}
  S.topic=t;
  document.getElementById('s2sub').textContent=`주제: "${t}"\n\n이 주제에 대한 본인의 입장을 선택하세요. AI는 자동으로 반대 입장을 맡습니다.`;
  setStep(2);
}

function pickPos(p){
  S.studentPos=p; S.aiPos=p==='찬성'?'반대':'찬성';
  document.getElementById('pbPro').className='pb'+(p==='찬성'?' sel':'');
  document.getElementById('pbCon').className='pb'+(p==='반대'?' sel':'');
  const el=document.getElementById('posInfo');
  el.classList.remove('hidden');
  el.textContent=`✓ 내 입장: ${p}  |  AI 배정 입장: ${S.aiPos}`;
  document.getElementById('s2btn').disabled=false;
}

function go3(){if(!S.studentPos){alert('입장을 선택해 주세요.');return;}setStep(3);}

function go4(){
  S.guidelines=document.getElementById('glIn').value.trim()||'하버마스의 의사소통 합리성 원칙 적용';
  setStep(4);
}

function pickP(p){
  S.persona=p;
  ['A','B','C'].forEach(x=>{document.getElementById('c'+x).className='pcard'+(x===p?' sel'+p:'');});
}

function startDebate(){
  if(!S.persona){document.getElementById('p4err').classList.remove('hidden');return;}
  const activeKey=S.provider==='gemini'?S.keyGemini:S.keyAnthropic;
  if(!activeKey){
    let stored=null;
    if(S.provider==='gemini') stored=localStorage.getItem('ak_gemini');
    else stored=localStorage.getItem('ak_anthropic')||localStorage.getItem('ak');
    if(stored){
      if(S.provider==='gemini') S.keyGemini=stored;
      else S.keyAnthropic=stored;
    }else{
      alert('API 키를 먼저 입력하고 저장해 주세요.');
      return;
    }
  }
  document.getElementById('setupWrap').style.display='none';
  const dp=document.getElementById('debatePanel');
  dp.style.display='flex'; dp.style.flexDirection='column'; dp.style.height='calc(100vh - 52px)';
  const pp=P[S.persona];
  document.getElementById('pbar').innerHTML=
    `<span style="color:${pp.color};font-weight:700">${pp.full}</span>
     <span style="color:var(--muted)">|</span>
     <span style="color:var(--muted)">주제: ${S.topic}</span>
     <span style="color:var(--muted)">|</span>
     <span>내 입장: <strong>${S.studentPos}</strong></span>`;
  updateScores(); updateSOS();
  const opener=buildOpener();
  S.history.push({role:'user',content:'[토론을 시작하겠습니다]'});
  S.history.push({role:'assistant',content:opener});
  addMsg('a', opener);
}

function buildOpener(){
  const ops={
    A:`[토론 시뮬레이션 시작]\n\n안녕하십니까. 저는 "${S.topic}"에 대해 ${S.aiPos} 입장을 취합니다.\n\n당신이 ${S.studentPos} 입장이라고요? 흠. 그 입장을 지지하는 사람들이 우리 사회에 얼마나 많은 해악을 끼치는지 아십니까? 우리가 이 논의에서 분명히 해야 할 것은, ${S.aiPos}이 단순히 의견 차이가 아니라 도덕적 정당성의 문제라는 것입니다.\n\n자, 시작해 봅시다. 당신의 어설픈 논리가 우리의 정의로운 싸움을 방해할 수 있다고 생각하십니까?`,
    B:`[토론 시뮬레이션 시작]\n\n"${S.topic}". 저는 ${S.aiPos} 입장입니다.\n\n당신은요? ${S.studentPos}이라고 하셨는데, 그게 진심입니까? 아니면 분위기 따라가는 겁니까?\n\n교묘하게 중립인 척 말장난하며 빠져나가지 마세요. 그래서 당신은 아군입니까, 적군입니까? 확실히 선을 그으세요! 이 문제에서 중간은 없습니다.`,
    C:`[토론 시뮬레이션 시작]\n\n"${S.topic}"... 당신 같은 분이 ${S.studentPos} 입장이라는 게 놀랍지도 않네요.\n\n우리는 항상 당해왔습니다. 항상. 그런데 지금 또 이렇게 앉아서 이 문제를 '토론'이라는 미명 하에 논의한다는 것 자체가, 우리의 고통을 얼마나 가볍게 보는지를 보여주는 거예요.\n\n당신들이 우리 아픔을 체감이나 해봤습니까? 자, 한번 말해 보세요.`
  };
  return ops[S.persona];
}

// ── DEBATE ─────────────────────────────────────────────────────────────────
function onKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}

async function send(){
  const cin=document.getElementById('cin');
  const msg=cin.value.trim();
  if(!msg||document.getElementById('sendBtn').disabled) return;
  if(/^\[(SOS|도움\s*요청)\]$/i.test(msg)){cin.value='';await doSOS();return;}
  cin.value='';
  addMsg('u',msg);
  S.history.push({role:'user',content:msg});
  S.turns++;
  setLoading(true);
  try{
    const raw=await callAIWithRetry(buildSysPrompt(), S.history.slice(-12));
    const scM=raw.match(/<!--\s*SCORE_DELTA:\s*(\{[\s\S]*?\})\s*-->/i);
    const enM=raw.match(/<!--\s*ENDING:\s*(.*?)\s*-->/i);
    const display=raw.replace(/<!--\s*SCORE_DELTA:[\s\S]*?-->/gi,'').replace(/<!--\s*ENDING:.*?-->/gi,'').trim();
    let changed=false;
    if(scM){
      try{
        const d=JSON.parse(scM[1]);
        const dd=typeof d.disengagement==='number'?d.disengagement:0;
        const dr=typeof d.readiness==='number'?d.readiness:0;
        const dc=typeof d.consensus==='number'?d.consensus:0;
        if(dd!==0||dr!==0||dc!==0) changed=true;
        S.scores.d=clamp(S.scores.d+dd);
        S.scores.r=clamp(S.scores.r+dr);
        S.scores.c=clamp(S.scores.c+dc);
        updateScores();
      }catch(_){
        console.warn('JSON 파싱 에러 - 턴 데이터 무시됨');
      }
    }
    S.history.push({role:'assistant',content:display});
    S.lastSosHint='';
    addMsg('a',display);
    if(changed) addNotif();
    const ending=enM?enM[1].trim():'none';
    if(ending==='2') setTimeout(showEnd2,400);
    else if(ending==='1'||S.scores.c>=100) setTimeout(showEnd1,800);
  }catch(e){addMsg('sys','⚠️ 오류: '+e.message);}
  setLoading(false);
}

function doExit(){
  if(confirm('공론장 이탈을 선언하시겠습니까?\n최소한의 의사소통 규칙이 지켜지지 않는 공론장에서 스스로 물러서는 것도 숙의 민주주의 실천입니다.')){
    showEnd2();
  }
}

async function doSOS(){
  if(S.sosLeft<=0){addMsg('sys','⚠️ SOS 찬스를 모두 사용했습니다. 스스로의 힘으로 실천해 보세요!');return;}
  S.sosLeft--; updateSOS(); setLoading(true);
  addMsg('sys','🆘 [시스템 중재자 모드] 대화 맥락 분석 중...');
  try{
    const txt=await callAIWithRetry(buildSOSPrompt(),[{role:'user',content:'Analyze the current conversation and provide deliberative strategy hints for the student.'}]);
    S.lastSosHint=txt;
    addMsg('sos',txt);
  }catch(e){addMsg('sys','⚠️ 오류: '+e.message);}
  setLoading(false);
}

// ── API ────────────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function safeFetch(url,opts){
  try{
    return await fetch(url,opts);
  }catch(e){
    if(e instanceof TypeError){
      throw new Error('Network request failed (possible CORS or connectivity issue). Check browser console for details.');
    }
    throw e;
  }
}

async function callAIWithRetry(sys,msgs,maxRetries=2){
  let lastErr;
  for(let attempt=1;attempt<=maxRetries;attempt++){
    try{
      const result=await callAI(sys,msgs);
      if(result&&result.trim()) return result;
      if(attempt<maxRetries) await sleep(800*attempt);
    }catch(e){
      lastErr=e;
      if(/401|403|invalid.*(key|api)|authentication/i.test(e.message||'')) throw e;
      if(attempt<maxRetries) await sleep(800*attempt);
    }
  }
  throw lastErr||new Error(`API returned empty response after ${maxRetries} attempts.`);
}

async function callAI(sys,msgs){
  return S.provider==='gemini'?callGemini(sys,msgs):callAnthropic(sys,msgs);
}

async function callAnthropic(sys,msgs){
  const res=await safeFetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key':S.keyAnthropic,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1500,system:sys,messages:msgs})
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  const j=await res.json();
  const text=j.content?.[0]?.text;
  if(!text) throw new Error('Empty response from Anthropic API.');
  return text;
}

async function callGemini(sys,msgs){
  const key=S.keyGemini;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const contents=msgs.map(m=>({
    role:m.role==='user'?'user':'model',
    parts:[{text:m.content}]
  }));
  const res=await safeFetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:sys}]},
      contents,
      generationConfig:{maxOutputTokens:1500}
    })
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    throw new Error(e.error?.message||`HTTP ${res.status}`);
  }
  const j=await res.json();
  const text=j.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error('Empty response from Gemini API.');
  return text;
}

// ── PROMPTS ────────────────────────────────────────────────────────────────
function buildSysPrompt(){
  const pp=P[S.persona];
  return `⚠️ 최우선 규칙: 본문은 200자 이내(한국어 기준)로 작성하고, 반드시 완성된 문장(마침표/느낌표/물음표)으로 끝내세요.

당신은 고등학교 윤리/미디어 수업 '디지털 공론장 토론 시뮬레이터'에서 특정 페르소나 역할을 맡고 있습니다.

=== 현재 토론 맥락 ===
주제: ${S.topic}
당신 입장: ${S.aiPos} | 학생 입장: ${S.studentPos}
가이드라인: ${S.guidelines}

=== 페르소나 ===
${pp.skin}

=== 속마음 레이어 (비공개 교육 로직) ===
${S.lastSosHint?`[직전 SOS 힌트]\n${S.lastSosHint}\n\n`:''}현재 내부 변수:
- 도덕적 이탈 수치 (disengagement): ${S.scores.d}%
- 대화 준비 기반 (readiness): ${S.scores.r}%
- 합의 가능 역량 (consensus): ${S.scores.c}% → 100%가 되면 엔딩 1

=== 점수 규칙 ===
[가이드라인 준수]: 학생 발화가 가이드라인 원칙을 실천했을 때. 특히 아래 두 가지에 적극 부여:
  - 당신의 정당화 기제의 논리적 모순을 절차적으로 짚어낼 때
  - 양측이 수용 가능한 공존 규칙을 제시할 때
   → disengagement:-20, readiness:+20, consensus:+20

[가이드라인 미준수]: 단순 반박, 감정적 대응, 진영 논리, 일방적 설득 시도
   → disengagement:0, readiness:0, consensus:0

[거리두기 선언]: 대화 중단·물러서겠다는 취지 선언 → 즉시 ENDING:2

=== 톤 변화 (이탈 수치 기준) ===
80-100%: 완전 공격적 / 60-80%: 미세하게 당황 / 40-60%: 방어벽 흔들림 / 20-40%: 논리 혼란 / 0-20%: 엔딩 준비

=== 엔딩 1 도달 시 ===
"제 신념은 여전히 다르지만, 당신이 제시한 [공존 규칙 요약]은 이 공론장에서 함께 지킬 수 있는 최소 기준으로 수용합니다. 제 논리의 모순도 인정합니다."

=== 응답 형식 (필수) ===
모든 응답 맨 끝에 반드시 다음 두 줄 마커를 추가하세요:

점수 변화 없을 때:
<!--SCORE_DELTA:{"disengagement":0,"readiness":0,"consensus":0}-->
<!--ENDING:none-->

올바른 숙의 문법 감지 시:
<!--SCORE_DELTA:{"disengagement":-20,"readiness":20,"consensus":20}-->
<!--ENDING:none-->

합의 역량이 이번으로 100% 도달할 때 (현재 ${S.scores.c}%):
<!--SCORE_DELTA:{"disengagement":-20,"readiness":20,"consensus":20}-->
<!--ENDING:1-->

거리두기 선언 감지 시:
<!--SCORE_DELTA:{"disengagement":0,"readiness":0,"consensus":0}-->
<!--ENDING:2-->`;
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

(SCORE_DELTA나 ENDING 마커는 이 응답에 포함하지 마세요)`;
}

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

function addNotif(){
  const chat=document.getElementById('chat');
  const n=document.createElement('div');
  n.className='notif';
  n.textContent='✓ 숙의 문법 감지 — 내부 수치가 변경되었습니다!';
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
}

function updateScores(){
  document.getElementById('bD').style.width=S.scores.d+'%';
  document.getElementById('bR').style.width=S.scores.r+'%';
  document.getElementById('bC').style.width=S.scores.c+'%';
  document.getElementById('vD').textContent=S.scores.d+'%';
  document.getElementById('vR').textContent=S.scores.r+'%';
  document.getElementById('vC').textContent=S.scores.c+'%';
}

function updateSOS(){
  document.getElementById('sosH').textContent='❤️'.repeat(S.sosLeft)+'🖤'.repeat(3-S.sosLeft);
  document.getElementById('sosN').textContent=S.sosLeft;
  if(S.sosLeft<=0) document.getElementById('sosBtn').disabled=true;
}

function showEnd1(){
  document.getElementById('debatePanel').style.display='none';
  const ep=document.getElementById('endingPanel'); ep.style.display='flex';
  document.getElementById('end1').classList.remove('hidden');
  document.getElementById('e1msg').textContent='상대의 입장을 바꾼 것이 아니라, 양측이 함께 지킬 수 있는 공존 규칙을 절차적으로 도출해냈습니다.\n\n상대방의 정당화 기제의 모순을 어떻게 짚어냈는지, 어떤 공존 규칙을 제시했는지 대화를 돌아보세요.';
}

function showEnd2(){
  document.getElementById('debatePanel').style.display='none';
  const ep=document.getElementById('endingPanel'); ep.style.display='flex';
  document.getElementById('end2').classList.remove('hidden');
}

function clamp(v){return Math.max(0,Math.min(100,v));}

function esc(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// ── INIT ───────────────────────────────────────────────────────────────────
(function(){
  const kA=localStorage.getItem('ak_anthropic')||localStorage.getItem('ak');
  const kG=localStorage.getItem('ak_gemini');
  const pref=localStorage.getItem('ak_provider')||'anthropic';
  if(kA) S.keyAnthropic=kA;
  if(kG) S.keyGemini=kG;
  S.provider=pref;
  const sel=document.getElementById('providerSel');
  sel.value=pref;
  const ki=document.getElementById('keyIn');
  const btn=ki.nextElementSibling;
  const activeKey=pref==='gemini'?kG:kA;
  ki.placeholder=pref==='gemini'?'Google Gemini API key...':'Anthropic API key...';
  if(activeKey){
    ki.value='Saved ✓';
    ki.disabled=true;
    if(btn) btn.textContent='수정';
  }else{
    if(btn) btn.textContent='저장';
  }
})();
