(() => {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const call=(name,data={})=>SkyDreamFirebase.call(name,data);
  let templates=[];
  function init(){
    const nav=document.querySelector('#dashboardShell .dashboard-sidebar nav'),
      main=document.querySelector('#dashboardShell .dashboard-main');
    if(!nav||!main||$('ownerDeskTemplates'))return;
    const link=document.createElement('a');
    link.href='#ownerDeskTemplates';link.textContent='Registration Message Approvals';
    nav.insertBefore(link,nav.querySelector('a[href="#account"]')||nav.querySelector('button')||null);
    const section=document.createElement('section');
    section.id='ownerDeskTemplates';section.className='dashboard-panel';
    section.innerHTML='<h2>Registration Message Templates & Approvals</h2>'+
      '<p class="hint">Only you can author or approve the messages registration staff send. Drafts are invisible to staff until approved.</p>'+
      '<div class="card"><h3>Create or edit a template</h3><form id="ownerDeskTemplateForm">'+
      '<input id="ownerDeskTemplateId" type="hidden"><div class="form-grid">'+
      '<div class="field"><label>Title</label><input id="ownerDeskTemplateTitle" maxlength="80" minlength="3" required></div>'+
      '<div class="field"><label><input id="ownerDeskTemplateApproved" type="checkbox"> Approved for staff use</label></div>'+
      '<div class="field full"><label>Message (up to 1,200 characters)</label><textarea id="ownerDeskTemplateBody" rows="5" maxlength="1200" required></textarea></div>'+
      '</div><p class="hint">Optional placeholders: {{student}}, {{program}}, {{registration}}, {{orientation_date}}.</p>'+
      '<div class="toolbar"><button id="ownerDeskTemplateSave" class="btn btn-primary" type="submit">Save template</button>'+
      '<button id="ownerDeskTemplateClear" class="btn btn-outline" type="button">Create another</button></div></form></div>'+
      '<div class="card mt-18"><div class="dashboard-top"><h3>Saved templates</h3><button id="ownerDeskTemplateRefresh" class="btn btn-outline btn-small" type="button">Refresh</button></div>'+
      '<div id="ownerDeskTemplateList"></div></div><div id="ownerDeskTemplateNotice" class="notice hidden" role="status"></div>';
    const before=$('account');
    main.insertBefore(section,before||null);
    $('ownerDeskTemplateForm').addEventListener('submit',save);
    $('ownerDeskTemplateClear').addEventListener('click',clear);
    $('ownerDeskTemplateRefresh').addEventListener('click',()=>load().catch(error=>notify(SkyDreamFirebase.friendlyError(error),'error')));
    $('ownerDeskTemplateList').addEventListener('click',event=>{
      const btn=event.target.closest('button[data-edit-template]');
      if(btn)edit(btn.dataset.editTemplate);
    });
  }
  function notify(message,type='info'){
    $('ownerDeskTemplateNotice').textContent=message;
    $('ownerDeskTemplateNotice').className='notice notice-'+type;
  }
  function clear(){
    $('ownerDeskTemplateForm').reset();
    $('ownerDeskTemplateId').value='';
    $('ownerDeskTemplateSave').textContent='Save template';
  }
  function edit(id){
    const template=templates.find(t=>t.id===id);if(!template)return;
    $('ownerDeskTemplateId').value=template.id;
    $('ownerDeskTemplateTitle').value=template.title;
    $('ownerDeskTemplateBody').value=template.body;
    $('ownerDeskTemplateApproved').checked=template.approved===true;
    $('ownerDeskTemplateSave').textContent='Save changes';
    location.hash='ownerDeskTemplates';
    $('ownerDeskTemplateTitle').focus();
  }
  function render(){
    $('ownerDeskTemplateList').innerHTML=templates.length?templates.map(t=>
      '<div class="card"><div class="dashboard-top"><strong>'+esc(t.title)+'</strong>'+
      '<span class="badge">'+(t.approved?'Approved':'Draft / Unapproved')+'</span></div>'+
      '<p class="pre-wrap">'+esc(t.body)+'</p><button type="button" class="btn btn-outline btn-small" data-edit-template="'+esc(t.id)+'">Edit / change approval</button></div>'
    ).join(''):'<p>No templates saved yet. Create the first template above.</p>';
  }
  async function load(){
    const result=await call('adminOwnerGetDeskTemplates');
    templates=result.templates||[];
    render();
  }
  async function save(event){
    event.preventDefault();
    const payload={
      id:$('ownerDeskTemplateId').value,
      title:$('ownerDeskTemplateTitle').value.trim(),
      body:$('ownerDeskTemplateBody').value.trim(),
      approved:$('ownerDeskTemplateApproved').checked
    };
    const button=$('ownerDeskTemplateSave');button.disabled=true;
    try{
      await call('adminOwnerSaveDeskTemplate',payload);
      clear();
      await load();
      notify(payload.approved?'Template saved and approved for staff.':'Template saved as a draft; staff cannot send it.','success');
    }catch(error){notify(SkyDreamFirebase.friendlyError(error),'error');}
    finally{button.disabled=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    init();
    window.addEventListener('skydream-owner-session-ready',()=>{
      load().catch(error=>notify(SkyDreamFirebase.friendlyError(error),'error'));
    });
  });
})();
