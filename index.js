const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('node:crypto');
initializeApp();
const db = getFirestore();
const bootstrapSecret = defineSecret('TURFBOOK_BOOTSTRAP_SECRET');

const clean = (v, max=200) => String(v ?? '').trim().slice(0,max);
const fail = (code, message) => { throw new HttpsError(code, message); };
const adminOnly = req => { if (!req.auth || req.auth.token.admin !== true) fail('permission-denied','Admin access required.'); };
const ownerOnly = req => { if (!req.auth || !req.auth.token.ownerId) fail('permission-denied','Owner access required.'); return req.auth.token.ownerId; };
const safeUser = u => ({ uid:u.uid, role:u.customClaims?.admin ? 'admin' : 'owner', ownerId:u.customClaims?.ownerId || null });
const emailForCode = code => `${crypto.createHash('sha256').update(clean(code,80).toLowerCase()).digest('hex')}@owners.turfbook.invalid`;

exports.bootstrapAdmin = onCall({ secrets:[bootstrapSecret], enforceAppCheck:false }, async req => {
  if (!req.auth) fail('unauthenticated','Sign in first with the Google account you want to use as admin.');
  const supplied = clean(req.data?.secret,300);
  const expected = bootstrapSecret.value();
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) fail('permission-denied','Invalid setup secret.');
  const user = await getAuth().getUser(req.auth.uid);
  await getAuth().setCustomUserClaims(user.uid,{ ...(user.customClaims||{}), admin:true });
  await db.doc('settings/public').set({appName:'TurfBook',currency:'₹',updatedAt:FieldValue.serverTimestamp()},{merge:true});
  const existingTurfs=await db.collection('turfs').limit(1).get();
  if(existingTurfs.empty){
    const seed=[
      {id:'t1',name:'THE ROYAL ARENA',location:'Kasaragod',price:800,formats:['5s','7s'],prices:{'5s':800,'7s':800},active:true},
      {id:'t2',name:'BLACK PITCH',location:'Udma',price:650,formats:['5s','7s'],prices:{'5s':650,'7s':650},active:true},
      {id:'t3',name:'GOLDEN GOAL',location:'Kanhangad',price:1000,formats:['5s','7s'],prices:{'5s':1000,'7s':1000},active:true},
      {id:'t4',name:'THE CHAMPIONS CLUB',location:'Bekal',price:900,formats:['5s','7s'],prices:{'5s':900,'7s':900},active:true},
      {id:'t5',name:'VICTORY GROUNDS',location:'Palakkunnu',price:700,formats:['5s','7s'],prices:{'5s':700,'7s':700},active:true},
      {id:'t6',name:'ELITE FOOTBALL HUB',location:'Kanhangad',price:850,formats:['5s','7s'],prices:{'5s':850,'7s':850},active:true}
    ];
    const batch=db.batch(); for(const t of seed){const {id,...data}=t;batch.set(db.doc(`turfs/${id}`),{...data,ownerId:'',createdAt:FieldValue.serverTimestamp()});} await batch.commit();
  }
  return { ok:true };
});

exports.createOwner = onCall(async req => {
  adminOnly(req);
  const name=clean(req.data?.name,100), code=clean(req.data?.code,80), password=String(req.data?.password||''), phone=clean(req.data?.phone,30), turfIds=Array.isArray(req.data?.turfIds)?req.data.turfIds.map(x=>clean(x,100)).slice(0,20):[];
  if (!name || !code || password.length < 10) fail('invalid-argument','Name, Owner ID and a password of at least 10 characters are required.');
  const key=code.toLowerCase();
  const ref=db.doc(`owners/${crypto.createHash('sha256').update(key).digest('hex')}`);
  const existing=await ref.get(); if(existing.exists) fail('already-exists','That Owner ID is already in use.');
  const email=emailForCode(code);
  const user=await getAuth().createUser({email,password,displayName:name,disabled:false});
  await getAuth().setCustomUserClaims(user.uid,{ownerId:ref.id});
  await ref.set({uid:user.uid,name,code,phone,active:true,turfIds,createdAt:FieldValue.serverTimestamp()});
  return {id:ref.id,name,code,phone,active:true,turfIds};
});

exports.setOwnerActive = onCall(async req => {
  adminOnly(req);
  const ownerId=clean(req.data?.ownerId,100), active=!!req.data?.active;
  const ref=db.doc(`owners/${ownerId}`), snap=await ref.get(); if(!snap.exists) fail('not-found','Owner not found.');
  await getAuth().updateUser(snap.data().uid,{disabled:!active});
  await ref.update({active,updatedAt:FieldValue.serverTimestamp()});
  return {ok:true};
});

exports.ownerLogin = onCall(async req => {
  // Firebase Auth password sign-in is performed by the client using the derived email.
  // This callable intentionally reveals no account-existence information.
  const code=clean(req.data?.code,80); if(!code) fail('invalid-argument','Enter your Owner ID.');
  return {email:emailForCode(code)};
});

