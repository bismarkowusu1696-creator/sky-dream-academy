/**
 * Cloud Functions for SkyDream Skills Training Academy.
 *
 * sendFacilitatorWelcomeSms: called by the client right after a student registers.
 * Always sends the student a thank-you/registration-confirmation text, and appends
 * the assigned facilitator's name/contact when one already exists for their course.
 * The student's registration number is the only input trusted from the browser —
 * the student's phone number and the facilitator's name/contact are both looked up
 * here in Firestore, so a malicious caller can't use this function to send arbitrary
 * text to arbitrary numbers. Twilio credentials are kept as server-side secrets and
 * are never exposed to the browser.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const twilio = require('twilio');

admin.initializeApp();

const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER = defineSecret('TWILIO_FROM_NUMBER');

const STORAGE_COLLECTION = 'sdta_storage';
const STUDENTS_KEY = 'sdta_students';
const FACILITATORS_KEY = 'sdta_facilitators';
const ADMINS_KEY = 'sdta_admins';

// Mirrors the `id -> name` pairs from the PROGRAMS array in skydream-academy.html,
// so the thank-you SMS can name the program without the client sending free text.
const COURSE_NAMES = {
  'household-chemicals': 'Household Chemicals Production',
  'hair-dressing': 'Hair Dressing',
  'cosmetology': 'Cosmetology',
  'electricals': 'Electricals',
  'floral-decor': 'Floral Decor',
  'fashion-design': 'Fashion Design',
  'beading': 'Beading',
  'french': 'French Language',
  'korean': 'Korean Language',
  'pastries': 'Pastries & Baking',
  'graphic-design': 'Graphic Design',
  'barbering': 'Barbering',
  'accounting': 'Accounting'
};

// Ghana local numbers look like 0XXXXXXXXX; Twilio requires E.164 (+233XXXXXXXXX).
function toE164Ghana(local){
  const digits = String(local || '').replace(/\D/g, '');
  if(digits.startsWith('233')) return '+' + digits;
  if(digits.startsWith('0')) return '+233' + digits.slice(1);
  return digits ? '+' + digits : '';
}

exports.sendFacilitatorWelcomeSms = onCall(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER] },
  async (request) => {
    if(!request.auth){
      throw new HttpsError('unauthenticated', 'Sign-in is required.');
    }
    const regNumber = String((request.data && request.data.regNumber) || '').trim();
    if(!regNumber){
      throw new HttpsError('invalid-argument', 'regNumber is required.');
    }

    const db = admin.firestore();
    const studentsRef = db.collection(STORAGE_COLLECTION).doc(STUDENTS_KEY);
    const facilitatorsRef = db.collection(STORAGE_COLLECTION).doc(FACILITATORS_KEY);

    const [studentsSnap, facilitatorsSnap] = await Promise.all([studentsRef.get(), facilitatorsRef.get()]);
    const students = studentsSnap.exists ? JSON.parse(studentsSnap.data().value || '[]') : [];
    const student = students.find(s => s.regNumber === regNumber);
    if(!student){
      throw new HttpsError('not-found', 'No registration found for that number.');
    }
    if(student.facilitatorSmsSent){
      return { sent: false, reason: 'already-sent' };
    }

    const to = toE164Ghana(student.mobile);
    if(!to){
      return { sent: false, reason: 'no-student-number' };
    }

    const facilitators = facilitatorsSnap.exists ? JSON.parse(facilitatorsSnap.data().value || '[]') : [];
    const facilitator = facilitators.find(f => Array.isArray(f.courses) && f.courses.includes(student.course) && f.phone);
    const courseName = COURSE_NAMES[student.course] || student.course;

    let message = `Thank you for registering with SkyDream Skills Training Academy, ${student.fullName}! Your registration number for ${courseName} is ${student.regNumber}.`;
    if(facilitator){
      message += ` Your facilitator is ${facilitator.name} \u2014 contact: ${facilitator.phone}.`;
    }

    try{
      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({ body: message, from: TWILIO_FROM_NUMBER.value(), to });
    }catch(err){
      logger.error('Twilio send failed', err);
      throw new HttpsError('internal', 'Could not send the SMS.');
    }

    // Mark as sent so a retried/duplicate call doesn't re-send (and re-bill) the same text.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentsRef);
      const list = snap.exists ? JSON.parse(snap.data().value || '[]') : [];
      const idx = list.findIndex(s => s.regNumber === regNumber);
      if(idx !== -1){
        list[idx].facilitatorSmsSent = true;
        tx.set(studentsRef, { value: JSON.stringify(list) });
      }
    });

    return { sent: true, facilitatorName: facilitator ? facilitator.name : null };
  }
);

/**
 * sendCustomSms: lets an admin send a free-text text message to one specific
 * student. Because the message body is admin-authored (not a fixed template
 * like the welcome SMS above), this function re-verifies the caller's admin
 * PIN server-side on every call — the app's "admin login" is otherwise only a
 * client-side check, and every visitor shares the same anonymous Firebase Auth
 * identity, so without this check anyone with the client code could call this
 * function directly and send arbitrary texts.
 */
exports.sendCustomSms = onCall(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER] },
  async (request) => {
    if(!request.auth){
      throw new HttpsError('unauthenticated', 'Sign-in is required.');
    }
    const regNumber = String((request.data && request.data.regNumber) || '').trim();
    const message = String((request.data && request.data.message) || '').trim();
    const adminUsername = String((request.data && request.data.adminUsername) || '').trim();
    const adminPinHash = String((request.data && request.data.adminPinHash) || '').trim();
    if(!regNumber || !message || !adminUsername || !adminPinHash){
      throw new HttpsError('invalid-argument', 'regNumber, message and admin credentials are required.');
    }
    if(message.length > 480){
      throw new HttpsError('invalid-argument', 'Message is too long.');
    }

    const db = admin.firestore();
    const adminsRef = db.collection(STORAGE_COLLECTION).doc(ADMINS_KEY);
    const studentsRef = db.collection(STORAGE_COLLECTION).doc(STUDENTS_KEY);
    const [adminsSnap, studentsSnap] = await Promise.all([adminsRef.get(), studentsRef.get()]);

    const admins = adminsSnap.exists ? JSON.parse(adminsSnap.data().value || '[]') : [];
    const adminMatch = admins.find(a => a.username === adminUsername && a.pinHash === adminPinHash);
    if(!adminMatch){
      throw new HttpsError('permission-denied', 'Admin verification failed.');
    }

    const students = studentsSnap.exists ? JSON.parse(studentsSnap.data().value || '[]') : [];
    const student = students.find(s => s.regNumber === regNumber);
    if(!student){
      throw new HttpsError('not-found', 'No registration found for that number.');
    }

    const to = toE164Ghana(student.mobile);
    if(!to){
      return { sent: false, reason: 'no-student-number' };
    }

    try{
      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({ body: message, from: TWILIO_FROM_NUMBER.value(), to });
    }catch(err){
      logger.error('Twilio custom SMS send failed', err);
      throw new HttpsError('internal', 'Could not send the SMS.');
    }

    return { sent: true };
  }
);
