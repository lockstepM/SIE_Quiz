const SECTIONS={
  S1:{name:'Knowledge of Capital Markets',short:'Capital Markets',q75:12,color:'#003c33'},
  S2:{name:'Products & Their Risks',short:'Products & Risks',q75:33,color:'#1863dc'},
  S3:{name:'Trading, Accounts & Prohibited',short:'Trading & Accounts',q75:23,color:'#ff7759'},
  S4:{name:'Regulatory Framework',short:'Regulatory',q75:7,color:'#9b60aa'},
};

const STORE={
  get:k=>{try{return JSON.parse(localStorage.getItem('sie_'+k));}catch(e){return null;}},
  set:(k,v)=>{try{localStorage.setItem('sie_'+k,JSON.stringify(v));}catch(e){}}
};

// Persistent data
let mistakeData=STORE.get('mistakes')||{};
let starData=STORE.get('stars')||{};
let sessionCount=STORE.get('sessions')||0;
let scoreHistory=STORE.get('scores')||[];
let sectionHistory=STORE.get('sectionScores')||{};
let sessionLog=STORE.get('log')||[]; // full session log entries

function saveMistakes(){STORE.set('mistakes',mistakeData);}
function saveStars(){STORE.set('stars',starData);}
function saveHistory(){STORE.set('scores',scoreHistory);STORE.set('sectionScores',sectionHistory);}
function saveLog(){STORE.set('log',sessionLog);}

// Session state
let selectedMode='quiz',selectedCountKey=75,selectedTopics=new Set(),selectedDrillMode='weighted';
let sessionQuestions=[],currentIdx=0,score=0,answers={},isDrillMode=false,isStarMode=false;
let sessionStartTime=null;

// ── Auto-save session state for pause/resume ──
function saveSessionState(){
  if(!sessionQuestions.length) return;
  STORE.set('pausedSession',{
    questions:sessionQuestions.map(q=>q.n),
    currentIdx,score,answers,
    isDrillMode,isStarMode,
    selectedMode,selectedCountKey,
    ts:Date.now()
  });
}

function clearPausedSession(){STORE.set('pausedSession',null);}

function hasPausedSession(){
  const p=STORE.get('pausedSession');
  if(!p) return false;
  // expire after 7 days
  if(Date.now()-p.ts>7*24*60*60*1000){clearPausedSession();return false;}
  return true;
}

// ── Init ──
function init(){
  buildTopicGrid();
  updateHomeStats();
  checkResumeBanner();
}

