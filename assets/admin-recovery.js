(() => {
  const $ = id => document.getElementById(id);

  function strongPassword(value){
    const p=String(value||'');
    return p.length>=12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
  }
  function setMessage(text,type='info'){
    const el=$('adminRecoveryMessage');if(!el)return;
    el.textContent=text;el.className='notice notice-'+type;el.classList.remove('hidden');
  }
  function clearMessage(){const el=$('adminRecoveryMessage');if(el)el.classList.add('hidden');}
  function showRecovery(){
    clearMessage();
    $('adminLoginPanel').classList.add('hidden');
    $('adminRecoveryPanel').classList.remove('hidden');
    const current=$('adminUsername').value.trim();
    if(current&&!$('recoveryUsername').value)$('recoveryUsername').value=current;
    $('recoveryUsername').focus();
  }
  function showLogin(){
    clearMessage();
    $('adminRecoveryPanel').classList.add('hidden');
    $('adminLoginPanel').classList.remove('hidden');
    $('adminUsername').focus();
  }
  async function recover(event){
    event.preventDefault();clearMessage();
    const username=$('recoveryUsername').value.trim();
    const code=$('recoveryCode').value.trim();
    const password=$('recoveryNewPassword').value;
    const confirmPassword=$('recoveryNewPassword2').value;
    if(!strongPassword(password)){setMessage('Use at least 12 characters with uppercase, lowercase and a number.','error');return;}
    if(password!==confirmPassword){setMessage('The new passwords do not match.','error');return;}
    const button=event.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true;const old=button.textContent;button.textContent='Resetting…';
    try{
      const result=await SkyDreamFirebase.call('adminRecoverWithCode',{username,recoveryCode:code,newPassword:password});
      $('adminUsername').value=username;
      $('adminPassword').value='';
      event.currentTarget.reset();
      setMessage(`Password reset successfully. ${Number(result.remainingCodes)||0} recovery code(s) remain. Return to sign in with your new password.`,'success');
      setTimeout(()=>{showLogin();const msg=$('adminMessage');if(msg){msg.textContent='Owner password recovered. Sign in with your new password.';msg.className='notice notice-success admin-message-floating';msg.classList.remove('hidden');}},1200);
    }catch(err){setMessage(SkyDreamFirebase.friendlyError(err),'error');}
    finally{button.disabled=false;button.textContent=old;}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const show=$('showAdminRecovery'),cancel=$('cancelAdminRecovery'),form=$('adminRecoveryForm');
    if(show)show.addEventListener('click',showRecovery);
    if(cancel)cancel.addEventListener('click',showLogin);
    if(form)form.addEventListener('submit',recover);
  });
})();