(() => {
  'use strict';
  // Public, no-profile admissions assistant. Never request student identifiers.
  const launch=document.createElement('button');
  launch.className='sd-admissions-launch';launch.type='button';
  launch.textContent='Ask SkyDream';launch.setAttribute('aria-haspopup','dialog');
  const panel=document.createElement('div');
  panel.className='sd-admissions-panel';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');
  panel.setAttribute('aria-label','SkyDream admissions assistant');
  panel.innerHTML=`<div class="sd-admissions-head"><strong>SkyDream Admissions Assistant</strong><button class="sd-admissions-close" type="button" aria-label="Close assistant">Close</button></div>
    <div class="sd-admissions-content">
      <p>Ask about programmes, choosing a skill, registration dates, or published fees.</p>
      <form><label for="sdAdmissionsQuestion">Your question</label>
      <textarea id="sdAdmissionsQuestion" maxlength="350" required minlength="3" placeholder="Which course suits someone interested in creative design?"></textarea>
      <button class="sd-admissions-send" type="submit">Ask about admissions</button></form>
      <div class="sd-admissions-answer" role="status" aria-live="polite">I can help you explore SkyDream training programmes.</div>
      <div class="sd-admissions-links"><a href="/programs">Explore programmes</a><a href="/register">Register</a></div>
      <p class="sd-admissions-disclaimer">Do not enter names, student numbers, phone numbers or payment information. AI-assisted responses may be used when enabled; confirm official information on the website.</p>
    </div>`;
  document.body.append(launch,panel);
  const close=panel.querySelector('.sd-admissions-close');
  const form=panel.querySelector('form'),question=panel.querySelector('textarea');
  const send=panel.querySelector('.sd-admissions-send');
  const answer=panel.querySelector('.sd-admissions-answer');
  function toggle(open){
    panel.classList.toggle('is-open',open);
    launch.setAttribute('aria-expanded',String(open));
    if(open)question.focus();else launch.focus();
  }
  launch.addEventListener('click',()=>toggle(!panel.classList.contains('is-open')));
  close.addEventListener('click',()=>toggle(false));
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')toggle(false);});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const q=question.value.trim();
    if(q.length<3)return;
    send.disabled=true;send.textContent='Checking…';
    answer.textContent='Checking SkyDream programme information…';
    try{
      if(!window.SkyDreamFirebase)throw new Error('The admissions service is unavailable right now.');
      const result=await SkyDreamFirebase.call('publicAdmissionsAssistant',{question:q});
      answer.textContent=(result.answer||'Please check the programmes page.')+
        '\n\n'+(result.mode==='ai'?'AI-assisted answer':'Programme guidance')+
        ' · Published information may change.';
    }catch(err){
      answer.textContent=(window.SkyDreamFirebase&&SkyDreamFirebase.friendlyError(err))||
        'The admissions service is unavailable. Please use the programme and registration pages.';
    }finally{
      send.disabled=false;send.textContent='Ask about admissions';
    }
  });
})();
