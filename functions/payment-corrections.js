'use strict';

// Pure payment correction logic. Never delete payment events or rewrite unrelated
// student records. Firestore persistence + external audit happen atomically.
function fail(code,message){
  const error=new Error(message);error.code=code;throw error;
}
function cents(value){
  const text=String(value==null?'':value).trim();
  if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(text))return null;
  const num=Number(text);
  if(!Number.isFinite(num)||num>100000)return null;
  return Math.round(num*100);
}
function paymentTotal(payments){
  let total=0;
  for(const payment of payments){
    const amount=cents(payment&&payment.amount);
    if(amount===null)fail('failed-precondition','An existing payment has an invalid amount; request a finance review.');
    total+=amount;
  }
  return total;
}
function correctPaymentInPlace(student,request,actor,now){
  if(!student||typeof student!=='object')fail('not-found','Student not found.');
  const payments=student.payments;
  if(!Array.isArray(payments)||payments.length===0)
    fail('failed-precondition','This student has no recorded payments to correct.');
  const index=request.paymentIndex;
  if(!Number.isSafeInteger(index)||index<0||index>=payments.length)
    fail('invalid-argument','Select an existing payment entry.');
  const entry=payments[index];
  if(!entry||typeof entry!=='object')
    fail('failed-precondition','Selected payment is unavailable.');
  const oldAmount=cents(entry.amount);
  const expectedAmount=cents(request.expectedAmount);
  const newAmount=cents(request.newAmount);
  if(oldAmount===null||expectedAmount===null||newAmount===null)
    fail('invalid-argument','Enter amounts in GHS with at most two decimal places.');
  if(oldAmount!==expectedAmount||String(entry.date||'')!==String(request.expectedDate||''))
    fail('aborted','The payment changed while you were editing it. Refresh and select it again.');
  if(oldAmount===newAmount)
    fail('invalid-argument','The corrected amount must differ from the original.');
  const reason=String(request.reason||'').trim();
  if(reason.length<5||reason.length>250)
    fail('invalid-argument','Enter a correction reason of 5–250 characters.');
  if(!actor||!actor.trim())fail('permission-denied','An authorized administrator is required.');
  // Do not silently change an already-inconsistent total.
  const oldTotal=paymentTotal(payments),storedTotal=cents(student.feePaid||0);
  if(storedTotal===null||storedTotal!==oldTotal)
    fail('failed-precondition','Existing payment total does not match the ledger. Nothing was changed.');
  const correction={
    correctedAt:now,correctedBy:actor.trim(),reason,
    previousAmount:oldAmount/100,newAmount:newAmount/100
  };
  const existingHistory=Array.isArray(entry.corrections)?entry.corrections:[];
  entry.corrections=[...existingHistory,correction];
  entry.amount=newAmount/100;
  student.feePaid=paymentTotal(payments)/100;
  return {studentId:student.id,registrationNumber:student.regNumber||'',
    oldAmount:oldAmount/100,newAmount:newAmount/100,
    oldTotal:oldTotal/100,newTotal:student.feePaid,
    paymentDate:String(entry.date||''),paymentIndex:index,reason,correction};
}
module.exports={cents,paymentTotal,correctPaymentInPlace};
