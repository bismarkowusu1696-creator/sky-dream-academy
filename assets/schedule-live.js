(() => {
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  function formatDate(iso){
    if(!iso)return'To be announced';
    const date=new Date(iso+'T00:00:00');
    return date.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  }
  async function syncSchedule(){
    if(!window.SkyDreamFirebase)return;
    try{
      const catalog=await SkyDreamFirebase.call('publicCatalog');
      const intake=catalog?.intake||{};
      const dates=[intake.startDate,intake.classesStartDate,intake.breakStartDate,
        intake.resumeDate,intake.endDate,intake.thanksgivingDate];
      document.querySelectorAll('.schedule-row').forEach((row,i)=>{
        const el=row.querySelector('time'),value=dates[i];
        if(!el)return;
        if(value){
          row.hidden=false;el.dateTime=value;el.textContent=formatDate(value);
        }else if(row.hasAttribute('data-optional-date'))row.hidden=true;
        else{
          row.hidden=false;el.removeAttribute('datetime');el.textContent='To be announced';
        }
      });
      const title=document.getElementById('scheduleTitle');
      if(title&&intake.label)title.textContent=intake.label+' schedule';
      const intro=document.getElementById('scheduleIntro');
      if(intro&&intake.startDate&&intake.classesStartDate){
        intro.textContent='Orientation: '+formatDate(intake.startDate)+
          '. Classes begin: '+formatDate(intake.classesStartDate)+'.';
      }
      const target=document.getElementById('weeklyScheduleGrid');
      if(!target)return;
      const sessions=Array.isArray(catalog.trainingSchedule?.sessions)?
        catalog.trainingSchedule.sessions:[];
      const names=new Map((catalog.programs||[]).map(p=>[p.id,p.name]));
      const visible=sessions.slice().sort((a,b)=>days.indexOf(a.day)-days.indexOf(b.day)||
        String(a.startTime).localeCompare(String(b.startTime))||
        String(names.get(a.course)||a.course).localeCompare(String(names.get(b.course)||b.course)));
      target.innerHTML=visible.map(s=>'<article class="card"><h3>'+esc(names.get(s.course)||s.course)+'</h3>'+
        '<p><strong>'+esc(s.day)+'</strong><br>'+esc(s.startTime)+'–'+esc(s.endTime)+'</p>'+
        (s.venue?'<p class="hint">Venue: '+esc(s.venue)+'</p>':'')+'</article>').join('')||
        '<p class="hint">Specific class days and times have not been published for this intake. Please contact SkyDream for details.</p>';
    }catch(err){
      console.warn('Could not load the live intake schedule.',err);
      const target=document.getElementById('weeklyScheduleGrid');
      if(target)target.textContent='Current programme times could not be loaded. Please refresh or contact SkyDream.';
    }
  }
  document.addEventListener('DOMContentLoaded',syncSchedule);
})();