const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('node:crypto');

initializeApp();
const db = getFirestore();
const REGION = 'asia-south1';
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const fail = (code, message) => { throw new HttpsError(code, message); };
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const adminOnly = async req => {
  if (!req.auth) fail('unauthenticated', 'Sign in required.');
  const snapshot = await db.doc(`admins/${req.auth.uid}`).get();
  if (!snapshot.exists || snapshot.data().active !== true) fail('permission-denied', 'Admin access required.');
};
const ownerOnly = async req => {
  if (!req.auth || !req.auth.token.ownerId) fail('permission-denied', 'Owner access required.');
  const ownerId = req.auth.token.ownerId;
  const owner = await db.doc(`owners/${ownerId}`).get();
  if (!owner.exists || owner.data().active !== true || owner.data().uid !== req.auth.uid) fail('permission-denied', 'This owner account is inactive or no longer valid.');
  return ownerId;
};
const emailForCode = code => `${hash(clean(code, 80).toLowerCase())}@owners.turfbook.invalid`;
const lockRefsFor = (turfId, date, time, duration) => {
  const firstHour = Number(time.slice(0, 2));
  return Array.from({ length: Number(duration) }, (_, index) => {
    const hour = firstHour + index;
    return db.doc(`slotLocks/${hash(`${turfId}|${date}|${hour}`).slice(0, 48)}`);
  });
};

async function sendNotifications({ bookingId, booking, title, body, includeAdmins = true }) {
  const targetUids = new Set();
  if (booking.ownerId) {
    const owner = await db.doc(`owners/${booking.ownerId}`).get();
    if (owner.exists && owner.data().active === true && owner.data().uid) targetUids.add(owner.data().uid);
  }
  if (includeAdmins) {
    const admins = await db.collection('admins').where('active', '==', true).get();
    admins.docs.forEach(document => targetUids.add(document.id));
  }

  const tokens = [];
  await Promise.all([...targetUids].map(async uid => {
    await db.collection('notifications').add({
      targetUid: uid,
      bookingId,
      title,
      body,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
    });
    const tokenDoc = await db.doc(`deviceTokens/${uid}`).get();
    if (tokenDoc.exists && tokenDoc.data().token) tokens.push(tokenDoc.data().token);
  }));

  // A player can optionally register a device token at booking time; no player account is needed.
  if (booking.pushToken) tokens.push(booking.pushToken);
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length) {
    await getMessaging().sendEachForMulticast({
      tokens: uniqueTokens,
      notification: { title, body },
      data: { bookingId: String(bookingId || '') },
      android: { notification: { channelId: 'turfbook_alerts', sound: 'turfbook_alert' } },
    });
  }
}

exports.createOwner = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const name = clean(req.data?.name, 100);
  const code = clean(req.data?.code, 80);
  const password = String(req.data?.password || '');
  const phone = clean(req.data?.phone, 20);
  if (phone && !/^\d{10}$/.test(phone)) fail('invalid-argument', 'Owner phone number must contain exactly 10 digits.');
  if (!name || !code || password.length < 10) fail('invalid-argument', 'Name, Owner ID and a password of at least 10 characters are required.');
  const ownerId = hash(code.toLowerCase());
  const ownerRef = db.doc(`owners/${ownerId}`);
  if ((await ownerRef.get()).exists) fail('already-exists', 'That Owner ID is already in use.');
  const user = await getAuth().createUser({
    email: emailForCode(code), password, displayName: name, disabled: false,
  });
  try {
    await getAuth().setCustomUserClaims(user.uid, { ownerId });
    await ownerRef.set({ uid: user.uid, name, code, phone, active: true, turfIds: [], creditBalance: 0, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await getAuth().deleteUser(user.uid).catch(() => {});
    throw error;
  }
  return { id: ownerId, name, code, phone, active: true, creditBalance: 0 };
});

