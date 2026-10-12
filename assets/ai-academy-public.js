(() => {
  'use strict';
  // Public, no-profile admissions assistant. Never request student identifiers.
  const style=document.createElement('style');
  style.textContent=`
  .sd-admissions-launch{position:fixed;bottom:22px;right:22px;z-index:7999;background:#174a79;color:#fff;border:0;border-radius:999px;padding:14px 19px;font:600 15px/1.3 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 25px #001d3650}
  .sd-admissions-panel{position:fixed;bottom:84px;right:18px;z-index:8000;display:none;width:min(390px,calc(100vw - 26px));max-height:min(580px,calc(100dvh - 120px));background:#fff;color:#112338;border:1px solid #d3e1ef;border-radius:17px;box-shadow:0 10px 40px #071b3750;overflow:auto;font:14px/1.5 system-ui,sans-serif}
  .sd-admissions-panel.is-open{display:block}
  .sd-admissions-head{padding:14px 17px;background:#11395d;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px}
  .sd-admissions-head strong{font-size:1.05rem}
  .sd-admissions-close{background:transparent;border:1px solid #bdd0e6;color:white;border-radius:7px;cursor:pointer;padding:5px 10px}
  .sd-admissions-content{padding:16px}
  .sd-admissions-content p{margin:0 0 10px}
  .sd-admissions-content label{font-weight:600;display:block;margin-bottom:7px}
  .sd-admissions-content textarea{display:block;width:100%;box-sizing:border-box;min-height:75px;border:1px solid #9caec1;border-radius:9px;padding:10px;font:inherit;resize:vertical}
  .sd-admissions-send{margin-top:9px;background:#174a79;color:white;border:0;border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer}
  .sd-admissions-send:disabled{opacity:.65;cursor:wait}
  .sd-admissions-answer{white-space:pre-wrap;margin-top:13px;background:#f0f6fc;border-radius:9px;padding:12px;min-height:27px}
  .sd-admissions-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .sd-admissions-links a{color:#174a79;border:1px solid #b5cada;border-radius:8px;padding:7px 9px;text-decoration:none;font-size:13px}
  .sd-admissions-disclaimer{font-size:12px;color:#526579;margin-top:10px!important}
  @media(max-width:520px){.sd-admissions-launch{right:12px;bottom:12px}.sd-admissions-panel{right:12px;bottom:72px;max-height:calc(100dvh - 90px)}}
  `;
  document.head.appendChild(style);
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