function checkResumeBanner(){
  const banner=document.getElementById('resume-banner');
  if(hasPausedSession()){
    const p=STORE.get('pausedSession');
    const answered=Object.keys(p.answers).length;
    const total=p.questions.length;
    const type=p.isDrillMode?'Drill':p.isStarMode?'Starred':'Quiz';
    document.getElementById('resume-sub').textContent=type+' session \u2014 '+answered+'/'+total+' answered';
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

function resumeSession(){
  const p=STORE.get('pausedSession');
  if(!p) return;
  // Restore questions from DB
  const qMap=new Map(DB.map(q=>[q.n,q]));
  sessionQuestions=p.questions.map(n=>qMap.get(n)).filter(Boolean);
  currentIdx=p.currentIdx;
  score=p.score;
  answers=p.answers;
  isDrillMode=p.isDrillMode;
  isStarMode=p.isStarMode;
  selectedMode=p.selectedMode||'quiz';
  selectedCountKey=p.selectedCountKey||75;
  sessionStartTime=Date.now();

  const pf=document.getElementById('progress-fill');
  pf.className='progress-fill'+(isDrillMode?' drill':isStarMode?' star-drill':'');
  document.getElementById('drill-pill').classList.toggle('show',isDrillMode);
  document.getElementById('star-drill-pill').classList.toggle('show',isStarMode);
  document.getElementById('score-pill').style.display=(isDrillMode||isStarMode)?'none':'';

  showScreen('quiz');
  renderQuestion();
}

// ── Pause / Quit ──
function pauseSession(){
  // Save state
  saveSessionState();
  // Update pause overlay stats
  const total=sessionQuestions.length;
  const answered=Object.keys(answers).length;
  const wrongCount=sessionQuestions.filter((q,i)=>answers[i]!==undefined&&answers[i]!==q.a).length;
  document.getElementById('ps-question').textContent=(currentIdx+1)+' / '+total;
  document.getElementById('ps-score').textContent=score+'/'+answered+' ('+(answered?Math.round(score/answered*100):0)+'%)';
  document.getElementById('ps-type').textContent=isDrillMode?'Drill':isStarMode?'Starred':'Quiz';
  document.getElementById('ps-wrong').textContent=wrongCount;
  document.getElementById('pause-overlay').classList.add('show');
}

function resumeFromOverlay(){
  document.getElementById('pause-overlay').classList.remove('show');
}

function quitSession(){
  document.getElementById('pause-overlay').classList.remove('show');
  saveSessionState();
  checkResumeBanner();
  updateHomeStats();
  showScreen('home');
}

// ── Stats ──
function getAvgScore(){
  const quizOnly=scoreHistory.filter(x=>!x.isDrill&&!x.isStar);
  if(!quizOnly.length) return null;
  const recent=quizOnly.slice(-20);
  return Math.round(recent.reduce((s,x)=>s+x.pct,0)/recent.length);
}

function updateHomeStats(){
  const seen=STORE.get('seen')||{};
  document.getElementById('unseen-count').textContent=Math.max(0,DB.length-Object.keys(seen).length);
  const mistakes=Object.keys(mistakeData).filter(k=>mistakeData[k].wrongCount>0);
  const stars=Object.keys(starData).filter(k=>starData[k]);
  document.getElementById('stat-mistakes').textContent=mistakes.length;
  document.getElementById('stat-stars').textContent=stars.length;
  document.getElementById('stat-total').textContent=DB.length;
  const avg=getAvgScore();
  document.getElementById('stat-avg').textContent=avg!==null?avg+'%':'--';
  // Mistake banner
  const mb=document.getElementById('mistake-banner');
  if(mistakes.length>0){mb.classList.add('visible');document.getElementById('mb-count').textContent=mistakes.length;const tot=mistakes.reduce((s,k)=>s+mistakeData[k].wrongCount,0);document.getElementById('mb-sub-text').textContent=mistakes.length+' questions, '+tot+' wrong attempts';}
  else mb.classList.remove('visible');
  // Star banner
  const sb=document.getElementById('star-banner');
  if(stars.length>0){sb.classList.add('visible');document.getElementById('star-count-badge').textContent=stars.length;document.getElementById('star-sub-text').textContent=stars.length+' question'+(stars.length>1?'s':'')+' starred';}
  else sb.classList.remove('visible');
  renderSectionPerf();
  checkResumeBanner();
}

function renderSectionPerf(){
  const box=document.getElementById('section-perf');
  const hasData=Object.values(sectionHistory).some(a=>a&&a.length>0);
  if(!hasData){box.classList.remove('visible');return;}
  box.classList.add('visible');
  const rows=document.getElementById('sp-rows');
  rows.innerHTML='';
  for(const [s,meta] of Object.entries(SECTIONS)){
    const hist=(sectionHistory[s]||[]).filter(x=>x!==null&&x!==undefined);
    if(!hist.length) continue;
    const avg=Math.round(hist.slice(-10).reduce((a,b)=>a+b,0)/Math.min(hist.length,10));
    const color=avg>=70?'#003c33':avg>=50?'#1863dc':'#b30000';
    const row=document.createElement('div');row.className='sp-row';
    row.innerHTML='<span class="sp-label">'+s+'</span><span class="sp-name">'+meta.short+'</span><div class="sp-track"><div class="sp-fill" style="width:'+avg+'%;background:'+color+'"></div></div><span class="sp-pct" style="color:'+color+'">'+avg+'%</span>';
    rows.appendChild(row);
  }
}

function buildTopicGrid(){
  const grid=document.getElementById('topic-grid');grid.innerHTML='';
  const allBtn=document.createElement('button');
  allBtn.className='topic-btn selected';allBtn.id='topic-all';allBtn.textContent='All Sections';
  allBtn.onclick=()=>{selectedTopics.clear();document.querySelectorAll('.topic-btn').forEach(b=>b.classList.remove('selected'));allBtn.classList.add('selected');};
  grid.appendChild(allBtn);
  for(const [s,meta] of Object.entries(SECTIONS)){
    const btn=document.createElement('button');btn.className='topic-btn';
    btn.innerHTML='<strong>'+s+'</strong> — '+meta.short;
    btn.onclick=()=>toggleTopic(s,btn);grid.appendChild(btn);
  }
}

function toggleTopic(topic,btn){
  document.getElementById('topic-all').classList.remove('selected');
  if(selectedTopics.has(topic)){selectedTopics.delete(topic);btn.classList.remove('selected');if(selectedTopics.size===0)document.getElementById('topic-all').classList.add('selected');}
  else{selectedTopics.add(topic);btn.classList.add('selected');}
}

function selectMode(mode){selectedMode=mode;document.querySelectorAll('.mode-btn[id^="mode-"]').forEach(b=>b.classList.remove('selected'));document.getElementById('mode-'+mode).classList.add('selected');}
function selectCount(n){selectedCountKey=n;['10','25','75','100','150','all'].forEach(k=>{const el=document.getElementById('count-'+k);if(el)el.classList.remove('selected');});document.getElementById('count-'+(n===0?'all':n)).classList.add('selected');}
function selectDrillMode(mode){selectedDrillMode=mode;document.querySelectorAll('.drill-opt').forEach(b=>b.classList.remove('selected'));document.getElementById('drill-'+mode).classList.add('selected');}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

function buildWeightedSession(pool){
  const bySection={S1:[],S2:[],S3:[],S4:[]};
  pool.forEach(q=>{if(bySection[q.s])bySection[q.s].push(q);});
  for(const s in bySection) bySection[s]=shuffle(bySection[s]);
  const targets={S1:12,S2:33,S3:23,S4:7};
  let result=[];
  for(const s in targets) result=result.concat(bySection[s].slice(0,Math.min(targets[s],bySection[s].length)));
  if(result.length<75){const used=new Set(result.map(q=>q.n));result=result.concat(shuffle(pool.filter(q=>!used.has(q.n))).slice(0,75-result.length));}
  return shuffle(result.slice(0,75));
}

// ── Start sessions ──
function startQuiz(){
  isDrillMode=false;isStarMode=false;
  const seen=STORE.get('seen')||{};
  const seenKeys=new Set(Object.keys(seen));
  let pool=selectedTopics.size>0?DB.filter(q=>selectedTopics.has(q.s)):[...DB];
  let unseen=shuffle(pool.filter(q=>!seenKeys.has(String(q.n))));
  let seenPool=shuffle(pool.filter(q=>seenKeys.has(String(q.n))));
  pool=[...unseen,...seenPool];
  if(selectedCountKey===75&&selectedTopics.size===0){const w=buildWeightedSession(pool);if(w&&w.length===75){sessionQuestions=w;beginSession();return;}}
  sessionQuestions=pool.slice(0,selectedCountKey===0?pool.length:Math.min(selectedCountKey,pool.length));
  beginSession();
}

function startDrill(){
  isDrillMode=true;isStarMode=false;
  const wrongKeys=Object.keys(mistakeData).filter(k=>mistakeData[k].wrongCount>0);
  if(!wrongKeys.length)return;
  let pool=[];
  if(selectedDrillMode==='weighted'){wrongKeys.forEach(k=>{const q=DB.find(q=>q.n===parseInt(k));if(!q)return;const t=Math.min(mistakeData[k].wrongCount,4);for(let i=0;i<t;i++)pool.push(q);});}
  else{wrongKeys.forEach(k=>{const q=DB.find(q=>q.n===parseInt(k));if(q)pool.push(q);});}
  sessionQuestions=shuffle(pool);beginSession();showScreen('quiz');
}

function startStarDrill(){
  isDrillMode=false;isStarMode=true;
  const starKeys=Object.keys(starData).filter(k=>starData[k]);
  if(!starKeys.length)return;
  sessionQuestions=shuffle(starKeys.map(k=>DB.find(q=>q.n===parseInt(k))).filter(Boolean));
  beginSession();showScreen('quiz');
}

function startDrillFromResult(){
  isDrillMode=true;isStarMode=false;
  const wrong=sessionQuestions.filter((q,i)=>answers[i]!==q.a);
  if(!wrong.length)return;
  sessionQuestions=shuffle([...wrong]);beginSession();
}

function beginSession(){
  currentIdx=0;score=0;answers={};
  sessionStartTime=Date.now();
  sessionCount++;STORE.set('sessions',sessionCount);
  if(!isDrillMode&&!isStarMode){const seen=STORE.get('seen')||{};sessionQuestions.forEach(q=>{seen[q.n]=1;});STORE.set('seen',seen);}
  clearPausedSession();
  const pf=document.getElementById('progress-fill');
  pf.className='progress-fill'+(isDrillMode?' drill':isStarMode?' star-drill':'');
  document.getElementById('drill-pill').classList.toggle('show',isDrillMode);
  document.getElementById('star-drill-pill').classList.toggle('show',isStarMode);
  document.getElementById('score-pill').style.display=(isDrillMode||isStarMode)?'none':'';
  showScreen('quiz');renderQuestion();
}

// ── Render ──
function renderQuestion(){
  const q=sessionQuestions[currentIdx];
  const total=sessionQuestions.length;
  document.getElementById('q-counter').textContent=(currentIdx+1)+' / '+total;
  document.getElementById('score-pill').textContent='Score: '+score;
  document.getElementById('progress-fill').style.width=(((currentIdx+1)/total)*100)+'%';
  document.getElementById('q-num-tag').textContent='Q'+q.n;
  document.getElementById('q-section-tag').textContent=q.s+' \u2014 '+(SECTIONS[q.s]?SECTIONS[q.s].short:q.t);
  const tag=document.getElementById('q-tag');
  tag.className='q-tag'+(isDrillMode?' drill-tag':isStarMode?' star-tag':'');
  const md=mistakeData[q.n];
  const badge=document.getElementById('wrong-badge');
  if(md&&md.wrongCount>0){badge.style.display='inline-flex';const st=md.correctStreak||0;document.getElementById('wrong-badge-text').textContent='\u2717 wrong '+md.wrongCount+'x'+(st>0?' \u2605 streak '+st:'');}
  else badge.style.display='none';
  updateStarBtn(q.n);
  document.getElementById('question-text').textContent=q.q;
  const choicesEl=document.getElementById('choices');choicesEl.innerHTML='';
  const labels=['A','B','C','D'];
  q.c.forEach((choice,i)=>{
    const btn=document.createElement('button');btn.className='choice';
    btn.innerHTML='<span class="choice-label">'+labels[i]+'</span><span class="choice-text">'+choice+'</span><span class="choice-icon">'+(i===q.a?'\u2713':'\u2717')+'</span>';
    btn.onclick=()=>selectAnswer(i);choicesEl.appendChild(btn);
  });
  document.getElementById('rationale-box').classList.remove('show');
  document.getElementById('rationale-text').textContent=q.r;
  const nextBtn=document.getElementById('next-btn');
  nextBtn.className='nav-btn btn-next';
  nextBtn.textContent=currentIdx===total-1?'Finish':'Next \u2192';
  if(answers[currentIdx]!==undefined) applyAnswer(answers[currentIdx],false);
  if(selectedMode==='study'&&answers[currentIdx]===undefined){
    document.getElementById('rationale-box').classList.add('show');
    nextBtn.classList.add(isDrillMode?'drill-ready':isStarMode?'star-ready':'ready');
    document.querySelectorAll('.choice').forEach((btn,i)=>{btn.disabled=true;if(i===q.a)btn.classList.add('correct');else btn.classList.add('dimmed');});
  }
  // Auto-save after rendering
  saveSessionState();
}

function updateStarBtn(qnum){
  const btn=document.getElementById('star-btn');
  const starred=!!starData[qnum];
  btn.className='star-btn'+(starred?' starred':'');
  document.getElementById('star-label').textContent=starred?'Starred':'Star';
}

function toggleStar(){
  const q=sessionQuestions[currentIdx];
  starData[q.n]=!starData[q.n];
  if(!starData[q.n]) delete starData[q.n];
  saveStars();updateStarBtn(q.n);updateHomeStats();
}

function selectAnswer(idx){
  if(answers[currentIdx]!==undefined)return;
  answers[currentIdx]=idx;
  const q=sessionQuestions[currentIdx];
  const correct=idx===q.a;
  if(correct){score++;if(!mistakeData[q.n])mistakeData[q.n]={wrongCount:0,correctStreak:0};mistakeData[q.n].correctStreak=(mistakeData[q.n].correctStreak||0)+1;}
  else{if(!mistakeData[q.n])mistakeData[q.n]={wrongCount:0,correctStreak:0};mistakeData[q.n].wrongCount++;mistakeData[q.n].correctStreak=0;}
  saveMistakes();
  applyAnswer(idx,true);
  saveSessionState();
}

function applyAnswer(idx,isNew){
  const q=sessionQuestions[currentIdx];
  document.querySelectorAll('.choice').forEach((btn,i)=>{btn.disabled=true;if(i===q.a)btn.classList.add('correct');else if(i===idx&&i!==q.a)btn.classList.add('wrong');else btn.classList.add('dimmed');});
  document.getElementById('rationale-box').classList.add('show');
  const nextBtn=document.getElementById('next-btn');
  nextBtn.classList.add(isDrillMode?'drill-ready':isStarMode?'star-ready':'ready');
  if(isNew) document.getElementById('score-pill').textContent='Score: '+score;
}

function nextQ(){if(currentIdx<sessionQuestions.length-1){currentIdx++;renderQuestion();document.querySelector('.quiz-body').scrollTop=0;}else showResult();}
function prevQ(){if(currentIdx>0){currentIdx--;renderQuestion();document.querySelector('.quiz-body').scrollTop=0;}}

// ── Result & Logging ──
function showResult(){
  clearPausedSession();
  const total=sessionQuestions.length;
  const pct=Math.round((score/total)*100);
  const elapsed=sessionStartTime?Math.round((Date.now()-sessionStartTime)/1000):0;
  const wrongCount=sessionQuestions.filter((q,i)=>answers[i]!==q.a).length;

  // Compute per-section scores
  const secCorrect={S1:0,S2:0,S3:0,S4:0};
  const secTotal={S1:0,S2:0,S3:0,S4:0};
  sessionQuestions.forEach((q,i)=>{
    if(!secTotal.hasOwnProperty(q.s)) return;
    secTotal[q.s]++;
    if(answers[i]===q.a) secCorrect[q.s]++;
  });
  const secPct={};
  for(const s in secTotal) secPct[s]=secTotal[s]?Math.round(secCorrect[s]/secTotal[s]*100):null;

  // Log entry
  const type=isDrillMode?'drill':isStarMode?'starred':'quiz';
  const logEntry={
    id:Date.now(),
    ts:Date.now(),
    type,
    total,
    score,
    pct,
    wrongCount,
    elapsed,
    sections:secPct,
    sectionTotals:secTotal,
  };
  sessionLog.unshift(logEntry); // newest first
  if(sessionLog.length>100) sessionLog=sessionLog.slice(0,100);
  saveLog();

  // Save to rolling history (quiz only for averages)
  if(!isDrillMode&&!isStarMode){
    scoreHistory.push({pct,ts:Date.now()});
    if(scoreHistory.length>100) scoreHistory=scoreHistory.slice(-100);
    for(const s in secPct){
      if(secPct[s]===null) continue;
      if(!sectionHistory[s]) sectionHistory[s]=[];
      sectionHistory[s].push(secPct[s]);
      if(sectionHistory[s].length>30) sectionHistory[s]=sectionHistory[s].slice(-30);
    }
    saveHistory();
  }

  let grade,gradeClass;
  if(pct>=90){grade='Excellent!';gradeClass='grade-excellent';}
  else if(pct>=70){grade='Good Work';gradeClass='grade-good';}
  else if(pct>=50){grade='Keep Studying';gradeClass='grade-good';}
  else{grade='Review Needed';gradeClass='grade-poor';}

  document.getElementById('result-grade').textContent=isDrillMode?'Drill Complete':isStarMode?'Starred Complete':grade;
  document.getElementById('result-grade').className='result-grade '+gradeClass;
  document.getElementById('score-frac').textContent=score+'/'+total;
  document.getElementById('score-pct').textContent=pct+'%';

  const circ=2*Math.PI*58;
  const ring=document.getElementById('ring-fill');
  ring.setAttribute('stroke-dasharray',circ);ring.setAttribute('stroke-dashoffset',circ);
  ring.setAttribute('stroke',pct>=70?'#003c33':pct>=50?'#1863dc':'#b30000');
  setTimeout(()=>{ring.setAttribute('stroke-dashoffset',circ-(pct/100)*circ);},100);

  // Section scores
  const ssBox=document.getElementById('section-scores-box');
  const ssRows=document.getElementById('ss-rows');ssRows.innerHTML='';
  let hasSection=false;
  for(const [s,meta] of Object.entries(SECTIONS)){
    if(secPct[s]===null||secTotal[s]===0) continue;
    hasSection=true;
    const color=secPct[s]>=70?'#003c33':secPct[s]>=50?'#1863dc':'#b30000';
    const row=document.createElement('div');row.className='ss-row';
    row.innerHTML='<span class="ss-label">'+s+'</span><span class="ss-name">'+meta.short+' ('+secTotal[s]+'Q)</span><div class="ss-track"><div class="ss-fill" style="width:'+secPct[s]+'%;background:'+color+'"></div></div><span class="ss-pct" style="color:'+color+'">'+secPct[s]+'%</span>';
    ssRows.appendChild(row);
  }
  ssBox.style.display=hasSection?'block':'none';

  // Wrong answers
  const newWrong=sessionQuestions.filter((q,i)=>answers[i]!==q.a);
  const mrbBox=document.getElementById('mistake-result-box');
  const mrbList=document.getElementById('mistake-result-list');mrbList.innerHTML='';
  if(newWrong.length>0){
    mrbBox.classList.add('visible');
    document.getElementById('mrb-sub').textContent=newWrong.length+' question'+(newWrong.length>1?'s':'')+' added to review queue';
    newWrong.slice(0,8).forEach(q=>{const md=mistakeData[q.n]||{wrongCount:1};const item=document.createElement('div');item.className='mistake-item';item.innerHTML='<span class="mi-num">Q'+q.n+'</span><span class="mi-text">'+q.q+'</span><span class="mi-badge">Wrong '+md.wrongCount+'x</span>';mrbList.appendChild(item);});
  } else mrbBox.classList.remove('visible');

  const list=document.getElementById('breakdown-list');list.innerHTML='';
  sessionQuestions.forEach((q,i)=>{const ok=answers[i]===q.a;const item=document.createElement('div');item.className='breakdown-item '+(ok?'ok':'fail');item.innerHTML='<span class="bd-icon">'+(ok?'\u2713':'\u2717')+'</span><span class="bd-num">Q'+q.n+'</span><span class="bd-text">'+q.q+'</span>';list.appendChild(item);});

  const drillBtn=document.getElementById('drill-from-result-btn');
  if(newWrong.length>0){drillBtn.disabled=false;drillBtn.innerHTML='🔥 Drill Wrong Answers ('+newWrong.length+')';}
  else{drillBtn.disabled=true;drillBtn.textContent='No wrong answers!';}

  updateHomeStats();showScreen('result');
}

function restartQuiz(){isDrillMode?startDrill():isStarMode?startStarDrill():startQuiz();}

// ── Session Log Screen ──
function goLog(){renderLogScreen();showScreen('log-home');}

function renderLogScreen(){
  // Section averages card
  const sacRows=document.getElementById('sac-rows');sacRows.innerHTML='';
  let worstSection=null,worstAvg=101;
  for(const [s,meta] of Object.entries(SECTIONS)){
    const hist=(sectionHistory[s]||[]).filter(x=>x!==null);
    if(!hist.length) continue;
    const avg=Math.round(hist.reduce((a,b)=>a+b,0)/hist.length);
    const recent=hist.slice(-5);
    const recentAvg=Math.round(recent.reduce((a,b)=>a+b,0)/recent.length);
    const color=avg>=70?'#003c33':avg>=50?'#1863dc':'#b30000';
    if(avg<worstAvg){worstAvg=avg;worstSection=s;}
    const row=document.createElement('div');row.className='sac-row';
    row.innerHTML='<span class="sac-label">'+s+'</span><div class="sac-info"><div class="sac-name">'+meta.name+'</div><div class="sac-track"><div class="sac-fill" style="width:'+avg+'%;background:'+color+'"></div></div></div><div class="sac-right"><div class="sac-pct" style="color:'+color+'">'+avg+'%</div><div class="sac-count">'+hist.length+' sessions</div></div>';
    sacRows.appendChild(row);
  }

  // Focus tip
  const tip=document.getElementById('focus-tip');
  if(worstSection&&worstAvg<70){
    tip.classList.add('visible');
    tip.innerHTML='🎯 <strong>Focus tip:</strong> Your weakest section is <strong>'+worstSection+' — '+SECTIONS[worstSection].name+'</strong> at '+worstAvg+'%. Consider filtering by this section on the home screen for your next sessions.';
  } else tip.classList.remove('visible');

  document.getElementById('log-count-label').textContent=sessionLog.length;

  // Log entries
  const list=document.getElementById('log-list');list.innerHTML='';
  if(!sessionLog.length){list.innerHTML='<div class="empty-state"><span class="empty-icon">📊</span><div class="empty-text">No sessions yet!</div><div class="empty-sub">Complete a session to see your history here.</div></div>';return;}

  sessionLog.forEach(entry=>{
    const date=new Date(entry.ts);
    const dateStr=date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const timeStr=date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const elapsed=entry.elapsed||0;
    const mins=Math.floor(elapsed/60);
    const secs=elapsed%60;
    const timeSpent=elapsed>0?(mins>0?mins+'m '+secs.toString().padStart(2,'0')+'s':secs+'s'):'--';
    const color=entry.pct>=70?'#003c33':entry.pct>=50?'#1863dc':'#b30000';
    const typeLabel=entry.type==='drill'?'Drill':entry.type==='starred'?'Starred':'Quiz';

    let secHTML='';
    for(const [s] of Object.entries(SECTIONS)){
      const sp=entry.sections?entry.sections[s]:null;
      const st=entry.sectionTotals?entry.sectionTotals[s]:0;
      if(!st){secHTML+='<div class="le-sec"><span class="le-sec-label">'+s+'</span><span class="le-sec-val" style="color:var(--muted)">--</span></div>';continue;}
      const sc=sp!==null?sp:0;
      const scColor=sc>=70?'#003c33':sc>=50?'#1863dc':'#b30000';
      secHTML+='<div class="le-sec"><span class="le-sec-label">'+s+'</span><span class="le-sec-val" style="color:'+scColor+'">'+sc+'%</span></div>';
    }

    const el=document.createElement('div');el.className='log-entry';
    el.innerHTML=
      '<div class="le-header">'+
        '<span class="le-meta">'+dateStr+' • '+timeStr+(elapsed>0?' • '+timeSpent:'')+'</span>'+
        '<span class="le-type '+entry.type+'">'+typeLabel+'</span>'+
      '</div>'+
      '<div class="le-score-row">'+
        '<span class="le-score" style="color:'+color+'">'+entry.pct+'%</span>'+
        '<div class="le-details">'+
          '<div class="le-detail-line">'+entry.score+'/'+entry.total+' correct</div>'+
          '<div class="le-detail-line">'+entry.wrongCount+' wrong</div>'+
        '</div>'+
      '</div>'+
      '<div class="le-sections">'+secHTML+'</div>';
    list.appendChild(el);
  });
}

function exportCSV(){
  if(!sessionLog.length){alert('No sessions to export yet.');return;}
  const headers=['Date','Time','Type','Score%','Correct','Total','Wrong','Duration','S1%','S2%','S3%','S4%'];
  const rows=sessionLog.map(e=>{
    const d=new Date(e.ts);
    const dateStr=d.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
    const timeStr=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
    const elapsed=e.elapsed||0;
    const mins=Math.floor(elapsed/60);
    const secs=elapsed%60;
    const dur=elapsed>0?(mins>0?mins+'m '+secs.toString().padStart(2,'0')+'s':secs+'s'):'--';
    const type=e.type==='drill'?'Drill':e.type==='starred'?'Starred':'Quiz';
    const s=e.sections||{};
    return [dateStr,timeStr,type,e.pct,e.score,e.total,e.wrongCount,dur,
      s.S1!==null&&s.S1!==undefined?s.S1+'%':'--',
      s.S2!==null&&s.S2!==undefined?s.S2+'%':'--',
      s.S3!==null&&s.S3!==undefined?s.S3+'%':'--',
      s.S4!==null&&s.S4!==undefined?s.S4+'%':'--'
    ].join(',');
  });
  const csv=[headers.join(','),...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='SIE_Session_Log_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function clearLog(){if(!confirm('Clear session log?'))return;sessionLog=[];saveLog();renderLogScreen();}

// ── Mistakes screen ──
function goMistakes(){renderMistakeList();showScreen('mistakes-home');}
function renderMistakeList(){
  const wrong=Object.entries(mistakeData).filter(([k,v])=>v.wrongCount>0).sort((a,b)=>b[1].wrongCount-a[1].wrongCount);
  document.getElementById('mistake-count-label').textContent=wrong.length;
  const btn=document.getElementById('drill-start-btn');
  if(!wrong.length){btn.disabled=true;btn.textContent='No wrong answers yet';}
  else{btn.disabled=false;btn.innerHTML='🔥 Start Drill ('+wrong.length+' questions)';}
  const list=document.getElementById('mistake-list');list.innerHTML='';
  if(!wrong.length){list.innerHTML='<div class="empty-state"><span class="empty-icon">🎉</span><div class="empty-text">No wrong answers!</div><div class="empty-sub">Complete a session to track mistakes.</div></div>';return;}
  wrong.forEach(([k,data])=>{
    const q=DB.find(q=>q.n===parseInt(k));if(!q)return;
    const streak=data.correctStreak||0;
    const row=document.createElement('div');row.className='item-row';
    row.innerHTML='<div class="ir-info"><div class="ir-meta">'+q.s+' \u2014 '+q.t+'</div><div class="ir-q">Q'+q.n+' \u2014 '+q.q+'</div></div><div class="ir-badges"><span class="wrong-times'+(data.wrongCount===1?' once':'')+'">'+data.wrongCount+'x wrong</span>'+(streak>0?'<span class="streak-badge">\u2605 '+streak+'</span>':'')+'</div>';
    list.appendChild(row);
  });
}
function clearMistakes(){if(!confirm('Clear all wrong answer history?'))return;mistakeData={};saveMistakes();updateHomeStats();renderMistakeList();}

// ── Stars screen ──
function goStars(){renderStarList();showScreen('stars-home');}
function renderStarList(){
  const stars=Object.keys(starData).filter(k=>starData[k]);
  document.getElementById('star-count-label').textContent=stars.length;
  const btn=document.getElementById('star-drill-start-btn');
  if(!stars.length){btn.disabled=true;btn.textContent='No starred questions yet';}
  else{btn.disabled=false;btn.innerHTML='⭐ Drill Starred Questions ('+stars.length+')';}
  const list=document.getElementById('star-list');list.innerHTML='';
  if(!stars.length){list.innerHTML='<div class="empty-state"><span class="empty-icon">⭐</span><div class="empty-text">No starred questions!</div><div class="empty-sub">Tap the star button on any question to save it.</div></div>';return;}
  stars.forEach(k=>{
    const q=DB.find(q=>q.n===parseInt(k));if(!q)return;
    const md=mistakeData[q.n];
    const row=document.createElement('div');row.className='item-row';
    row.innerHTML='<div class="ir-info"><div class="ir-meta">'+q.s+' \u2014 '+q.t+'</div><div class="ir-q">Q'+q.n+' \u2014 '+q.q+'</div></div><div class="ir-badges">'+(md&&md.wrongCount>0?'<span class="wrong-times'+(md.wrongCount===1?' once':'')+'">'+md.wrongCount+'x wrong</span>':'<span class="streak-badge">⭐ starred</span>')+'</div>';
    list.appendChild(row);
  });
}
function clearStars(){if(!confirm('Clear all starred questions?'))return;starData={};saveStars();updateHomeStats();renderStarList();}

// ── Helpers ──
function resetSeen(){if(!confirm('Reset question history? All questions treated as new again.'))return;STORE.set('seen',{});updateHomeStats();alert('Done! All questions reset.');}
function goHome(){updateHomeStats();showScreen('home');}
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');window.scrollTo(0,0);}

init();