exports.adminUpdateOwner = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const ownerId = clean(req.data?.ownerId, 100);
  const name = clean(req.data?.name, 100);
  const phone = clean(req.data?.phone, 20);
  const active = req.data?.active !== false;
  const password = String(req.data?.password || '');
  if (!ownerId || !name) fail('invalid-argument', 'Owner and name are required.');
  if (phone && !/^\d{10}$/.test(phone)) fail('invalid-argument', 'Phone number must contain exactly 10 digits.');
  if (password && password.length < 10) fail('invalid-argument', 'Password must contain at least 10 characters.');
  const ref = db.doc(`owners/${ownerId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) fail('not-found', 'Owner not found.');
  const owner = snapshot.data();
  const turfIds = Array.isArray(req.data?.turfIds) ? req.data.turfIds.map(value => clean(value, 100)).slice(0, 20) : (owner.turfIds || []);
  await getAuth().updateUser(owner.uid, { displayName: name, disabled: !active, ...(password ? { password } : {}) });
  await ref.update({ name, phone, active, turfIds, updatedAt: FieldValue.serverTimestamp() });
  return { id: ownerId, name, phone, active, turfIds, creditBalance: Number(owner.creditBalance || 0) };
});

exports.setOwnerActive = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const ownerId = clean(req.data?.ownerId, 100);
  const active = !!req.data?.active;
  const ref = db.doc(`owners/${ownerId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) fail('not-found', 'Owner not found.');
  await getAuth().updateUser(snapshot.data().uid, { disabled: !active });
  await ref.update({ active, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.ownerLogin = onCall({ region: REGION }, async req => {
  const code = clean(req.data?.code, 80);
  if (!code) fail('invalid-argument', 'Enter your Owner ID.');
  return { email: emailForCode(code) };
});

exports.createBooking = onCall({ region: REGION }, async req => {
  const data = req.data || {};
  const turfId = clean(data.turfId, 100);
  const date = clean(data.date, 10);
  const time = clean(data.time, 5);
  const format = clean(data.format, 20);
  const duration = Number(data.duration);
  const name = clean(data.name, 100);
  const phone = clean(data.phone, 20);
  const pushToken = clean(data.pushToken, 4096);
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const validCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date;
  if (!turfId || !validCalendarDate || !/^([01]\d|2[0-3]):00$/.test(time) ||
      !Number.isInteger(duration) || duration < 1 || duration > 4 || !name || !/^\d{10}$/.test(phone)) {
    fail('invalid-argument', 'Enter a valid date, hourly start time, duration, name and exactly 10 phone digits.');
  }
  const turfRef = db.doc(`turfs/${turfId}`);
  const turfSnapshot = await turfRef.get();
  if (!turfSnapshot.exists || turfSnapshot.data().active !== true) fail('not-found', 'This turf is not available.');
  const turf = turfSnapshot.data();
  if (!Array.isArray(turf.formats) || !turf.formats.includes(format)) fail('invalid-argument', 'That format is not available at this turf.');
  const start = Number(time.slice(0, 2)) * 60;
  const end = start + duration * 60;
  if (start < 360 || end > 1380) fail('invalid-argument', 'Choose a time between 06:00 and 23:00.');
  const indiaParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const todayIndia = `${indiaParts.year}-${indiaParts.month}-${indiaParts.day}`;
  const currentMinutesIndia = Number(indiaParts.hour) * 60 + Number(indiaParts.minute);
  if (date < todayIndia || (date === todayIndia && start <= currentMinutesIndia)) {
    fail('invalid-argument', 'Choose a future booking date and start time.');
  }
  const price = Number(turf.prices?.[format] ?? turf.price ?? 0);
  if (!Number.isFinite(price) || price <= 0) fail('failed-precondition', 'This turf price is not configured.');

  const accessCode = crypto.randomBytes(10).toString('hex').toUpperCase();
  const slotLockRefs = lockRefsFor(turfId, date, time, duration);
  const bookingRef = db.collection('bookings').doc();
  const booking = {
    turfId,
    turfName: clean(turf.name, 100),
    ownerId: clean(turf.ownerId, 100),
    format,
    price,
    date,
    time,
    duration,
    name,
    phone,
    status: 'Pending',
    payment: 'Not submitted',
    accessCodeHash: hash(accessCode),
    ...(pushToken ? { pushToken } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.runTransaction(async transaction => {
    // Check older bookings too, so records created before slot locks are migrated safely.
    const existingQuery = db.collection('bookings').where('turfId', '==', turfId).where('date', '==', date);
    const [existing, locks] = await Promise.all([
      transaction.get(existingQuery),
      transaction.getAll(...slotLockRefs),
    ]);
    const overlaps = existing.docs.some(document => {
      const prior = document.data();
      if (['Declined', 'Expired'].includes(prior.status)) return false;
      const priorStart = Number(String(prior.time).slice(0, 2)) * 60 + Number(String(prior.time).slice(3, 5));
      return start < priorStart + Number(prior.duration) * 60 && priorStart < end;
    });
    if (overlaps || locks.some(snapshot => snapshot.exists)) fail('already-exists', 'Sorry, that slot is already requested or booked.');
    transaction.create(bookingRef, booking);
    slotLockRefs.forEach((reference, index) => transaction.create(reference, {
      bookingId: bookingRef.id, turfId, date, hour: Number(time.slice(0, 2)) + index,
      createdAt: FieldValue.serverTimestamp(),
    }));
  });

  return { id: bookingRef.id, accessCode };
});

exports.getCustomerBooking = onCall({ region: REGION }, async req => {
  const id = clean(req.data?.bookingId, 100);
  const accessCode = clean(req.data?.accessCode, 20).toUpperCase();
  if (!id || !/^[A-F0-9]{20}$/.test(accessCode)) fail('invalid-argument', 'Enter the booking ID and access code.');
  const snapshot = await db.doc(`bookings/${id}`).get();
  if (!snapshot.exists || snapshot.data().accessCodeHash !== hash(accessCode)) fail('permission-denied', 'Booking ID or access code is incorrect.');
  const booking = snapshot.data();
  const settings = await db.doc('settings/public').get();
  return {
    booking: {
      id: snapshot.id, turfId: booking.turfId, turfName: booking.turfName, format: booking.format,
      price: booking.price, date: booking.date, time: booking.time, duration: booking.duration,
      status: booking.status, payment: booking.payment, paymentRef: booking.paymentRef || '',
      name: booking.name,
    },
    settings: settings.exists() ? { qr: settings.data().qr || '', upi: settings.data().upi || '' } : { qr: '', upi: '' },
  };
});

exports.setBookingStatus = onCall({ region: REGION }, async req => {
  if (!req.auth) fail('unauthenticated', 'Sign in required.');
  const adminSnapshot = await db.doc(`admins/${req.auth.uid}`).get();
  const isAdmin = adminSnapshot.exists && adminSnapshot.data().active === true;
  const ownerId = isAdmin ? null : await ownerOnly(req);
  const id = clean(req.data?.bookingId, 100);
  const status = clean(req.data?.status, 20);
  if (!['Approved', 'Declined'].includes(status)) fail('invalid-argument', 'Invalid booking status.');
  const ref = db.doc(`bookings/${id}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || (!isAdmin && snapshot.data().ownerId !== ownerId)) fail('permission-denied', 'This booking does not belong to your turf.');
    const booking = snapshot.data();
    if (booking.status !== 'Pending') fail('failed-precondition', 'This booking has already been handled.');
    let lockSnapshots = [];
    let lockRefs = [];
    if (status === 'Declined') {
      lockRefs = lockRefsFor(booking.turfId, booking.date, booking.time, booking.duration);
      lockSnapshots = await transaction.getAll(...lockRefs);
    }
    transaction.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
    if (status === 'Declined') lockSnapshots.forEach((lock, index) => { if (lock.exists && lock.data().bookingId === id) transaction.delete(lockRefs[index]); });
  });
  return { ok: true };
});

exports.submitPaymentProof = onCall({ region: REGION }, async req => {
  const id = clean(req.data?.bookingId, 100);
  const reference = clean(req.data?.reference, 100);
  const accessCode = clean(req.data?.accessCode, 20).toUpperCase();
  if (!id || !reference || !/^[A-F0-9]{20}$/.test(accessCode)) fail('invalid-argument', 'Booking ID, access code and payment reference are required.');
  const ref = db.doc(`bookings/${id}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().accessCodeHash !== hash(accessCode)) fail('permission-denied', 'Booking ID or access code is incorrect.');
    const booking = snapshot.data();
    if (booking.status !== 'Approved') fail('failed-precondition', 'Payment can be submitted only after approval.');
    if (booking.payment === 'Verified') fail('failed-precondition', 'Payment is already verified.');
    transaction.update(ref, { payment: 'Proof submitted', paymentRef: reference, paymentSubmittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

exports.adminUpdateBooking = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const id = clean(req.data?.bookingId, 100);
  const payment = clean(req.data?.payment, 30);
  if (!['Not submitted', 'Proof submitted', 'Verified', 'Refunded'].includes(payment)) fail('invalid-argument', 'Invalid payment status.');
  const ref = db.doc(`bookings/${id}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('not-found', 'Booking not found.');
    const booking = snapshot.data();
    if (payment === 'Verified' && booking.payment !== 'Verified') {
      if (booking.status !== 'Approved') fail('failed-precondition', 'Only approved bookings can be verified.');
      if (!booking.ownerId) fail('failed-precondition', 'Assign this turf to an owner before verifying payment.');
      const ownerRef = db.doc(`owners/${booking.ownerId}`);
      const ledgerRef = ownerRef.collection('ledger').doc(`booking_${id}`);
      const ledger = await transaction.get(ledgerRef);
      if (!ledger.exists) {
        transaction.create(ledgerRef, { bookingId: id, amount: 50, type: 'booking-credit', createdAt: FieldValue.serverTimestamp() });
        transaction.set(ownerRef, { creditBalance: FieldValue.increment(50), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
    transaction.update(ref, { payment, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

exports.getOwnerDashboard = onCall({ region: REGION }, async req => {
  const ownerId = await ownerOnly(req);
  const [ownerSnapshot, bookingsSnapshot, turfsSnapshot] = await Promise.all([
    db.doc(`owners/${ownerId}`).get(),
    db.collection('bookings').where('ownerId', '==', ownerId).orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('turfs').where('ownerId', '==', ownerId).get(),
  ]);
  if (!ownerSnapshot.exists || ownerSnapshot.data().active !== true) fail('permission-denied', 'Owner account is inactive.');
  return {
    owner: { id: ownerId, name: ownerSnapshot.data().name, code: ownerSnapshot.data().code, creditBalance: Number(ownerSnapshot.data().creditBalance || 0) },
    bookings: bookingsSnapshot.docs.map(document => { const { accessCodeHash, pushToken, ...booking } = document.data(); return { id: document.id, ...booking }; }),
    turfs: turfsSnapshot.docs.map(document => ({ id: document.id, ...document.data() })),
  };
});

exports.registerDeviceToken = onCall({ region: REGION }, async req => {
  if (!req.auth) fail('unauthenticated', 'Sign in required.');
  const token = clean(req.data?.token, 4096);
  if (!token) fail('invalid-argument', 'Device token required.');
  await db.doc(`deviceTokens/${req.auth.uid}`).set({ token, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

exports.notifyBookingCreated = onDocumentCreated({ document: 'bookings/{bookingId}', region: REGION }, async event => {
  const booking = event.data?.data();
  if (!booking) return;
  await sendNotifications({
    bookingId: event.params.bookingId,
    booking,
    title: 'New TurfBook booking',
    body: `${booking.turfName}: a new ${booking.format} request is waiting for review.`,
  });
});

exports.notifyBookingChanges = onDocumentUpdated({ document: 'bookings/{bookingId}', region: REGION }, async event => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after || (before.status === after.status && before.payment === after.payment)) return;
  let title;
  let body;
  if (before.payment !== after.payment) {
    title = after.payment === 'Verified' ? 'Payment verified' : after.payment === 'Proof submitted' ? 'Payment proof received' : 'Payment status updated';
    body = after.payment === 'Verified'
      ? 'Your TurfBook payment has been verified.'
      : after.payment === 'Proof submitted'
        ? 'Your payment reference was submitted and is waiting for admin review.'
        : `Your payment status is now ${String(after.payment).toLowerCase()}.`;
  } else {
    title = `Booking ${after.status}`;
    body = `Your TurfBook booking is now ${String(after.status).toLowerCase()}.`;
  }
  await sendNotifications({ bookingId: event.params.bookingId, booking: after, title, body });
});

exports.adminSaveTurf = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const turf = req.data?.turf || {};
  const id = clean(turf.id, 100);
  if (!id) fail('invalid-argument', 'Turf ID is required.');
  const formats = Array.isArray(turf.formats) ? [...new Set(turf.formats.filter(value => ['5s', '7s', 'Mini 7s'].includes(value)))] : [];
  if (!formats.includes('5s') || !formats.includes('7s') || formats.length > 3) fail('invalid-argument', 'Every turf must offer 5s and 7s.');
  const prices = {
    '5s': Number(turf.prices?.['5s']),
    '7s': Number(turf.prices?.['7s']),
    'Mini 7s': Number(turf.prices?.['Mini 7s'] || 0),
  };
  const rawImageUrl = String(turf.imageUrl ?? '').trim();
  if (rawImageUrl.length > 450000) fail('invalid-argument', 'Turf image is too large. Choose a smaller image.');
  const imageUrl = clean(rawImageUrl, 450000);
  if (!clean(turf.name, 100) || !clean(turf.location, 150) || !Number.isFinite(prices['5s']) || prices['5s'] <= 0 || !Number.isFinite(prices['7s']) || prices['7s'] <= 0) fail('invalid-argument', 'Complete turf name, location and positive 5s and 7s prices.');
  if (formats.includes('Mini 7s') && (!Number.isFinite(prices['Mini 7s']) || prices['Mini 7s'] <= 0)) fail('invalid-argument', 'Mini 7s needs its own positive hourly price.');
  const constraintRef = db.doc('settings/constraints');
  const turfRef = db.doc(`turfs/${id}`);
  const data = {
    name: clean(turf.name, 100), location: clean(turf.location, 150), active: turf.active !== false,
    ownerId: clean(turf.ownerId, 100), formats, prices, price: prices['7s'], imageUrl,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.runTransaction(async transaction => {
    const constraintSnapshot = await transaction.get(constraintRef);
    let mini7TurfId = constraintSnapshot.exists ? (constraintSnapshot.data().mini7TurfId || '') : '';
    if (!constraintSnapshot.exists) {
      const legacyMini7 = await transaction.get(db.collection('turfs').where('formats', 'array-contains', 'Mini 7s'));
      mini7TurfId = legacyMini7.docs[0]?.id || '';
    }
    if (formats.includes('Mini 7s') && mini7TurfId && mini7TurfId !== id) fail('failed-precondition', 'Only one turf can offer Mini 7s.');
    if (formats.includes('Mini 7s')) mini7TurfId = id;
    else if (mini7TurfId === id) mini7TurfId = '';
    transaction.set(turfRef, data, { merge: true });
    transaction.set(constraintRef, { mini7TurfId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { ok: true };
});

exports.adminDeleteTurf = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const id = clean(req.data?.turfId, 100);
  if (!id) fail('invalid-argument', 'Turf ID is required.');
  const ref = db.doc(`turfs/${id}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) fail('not-found', 'Turf not found.');
  await ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.adminSaveSettings = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const settings = req.data?.settings || {};
  const rawAppIcon = String(settings.appIcon ?? '').trim();
  const rawQr = String(settings.qr ?? '').trim();
  const rawNoticeImage = String(settings.noticeBoard?.image ?? '').trim();
  if (rawAppIcon.length > 300000 || rawQr.length > 300000 || rawNoticeImage.length > 300000) {
    fail('invalid-argument', 'One of the uploaded images is too large. Choose smaller images.');
  }
  const appIcon = clean(rawAppIcon, 300000);
  const qr = clean(rawQr, 300000);
  const noticeBoard = {
    enabled: settings.noticeBoard?.enabled === true,
    message: clean(settings.noticeBoard?.message, 1200),
    image: clean(rawNoticeImage, 300000),
  };
  if (Buffer.byteLength(JSON.stringify({ appIcon, qr, noticeBoard }), 'utf8') > 700000) fail('invalid-argument', 'The QR, app icon and notice image are too large together. Use smaller images.');
  await db.doc('settings/public').set({
    appName: clean(settings.appName, 60) || 'TurfBook', appIcon, qr,
    upi: clean(settings.upi, 100), commission: Math.max(0, Math.min(100, Number(settings.commission) || 0)),
    noticeBoard, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

exports.getAdminDashboard = onCall({ region: REGION }, async req => {
  await adminOnly(req);
  const [turfs, owners, bookings, settings] = await Promise.all([
    db.collection('turfs').get(),
    db.collection('owners').get(),
    db.collection('bookings').orderBy('createdAt', 'desc').limit(500).get(),
    db.doc('settings/public').get(),
  ]);
  return {
    turfs: turfs.docs.map(document => ({ id: document.id, ...document.data() })),
    owners: owners.docs.map(document => ({ id: document.id, name: document.data().name, code: document.data().code, phone: document.data().phone, active: document.data().active, creditBalance: Number(document.data().creditBalance || 0) })),
    bookings: bookings.docs.map(document => { const { accessCodeHash, pushToken, ...booking } = document.data(); return { id: document.id, ...booking }; }),
    settings: settings.exists() ? settings.data() : {},
  };
});