exports.createBooking = onCall(async req => {
  const d=req.data||{};
  const turfId=clean(d.turfId,100), date=clean(d.date,10), time=clean(d.time,5), format=clean(d.format,20);
  const duration=Number(d.duration), name=clean(d.name,100), phone=clean(d.phone,25);
  if(!turfId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!/^([01][0-9]|2[0-3]):00$/.test(time)||!Number.isInteger(duration)||duration<1||duration>4||!name||!/^\+?[0-9 ()-]{8,20}$/.test(phone)) fail('invalid-argument','Check the booking details and try again.');
  const turfRef=db.doc(`turfs/${turfId}`), turfSnap=await turfRef.get(); if(!turfSnap.exists||turfSnap.data().active!==true) fail('not-found','This turf is not available.');
  const turf=turfSnap.data(); if(!Array.isArray(turf.formats)||!turf.formats.includes(format)) fail('invalid-argument','That format is not available at this turf.');
  const start=Number(time.slice(0,2))*60, end=start+duration*60;
  if(start<360||end>1380) fail('invalid-argument','Choose a time between 06:00 and 23:00.');
  const dayRef=db.collection('bookings');
  const result=await db.runTransaction(async tx=>{
    const existing=await tx.get(dayRef.where('turfId','==',turfId).where('date','==',date));
    const conflict=existing.docs.some(s=>{const b=s.data(); if(['Declined','Expired'].includes(b.status)) return false; const bs=Number(b.time.slice(0,2))*60+Number(b.time.slice(3,5)); return start<bs+Number(b.duration)*60&&bs<end;});
    if(conflict) fail('already-exists','Sorry, that slot is already requested or booked.');
    const price=Number(turf.prices?.[format]??turf.price??0); if(!Number.isFinite(price)||price<0) fail('failed-precondition','This turf price is not configured.');
    const ref=dayRef.doc();
    const booking={turfId,turfName:clean(turf.name,100),ownerId:clean(turf.ownerId,100),format,price,date,time,duration,name,phone,status:'Pending',payment:'Not submitted',createdAt:FieldValue.serverTimestamp()};
    tx.create(ref,booking); return {id:ref.id,...booking};
  });
  return result;
});

exports.setBookingStatus = onCall(async req => {
  const ownerId=ownerOnly(req), id=clean(req.data?.bookingId,100), status=clean(req.data?.status,20);
  if(!['Approved','Declined'].includes(status)) fail('invalid-argument','Invalid booking status.');
  const ref=db.doc(`bookings/${id}`);
  await db.runTransaction(async tx=>{const s=await tx.get(ref); if(!s.exists||s.data().ownerId!==ownerId) fail('permission-denied','This booking does not belong to your turf.'); if(s.data().status!=='Pending') fail('failed-precondition','This booking has already been handled.'); tx.update(ref,{status,updatedAt:FieldValue.serverTimestamp()});});
  return {ok:true};
});

