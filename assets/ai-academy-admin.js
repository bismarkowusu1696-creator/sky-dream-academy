(() => {
  'use strict';
  // Owner-only AI pilot. The backend independently rechecks the stored owner
  // role and active session on every request.
  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,
    ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const error=e=>window.SkyDreamFirebase?.friendlyError(e)||e.message||'Please try again.';
  const style=document.createElement('style');
  style.textContent='.sd-ai-pill{display:inline-block;padding:3px 9px;border-radius:16px;background:#ecf3ff;color:#164a79;font-size:.8rem}.sd-ai-output{white-space:pre-wrap;line-height:1.65}.sd-ai-meta{font-size:.8rem;color:#526278}.sd-ai-find{padding:14px;border:1px solid #dbe4ee;border-radius:10px;margin:10px 0}.sd-ai-find strong{display:block}.sd-ai-warn{color:#a14d15}.sd-ai-high{color:#a92133}.sd-ai-table{overflow:auto;margin-top:14px}.sd-ai-table table{width:100%;min-width:540px;border-collapse:collapse}.sd-ai-table td,.sd-ai-table th{padding:9px;border-bottom:1px solid #dde6f0;text-align:left}.sd-ai-controls{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}';
  document.head.appendChild(style);
  function section(id,title,body){
    if($(id))return;
    const main=document.querySelector('#dashboardShell .dashboard-main');
    if(!main)return;
    const el=document.createElement('section');el.id=id;el.className='dashboard-panel';
    el.innerHTML='<h2>'+esc(title)+'</h2>'+body;
    main.insertBefore(el,$('account')||null);
  }
  function nav(href,label){
    const host=document.querySelector('#dashboardShell .dashboard-sidebar nav');
    if(!host||host.querySelector('a[href="'+href+'"]'))return;
    const el=document.createElement('a');el.href=href;el.textContent=label;
    host.insertBefore(el,host.querySelector('a[href="#account"]')||null);
  }
  function busy(button,on,text){
    if(!button)return;
    if(on){button.dataset.oldLabel=button.textContent;button.textContent=text;button.disabled=true;button.setAttribute('aria-busy','true');}
    else{button.textContent=button.dataset.oldLabel||button.textContent;button.disabled=false;button.removeAttribute('aria-busy');}
  }
  function table(rows){
    if(!rows?.length)return '';
    const cols=Object.keys(rows[0]).slice(0,8);
    return '<div class="sd-ai-table"><table><thead><tr>'+
      cols.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.slice(0,25).map(row=>'<tr>'+cols.map(c=>'<td>'+esc(row[c])+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></div>';
  }
  async function ask(question){
    const input=$('sdAiQuestion'),button=$('sdAiAsk'),out=$('sdAiAnswer');
    const q=(question||input?.value||'').trim();
    if(q.length<3)return;
    input.value=q;busy(button,true,'Analyzing…');
    out.textContent='Reviewing the latest available academy records…';
    try{
      const result=await SkyDreamFirebase.call('adminAiCommandCenter',{question:q});
      out.innerHTML='<p class="sd-ai-output">'+esc(result.answer)+'</p>'+
        '<p class="sd-ai-meta">'+esc(result.mode==='ai'?'AI-assisted summary':'Guided data summary')+
        ' · '+esc(result.asOf||'')+' · Read-only</p>'+table(result.rows);
    }catch(e){out.textContent=error(e);}
    finally{busy(button,false);}
  }
  async function guardian(){
    const button=$('sdAiScan'),out=$('sdAiGuardianOutput');
    busy(button,true,'Checking…');out.textContent='Checking registration, payment and attendance integrity…';
    try{
      const result=await SkyDreamFirebase.call('adminAiDataGuardian',{});
      const heading='<div class="card"><strong>'+esc(result.total)+' potential issue(s)</strong>'+
        '<p>'+esc(result.counts.high)+' high priority · '+esc(result.counts.medium)+' medium priority · '+
        esc(result.scanned.students)+' students reviewed</p>'+
        '<small>No records were changed. Investigate findings before taking action.</small></div>';
      const findings=(result.findings||[]).map(f=>
        '<div class="sd-ai-find"><strong class="'+(f.severity==='high'?'sd-ai-high':'sd-ai-warn')+'">'+
        esc(f.severity.toUpperCase())+' · '+esc(f.title)+'</strong><p>'+esc(f.detail)+'</p>'+
        '<p class="sd-ai-meta">Student IDs: '+esc((f.studentIds||[]).join(', ')||'Not available')+'</p>'+
        '<p>'+esc(f.advice)+'</p></div>').join('');
      out.innerHTML=heading+findings+(result.truncated?'<p>More issues exist; shown are the first 100.</p>':'');
    }catch(e){out.textContent=error(e);}
    finally{busy(button,false);}
  }
  function setup(){
    if(window.SkyDreamAdminOwnerVerified!==true)return;
    nav('#aiCommandCenter','AI Command Center');
    nav('#aiDataGuardian','AI Data Guardian');
    section('aiCommandCenter','AI Command Center',
      '<div class="card"><p>Ask questions about current registrations, attendance, capacity, outstanding fees, and data quality. The AI sees only aggregate facts; individual rows stay in your protected dashboard.</p>'+
      '<label for="sdAiQuestion">Ask SkyDream</label>'+
      '<textarea id="sdAiQuestion" rows="3" maxlength="400" placeholder="Which students need attendance follow-up this week?"></textarea>'+
      '<div class="sd-ai-controls"><button id="sdAiAsk" type="button" class="btn btn-primary">Analyze</button>'+
      '<button type="button" class="btn btn-outline btn-small" data-sd-ai="Summarize the current intake">Overview</button>'+
      '<button type="button" class="btn btn-outline btn-small" data-sd-ai="Show students with low attendance">Attendance</button>'+
      '<button type="button" class="btn btn-outline btn-small" data-sd-ai="Which programmes are filling up?">Capacity</button></div>'+
      '<span class="sd-ai-pill">Read-only · Owner access</span><div id="sdAiAnswer" class="mt-14" aria-live="polite"></div></div>');
    section('aiDataGuardian','AI Data Guardian',
      '<div class="card"><p>Detect duplicate registration numbers, potentially shared mobile numbers, inconsistent payment totals, and orphaned attendance records.</p>'+
      '<button id="sdAiScan" type="button" class="btn btn-primary">Run safety scan</button>'+
      '<p class="sd-ai-meta">This is a review tool, not an automatic repair or disciplinary system.</p></div>'+
      '<div id="sdAiGuardianOutput" class="mt-14" aria-live="polite"></div>');
    $('sdAiAsk').addEventListener('click',()=>ask());
    $('sdAiScan').addEventListener('click',guardian);
    $('sdAiQuestion').addEventListener('keydown',e=>{
      if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();ask();}
    });
    document.querySelectorAll('[data-sd-ai]').forEach(button=>
      button.addEventListener('click',()=>ask(button.dataset.sdAi)));
  }
  window.addEventListener('skydream-owner-session-ready',setup);
})();