exports.submitPaymentProof = onCall(async req => {
  const id=clean(req.data?.bookingId,100), reference=clean(req.data?.reference,100);
  if(!id || !reference) fail('invalid-argument','Booking ID and payment reference are required.');
  const ref=db.doc(`bookings/${id}`);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref); if(!snap.exists) fail('not-found','Booking not found.');
    const b=snap.data();
    if(b.status!=='Approved') fail('failed-precondition','Payment can be submitted only after approval.');
    if(b.payment==='Verified') fail('failed-precondition','Payment is already verified.');
    tx.update(ref,{payment:'Proof submitted',paymentRef:reference,paymentSubmittedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.adminUpdateBooking = onCall(async req => {
  adminOnly(req);
  const id=clean(req.data?.bookingId,100), payment=clean(req.data?.payment,30);
  if(!['Not submitted','Proof submitted','Verified','Refunded'].includes(payment)) fail('invalid-argument','Invalid payment status.');
  const ref=db.doc(`bookings/${id}`);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref); if(!snap.exists) fail('not-found','Booking not found.');
    const b=snap.data();
    if(payment==='Verified' && b.payment!=='Verified') {
      if(b.status!=='Approved') fail('failed-precondition','Only approved bookings can be verified.');
      if(!b.ownerId) fail('failed-precondition','Assign this turf to an owner before verifying payment.');
      const ownerRef=db.doc(`owners/${b.ownerId}`);
      const ledgerRef=ownerRef.collection('ledger').doc(`booking_${id}`);
      const ledger=await tx.get(ledgerRef);
      if(!ledger.exists) {
        tx.set(ledgerRef,{bookingId:id,amount:50,type:'booking-credit',createdAt:FieldValue.serverTimestamp()});
        tx.set(ownerRef,{creditBalance:FieldValue.increment(50),updatedAt:FieldValue.serverTimestamp()},{merge:true});
      }
    }
    tx.update(ref,{payment,updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.getOwnerDashboard = onCall(async req=>{
  const ownerId=ownerOnly(req);
  const [ownerSnap, bookingsSnap, turfsSnap]=await Promise.all([
    db.doc(`owners/${ownerId}`).get(),
    db.collection('bookings').where('ownerId','==',ownerId).orderBy('createdAt','desc').limit(100).get(),
    db.collection('turfs').where('ownerId','==',ownerId).get()
  ]);
  if(!ownerSnap.exists || ownerSnap.data().active!==true) fail('permission-denied','Owner account is inactive.');
  return {owner:{id:ownerId,name:ownerSnap.data().name,code:ownerSnap.data().code,creditBalance:Number(ownerSnap.data().creditBalance||0)},bookings:bookingsSnap.docs.map(d=>({id:d.id,...d.data()})),turfs:turfsSnap.docs.map(d=>({id:d.id,...d.data()}))};
});

exports.registerDeviceToken = onCall(async req=>{
  if(!req.auth) fail('unauthenticated','Sign in required.');
  const token=clean(req.data?.token,4096); if(!token) fail('invalid-argument','Device token required.');
  await db.doc(`deviceTokens/${req.auth.uid}`).set({token,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  return {ok:true};
});

exports.notifyBookingChanges = onDocumentUpdated('bookings/{bookingId}', async event=>{
  const before=event.data.before.data(), after=event.data.after.data();
  if(!before || !after) return;
  const changed=before.status!==after.status || before.payment!==after.payment;
  if(!changed) return;
  const title=after.payment==='Verified'?'Payment verified':`Booking ${after.status}`;
  const body=after.payment==='Verified'?'Your payment has been verified.':`Your TurfBook booking is now ${after.status.toLowerCase()}.`;
  await db.collection('notifications').add({bookingId:event.params.bookingId,phone:after.phone||'',ownerId:after.ownerId||'',title,body,createdAt:FieldValue.serverTimestamp(),read:false});
  const targets=[];
  if(after.ownerId){ const o=await db.doc(`owners/${after.ownerId}`).get(); if(o.exists && o.data().uid) targets.push(o.data().uid); }
  const tokens=await Promise.all(targets.map(uid=>db.doc(`deviceTokens/${uid}`).get()));
  const valid=tokens.filter(t=>t.exists && t.data().token).map(t=>t.data().token);
  if(valid.length) await getMessaging().sendEachForMulticast({tokens:valid,notification:{title,body},data:{bookingId:event.params.bookingId}});
});

exports.adminSaveTurf = onCall(async req => {
  adminOnly(req);
  const t=req.data?.turf||{}, id=clean(t.id,100); if(!id) fail('invalid-argument','Turf ID is required.');
  const formats=Array.isArray(t.formats)?t.formats.filter(x=>['5s','7s','Mini 7s'].includes(x)):[];
  if(!formats.includes('5s')||!formats.includes('7s')||formats.length>3) fail('invalid-argument','Every turf must offer 5s and 7s.');
  const miniCount=await db.collection('turfs').where('formats','array-contains','Mini 7s').get();
  if(formats.includes('Mini 7s')&&miniCount.docs.some(d=>d.id!==id)) fail('failed-precondition','Only one turf can offer Mini 7s.');
  const data={name:clean(t.name,100),location:clean(t.location,150),active:t.active!==false,ownerId:clean(t.ownerId,100),formats,prices:{'5s':Number(t.prices?.['5s']),'7s':Number(t.prices?.['7s']),'Mini 7s':Number(t.prices?.['Mini 7s']||0)},imageUrl:clean(t.imageUrl,1500000),updatedAt:FieldValue.serverTimestamp()};
  if(!data.name||!data.location||!Number.isFinite(data.prices['5s'])||!Number.isFinite(data.prices['7s'])) fail('invalid-argument','Complete turf name, location and prices.');
  await db.doc(`turfs/${id}`).set(data,{merge:true}); return {ok:true};
});

exports.adminSaveSettings = onCall(async req=>{
  adminOnly(req); const s=req.data?.settings||{};
  const data={appName:clean(s.appName,60)||'TurfBook',appIcon:clean(s.appIcon,1500000),qr:clean(s.qr,1500000),upi:clean(s.upi,100),commission:Math.max(0,Math.min(100,Number(s.commission)||0)),updatedAt:FieldValue.serverTimestamp()};
  await db.doc('settings/public').set(data,{merge:true}); return {ok:true};
});

exports.getAdminDashboard = onCall(async req=>{
  adminOnly(req);
  const [turfs,owners,bookings,settings]=await Promise.all([
    db.collection('turfs').get(),db.collection('owners').get(),
    db.collection('bookings').orderBy('createdAt','desc').limit(500).get(),db.doc('settings/public').get()
  ]);
  return {turfs:turfs.docs.map(d=>({id:d.id,...d.data()})),owners:owners.docs.map(d=>({id:d.id,name:d.data().name,code:d.data().code,phone:d.data().phone,active:d.data().active,creditBalance:Number(d.data().creditBalance||0)})),bookings:bookings.docs.map(d=>({id:d.id,...d.data()})),settings:settings.exists()?settings.data():{}};
});
