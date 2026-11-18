import React, { useEffect, useMemo, useState } from "react";
import { Trophy, MapPin, Search, ArrowRight, CalendarDays, Clock3, ShieldCheck, User, LockKeyhole, LogOut, Plus, Pencil, Trash2, Check, X, Upload, Wallet, Settings, LayoutDashboard, CircleDollarSign, QrCode, Menu } from "lucide-react";
import "./style.css";
import { firebaseConfigured, auth, call, ownerSignIn, adminSignIn, isRegisteredAdmin, watchTurfs, watchSettings, registerWebPush, listenForWebMessages, signOutTurfBook as firebaseSignOut } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db as firestore } from "./firebase";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const seedTurfs = [
  {id:"t1",name:"THE ROYAL ARENA",location:"Kasaragod",price:800,formats:["5s","7s"],prices:{"5s":800,"7s":800},active:true},
  {id:"t2",name:"BLACK PITCH",location:"Udma",price:650,formats:["5s","7s"],prices:{"5s":650,"7s":650},active:true},
  {id:"t3",name:"GOLDEN GOAL",location:"Kanhangad",price:1000,formats:["5s","7s"],prices:{"5s":1000,"7s":1000},active:true},
  {id:"t4",name:"THE CHAMPIONS CLUB",location:"Bekal",price:900,formats:["5s","7s"],prices:{"5s":900,"7s":900},active:true},
  {id:"t5",name:"VICTORY GROUNDS",location:"Palakkunnu",price:700,formats:["5s","7s"],prices:{"5s":700,"7s":700},active:true},
  {id:"t6",name:"ELITE FOOTBALL HUB",location:"Kanhangad",price:850,formats:["5s","7s"],prices:{"5s":850,"7s":850},active:true}
];
const initial = {
  turfs:seedTurfs, owners:[], bookings:[], qr:"", upi:"", commission:10,
  appName:"TurfBook", appIcon:"", announcement:"", noticeBoard:{enabled:false,message:"",image:""}, currency:"₹"
};
const read = () => { try { const d={...initial,...JSON.parse(localStorage.getItem("turfbook-data")||"{}")} ; if(d.appName==="TURFBOOK")d.appName="TurfBook"; d.turfs=(d.turfs||seedTurfs).map(t=>({...t,formats:t.formats||["5s","7s"],prices:t.prices||{"5s":Number(t.price||800),"7s":Number(t.price||800)}})); let miniUsed=false; d.turfs=d.turfs.map(t=>{if((t.formats||[]).includes("Mini 7s")){if(miniUsed)return {...t,formats:t.formats.filter(f=>f!=="Mini 7s")};miniUsed=true;}return t;}); return d; } catch { return initial; } };
const uid = () => Math.random().toString(36).slice(2,10);
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const money = n => `₹${Number(n||0).toLocaleString("en-IN")}`;
const times = Array.from({length:17},(_,i)=>`${String(i+6).padStart(2,"0")}:00`);

function App(){
  const [db,setDb] = useState(()=>firebaseConfigured ? {...initial,turfs:[],owners:[],bookings:[]} : read());
  const [page,setPage] = useState("home");
  const [search,setSearch] = useState("");
  const [trackPhone,setTrackPhone] = useState("");
  const [modal,setModal] = useState("");
  const [chosen,setChosen] = useState(null);
  const [form,setForm] = useState({});
  const [notice,setNotice] = useState("");
  const [user,setUser] = useState(null);
  const [admin,setAdmin] = useState(false);
  const [cloudReady,setCloudReady] = useState(!firebaseConfigured);
  const [cloudError,setCloudError] = useState("");
  const [ownerId,setOwnerId] = useState("");
  const [ownerPass,setOwnerPass] = useState("");
  const [tab,setTab] = useState("Pending");
  const [menu,setMenu] = useState(false);
  const [nativePushToken,setNativePushToken] = useState("");
  const [trackingId,setTrackingId] = useState("");
  const [trackingCode,setTrackingCode] = useState("");
  const [customerBooking,setCustomerBooking] = useState(null);
  const [bookingReceipt,setBookingReceipt] = useState(null);

  useEffect(()=>{ if(!firebaseConfigured){localStorage.setItem("turfbook-data",JSON.stringify(db));} },[db]);

  useEffect(()=>{
    if(!Capacitor.isNativePlatform()) return;
    let registrationListener, receivedListener, errorListener;
    (async()=>{
      try {
        await PushNotifications.createChannel({id:"turfbook_alerts",name:"TurfBook booking updates",description:"Booking and payment updates",importance:5,visibility:1,sound:"turfbook_alert",vibration:true});
        registrationListener=await PushNotifications.addListener("registration", token=>setNativePushToken(token.value));
        receivedListener=await PushNotifications.addListener("pushNotificationReceived", notification=>{
          const sound=new Audio("/notification.wav"); sound.play().catch(()=>{});
          if(typeof navigator!=="undefined"&&navigator.vibrate)navigator.vibrate([180,80,180]);
          toast(`${notification.title||"TurfBook update"}: ${notification.body||"You have a new notification."}`);
        });
        errorListener=await PushNotifications.addListener("registrationError", error=>setCloudError(error?.error||"Push notification registration failed."));
        const permission=await PushNotifications.checkPermissions();
        if(permission.receive==="granted") await PushNotifications.register();
      } catch(error){ setCloudError(error.message||"Push notifications could not be initialized."); }
    })();
    return ()=>{registrationListener?.remove();receivedListener?.remove();errorListener?.remove();};
  },[]);

  useEffect(()=>{
    if(!firebaseConfigured||!user||!nativePushToken) return;
    call("registerDeviceToken",{token:nativePushToken}).catch(error=>setCloudError(error.message||"Could not register this device for notifications."));
  },[user,nativePushToken]);

  useEffect(()=>{
    if(!firebaseConfigured||Capacitor.isNativePlatform()) return;
    let off=()=>{};
    listenForWebMessages(payload=>{
      const title=payload.notification?.title||"TurfBook update";
      const body=payload.notification?.body||"You have a new notification.";
      new Audio("/notification.wav").play().catch(()=>{});
      if(typeof navigator!=="undefined"&&navigator.vibrate)navigator.vibrate([180,80,180]);
      toast(`${title}: ${body}`);
    }).then(unsubscribe=>{off=unsubscribe;}).catch(error=>setCloudError(error.message||"Web push listener could not start."));
    return ()=>off();
  },[]);

  useEffect(()=>{
    if(!firebaseConfigured||!user||Capacitor.isNativePlatform()) return;
    registerWebPush({requestPermission:true}).then(token=>token?call("registerDeviceToken",{token}):null).catch(error=>setCloudError(error.message||"Web push notifications could not be registered."));
  },[user]);

  useEffect(()=>{
    if(!firebaseConfigured||!user?.id) return;
    const notificationQuery=query(collection(firestore,"notifications"),where("targetUid","==",user.uid||user.id));
    let first=true;
    const off=onSnapshot(notificationQuery,snapshot=>{
      if(first){first=false;return;}
      snapshot.docChanges().filter(change=>change.type==="added").forEach(change=>{
        const item=change.doc.data();
        const sound=new Audio("/notification.wav"); sound.play().catch(()=>{});
        if(typeof navigator!=="undefined"&&navigator.vibrate)navigator.vibrate([180,80,180]);
        toast(`${item.title||"TurfBook update"}: ${item.body||"You have a new notification."}`);
        if(user.role==="owner") {
          call("getOwnerDashboard",{}).then(data=>{
            setUser(current=>current?({...current,creditBalance:data.owner.creditBalance}):current);
            setDb(current=>({...current,bookings:data.bookings,turfs:data.turfs}));
          }).catch(()=>{});
        } else if(user.role==="admin") {
          call("getAdminDashboard",{}).then(data=>setDb(current=>({...current,bookings:data.bookings,turfs:data.turfs,owners:data.owners,...data.settings}))).catch(()=>{});
        }
      });
    },error=>setCloudError(error.message));
    return ()=>off();
  },[user]);
  useEffect(()=>{
    if(!firebaseConfigured){setCloudError("Firebase web configuration is missing. Cloud booking is disabled.");return;}
    const offTurfs=watchTurfs(rows=>setDb(d=>({...d,turfs:rows})));
    const offSettings=watchSettings(v=>setDb(d=>({...d,...v})));
    const offAuth=onAuthStateChanged(auth, async u=>{
      if(!u){setUser(null);setAdmin(false);setCloudReady(true);return;}
      try {
        if (Capacitor.isNativePlatform()) {
          const pushPermission = await PushNotifications.requestPermissions();
          if (pushPermission.receive === "granted") await PushNotifications.register();
        }
        const token=await u.getIdTokenResult(true);
        if(token.claims.ownerId){
          const data=await call("getOwnerDashboard",{});
          setUser({role:"owner",id:data.owner.id,uid:u.uid,name:data.owner.name,code:data.owner.code,creditBalance:data.owner.creditBalance});
          setDb(d=>({...d,bookings:data.bookings,turfs:data.turfs}));setPage("owner");
        } else if(await isRegisteredAdmin(u)){
          const data=await call("getAdminDashboard",{});
          setUser({role:"admin",id:u.uid,uid:u.uid,name:u.displayName||"TurfBook Admin"});setAdmin(true);
          setDb(d=>({...d,bookings:data.bookings,turfs:data.turfs,owners:data.owners,...data.settings}));setPage("admin");
        }
      } catch(e){setCloudError(e.message||"Unable to load cloud dashboard.");}
      finally{setCloudReady(true);}
    });
    return ()=>{offTurfs();offSettings();offAuth();};
  },[]);
  const activeTurfs = db.turfs.filter(t=>t.active);
  const visibleTurfs = activeTurfs.filter(t=>(t.name+" "+t.location+" "+(t.formats||[t.format]).join(" ")).toLowerCase().includes(search.toLowerCase()));
  const myTurfIds = user?.role==="owner" ? db.turfs.filter(t=>t.ownerId===user.id).map(t=>t.id) : [];
  const ownBookings = db.bookings.filter(b=>myTurfIds.includes(b.turfId));
  const adminMode = admin && user?.role==="admin";
  const adminBookings = db.bookings;
  const set = (k,v)=>setForm(p=>({...p,[k]:v}));
  const toast = msg=>{setNotice(msg);setTimeout(()=>setNotice(""),3500)};
  async function loginOwner(e){e.preventDefault();if(!firebaseConfigured)return toast("Cloud login is not configured yet.");try{await ownerSignIn(ownerId.trim(),ownerPass);setOwnerId("");setOwnerPass("");}catch(err){toast(err.message||"Owner ID or password is incorrect.");}}
  async function loginAdmin(e){e.preventDefault();if(!firebaseConfigured)return toast("Firebase web configuration is missing.");try{await adminSignIn();}catch(err){toast(err.message||"Admin sign-in failed.");}}
  async function logout(){try{if(firebaseConfigured)await firebaseSignOut(auth);}catch{}setUser(null);setAdmin(false);setPage("home");}
  function openBooking(t){setChosen(t);const fs=t.formats||[t.format||"7s"];setForm({date:today(),time:"18:00",duration:"1",format:fs[0],name:"",phone:""});setModal("book");}
  async function requestBooking(e){
    e.preventDefault();
    if(!chosen)return;
    if(!/^\d{10}$/.test(form.phone||"")) return toast("Phone number must contain exactly 10 digits.");
    if(firebaseConfigured){try{let pushToken=nativePushToken;if(Capacitor.isNativePlatform()&&!pushToken){const permission=await PushNotifications.requestPermissions();if(permission.receive==="granted"){pushToken=await new Promise(async(resolve)=>{let listener;const timer=setTimeout(()=>{listener?.remove();resolve("");},9000);listener=await PushNotifications.addListener("registration",token=>{clearTimeout(timer);listener?.remove();setNativePushToken(token.value);resolve(token.value);});await PushNotifications.register();});}}else if(!Capacitor.isNativePlatform()){try{pushToken=await registerWebPush({requestPermission:true})||"";}catch{pushToken="";}}const result=await call("createBooking",{turfId:chosen.id,date:form.date,time:form.time,duration:Number(form.duration),format:form.format,name:form.name,phone:form.phone,pushToken});setTrackPhone(form.phone);setTrackingId(result.id);setTrackingCode(result.accessCode);setBookingReceipt({id:result.id,accessCode:result.accessCode});setModal("");setPage("track");toast("Booking request sent. Save your booking ID and access code to check it later.");await lookupCustomerBooking(result.id,result.accessCode);}catch(err){toast(err.message||"Could not create booking.");}return;}
    if(db.bookings.some(b=>b.turfId===chosen.id&&b.date===form.date&&b.status!=="Declined"&&b.status!=="Expired"&&overlap(b.time,b.duration,form.time,form.duration)))return toast("Sorry, that slot is already requested or booked.");
    const selectedPrice=Number(chosen.prices?.[form.format]??chosen.price??0);const b={id:uid(),turfId:chosen.id,turfName:chosen.name,ownerId:chosen.ownerId||"",format:form.format,price:selectedPrice,date:form.date,time:form.time,duration:Number(form.duration),name:form.name,phone:form.phone,status:"Pending",payment:"Not submitted",created:new Date().toISOString()};
    setDb(d=>({...d,bookings:[b,...d.bookings]}));setTrackPhone(form.phone);setTrackingId(b.id);setTrackingCode("LOCAL-DEMO");setCustomerBooking({booking:b,settings:{qr:db.qr,upi:db.upi}});setModal("");setPage("track");toast("Local demo booking saved on this device only.");
  }
  async function lookupCustomerBooking(id=trackingId,code=trackingCode){
    if(!firebaseConfigured)return toast("Cloud booking lookup is not configured.");
    try{const result=await call("getCustomerBooking",{bookingId:id.trim(),accessCode:code.trim()});setCustomerBooking(result);setTrackingId(id.trim());setTrackingCode(code.trim());}catch(error){setCustomerBooking(null);toast(error.message||"Could not find that booking.");}
  }
  async function sendCustomerPaymentProof(bookingId,reference){
    if(!reference.trim())return toast("Enter your transaction reference.");
    try{await call("submitPaymentProof",{bookingId,accessCode:trackingCode,reference:reference.trim()});await lookupCustomerBooking();toast("Payment reference submitted for admin verification.");}catch(error){toast(error.message||"Could not submit payment reference.");}
  }
  function overlap(a,ad,b,bd){const start=x=>Number(x.slice(0,2))*60+Number(x.slice(3,5));return start(a)<start(b)+Number(bd)*60&&start(b)<start(a)+Number(ad)*60;}
  async function ownerStatus(id,status){if(firebaseConfigured){try{await call("setBookingStatus",{bookingId:id,status});const data=user?.role==="admin"?await call("getAdminDashboard",{}):await call("getOwnerDashboard",{});setDb(d=>({...d,bookings:data.bookings}));toast("Booking updated.");}catch(e){toast(e.message||"Could not update booking.");}return;}setDb(d=>({...d,bookings:d.bookings.map(b=>b.id===id?{...b,status}:b)}));toast("Booking updated.");}
  async function saveTurf(e){e.preventDefault();if(form.mini7&&db.turfs.some(t=>t.id!==form.id&&(t.formats||[]).includes("Mini 7s")))return toast("Only one turf can offer Mini 7s. Remove it from the other turf first.");const formats=["5s","7s",...(form.mini7? ["Mini 7s"]:[])];const prices={"5s":Number(form.price5||0),"7s":Number(form.price7||0),"Mini 7s":Number(form.priceMini7||0)};const item={id:form.id||uid(),name:form.name,location:form.location,price:prices["7s"]||prices["5s"],formats,prices,active:form.active!==false,ownerId:form.ownerId||"",imageUrl:form.imageData||form.imageUrl||""};if(firebaseConfigured){try{await call("adminSaveTurf",{turf:item});const data=await call("getAdminDashboard",{});setDb(d=>({...d,turfs:data.turfs}));setModal("");toast("Turf saved to cloud.");}catch(err){toast(err.message||"Could not save turf.");}return;}setDb(d=>({...d,turfs:form.id?d.turfs.map(t=>t.id===form.id?item:t):[...d.turfs,item]}));setModal("");toast("Turf saved.");}
  async function saveOwner(e){e.preventDefault();if(firebaseConfigured){try{if(form.id){await call("adminUpdateOwner",{ownerId:form.id,name:form.name,phone:form.phone||"",active:form.active!==false,password:form.password||""});}else{await call("createOwner",{name:form.name,code:form.code.trim(),password:form.password,phone:form.phone||""});}const data=await call("getAdminDashboard",{});setDb(d=>({...d,owners:data.owners}));setModal("");toast(form.id?"Owner account updated.":"Secure owner account created.");}catch(err){toast(err.message||"Could not save owner.");}return;}const item={id:form.id||uid(),name:form.name,code:form.code.trim(),password:form.password,phone:form.phone||"",active:form.active!==false};if(!item.code||!item.password)return toast("Owner ID and password are required.");if(db.owners.some(o=>o.code.toLowerCase()===item.code.toLowerCase()&&o.id!==item.id))return toast("That Owner ID already exists.");setDb(d=>({...d,owners:form.id?d.owners.map(o=>o.id===form.id?item:o):[...d.owners,item]}));setModal("");toast("Owner account saved.");}
  async function toggleOwner(owner){if(!firebaseConfigured)return setDb(d=>({...d,owners:d.owners.map(o=>o.id===owner.id?{...o,active:!o.active}:o)}));try{await call("setOwnerActive",{ownerId:owner.id,active:!owner.active});const data=await call("getAdminDashboard",{});setDb(d=>({...d,owners:data.owners}));toast(owner.active?"Owner account disabled.":"Owner account enabled.");}catch(error){toast(error.message||"Could not update owner.");}}
  async function deleteTurf(turf){if(!firebaseConfigured)return setDb(d=>({...d,turfs:d.turfs.filter(item=>item.id!==turf.id)}));try{await call("adminDeleteTurf",{turfId:turf.id});const data=await call("getAdminDashboard",{});setDb(d=>({...d,turfs:data.turfs}));toast("Turf hidden from players. Existing booking records were kept.");}catch(error){toast(error.message||"Could not remove turf.");}}
  function fileToData(file,callback){if(!file)return;const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const max=720,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);callback(c.toDataURL("image/jpeg",.58));};img.src=r.result;};r.readAsDataURL(file);}
  async function updateBooking(id,patch){if(firebaseConfigured){try{if(patch.payment)await call("adminUpdateBooking",{bookingId:id,payment:patch.payment});const data=await call("getAdminDashboard",{});setDb(d=>({...d,bookings:data.bookings}));}catch(e){toast(e.message||"Could not update payment.");}return;}setDb(d=>({...d,bookings:d.bookings.map(b=>b.id===id?{...b,...patch}:b)}));}
  async function saveSettings(e){e.preventDefault();if(firebaseConfigured){try{await call("adminSaveSettings",{settings:{appName:db.appName,appIcon:db.appIcon,qr:db.qr,upi:db.upi,commission:db.commission,noticeBoard:db.noticeBoard}});toast("Settings saved to cloud.");}catch(err){toast(err.message||"Could not save settings.");return;}}else toast("Admin settings saved.");setModal("");}
  const revenue=db.bookings.filter(b=>b.status==="Approved"&&b.payment==="Verified").reduce((s,b)=>s+Number(b.price??db.turfs.find(t=>t.id===b.turfId)?.price??0)*b.duration,0);
  return <div className="app">{cloudError&&<div className="warningText" role="status">{cloudError}</div>}
    <header className="nav"><button className="brand" onClick={()=>setPage("home")}><span className="crest">{db.appIcon?<img src={db.appIcon} alt=""/>:<Trophy size={18}/>}</span><span>{db.appName}<small>THE GAME STARTS HERE</small></span></button><nav className={menu?"show":""}><button className={page==="home"?"active":""} onClick={()=>{setPage("home");setMenu(false)}}>Explore</button><button onClick={()=>{setPage("track");setMenu(false)}}>My booking</button><button onClick={()=>{setPage("ownerLogin");setMenu(false)}}>Owner</button><button onClick={()=>{setPage("adminLogin");setMenu(false)}}>Admin</button></nav><button className="mobile-menu" onClick={()=>setMenu(!menu)}><Menu/></button>{user&&<button className="signout" onClick={logout}><LogOut size={15}/> Sign out</button>}</header>
    {page==="home"&&<>{db.noticeBoard?.enabled&&(db.noticeBoard?.message||db.noticeBoard?.image)&&<section className="noticeBand"><ShieldCheck/><div><b>NOTICE BOARD</b><small>{db.noticeBoard.message}</small>{db.noticeBoard.image&&<img className="noticeImage" src={db.noticeBoard.image} alt="Notice"/>}</div></section>}<section className="hero"><div className="heroText"><div className="eyebrow">PREMIUM FOOTBALL TURF BOOKINGS</div><h1>YOUR GAME.<br/><em>YOUR TURF.</em></h1><p>Find your ground. Lock your slot. Own the moment.</p><button className="goldBtn" onClick={()=>document.getElementById("grounds").scrollIntoView({behavior:"smooth"})}>EXPLORE TURFS <ArrowRight size={16}/></button></div><div className="heroVisual"><div className="pitch"/><div className="ball">⚽</div><b>PLAY<br/>BOLD.</b></div><div className="heroFoot"><span>01 · FIND YOUR TURF</span><span>02 · BOOK YOUR SLOT</span><span>03 · LET'S PLAY</span></div></section><section className="steps"><span><b>01</b> CHOOSE YOUR GROUND</span><span><b>02</b> SELECT YOUR SLOT</span><span><b>03</b> CONFIRM YOUR GAME</span></section><main id="grounds" className="content"><div className="sectionTitle"><div className="eyebrow">FIND YOUR HOME GROUND</div><h2>AVAILABLE <em>TURFS</em></h2></div><div className="search"><Search size={16}/><input placeholder="Search turf or location" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="cards">{visibleTurfs.map((t,i)=><article className="turf" key={t.id}><div className={`turfImg img${i%3}`} style={t.imageUrl?{backgroundImage:`linear-gradient(#0004,#0006),url(${t.imageUrl})`,backgroundSize:"cover",backgroundPosition:"center"}:{}}><span>{(t.formats||[t.format||"7s"]).join(" · ")}</span><b>0{i+1}</b><strong>THE GAME IS ON</strong></div><div className="turfBody"><small><MapPin size={13}/>{t.location}</small><h3>{t.name}</h3><div className="turfBottom"><div><b>From {money(Math.min(...(t.formats||[t.format||"7s"]).map(f=>Number(t.prices?.[f]??t.price))))}</b><small> / hour</small></div><button onClick={()=>openBooking(t)}>BOOK NOW <ArrowRight size={14}/></button></div></div></article>)}</div>{!visibleTurfs.length&&<p className="empty">No matching turfs found.</p>}</main><section className="noticeBand"><ShieldCheck/><div><b>BOOK WITH CONFIDENCE</b><small>Owner approval first. Payment after approval.</small></div></section></>}
    {page==="track"&&<main className="dash"><div className="dashHead"><div><div className="eyebrow">PLAYER BOOKING CENTRE</div><h2>MY <em>BOOKING</em></h2><p>Use the booking ID and private access code given after booking. No player account is needed.</p></div></div>{bookingReceipt&&<section className="adminPanel trackCard"><h3>KEEP THESE BOOKING DETAILS SAFE</h3><p className="muted">Use these details to check this booking later, even from another device.</p><p><b>Booking ID:</b> {bookingReceipt.id}</p><p><b>Access code:</b> {bookingReceipt.accessCode}</p><button className="outline" onClick={()=>{navigator.clipboard?.writeText(`Booking ID: ${bookingReceipt.id}\nAccess code: ${bookingReceipt.accessCode}`);toast("Booking details copied.")}}>COPY BOOKING DETAILS</button></section>}<section className="adminPanel trackCard"><label>BOOKING ID</label><input value={trackingId} onChange={e=>setTrackingId(e.target.value)} placeholder="Enter booking ID"/><label>ACCESS CODE</label><input value={trackingCode} onChange={e=>setTrackingCode(e.target.value)} placeholder="20-character code" autoCapitalize="characters"/><button className="goldBtn full" onClick={()=>lookupCustomerBooking()}>FIND MY BOOKING</button></section>{customerBooking&&<section className="adminPanel trackCard"><div className="panelHead"><h3>{customerBooking.booking.turfName}</h3><span className={`status ${customerBooking.booking.status.toLowerCase()}`}>{customerBooking.booking.status}</span></div><p className="muted">{customerBooking.booking.date} · {customerBooking.booking.time} · {customerBooking.booking.duration} hour(s) · {customerBooking.booking.format}</p>{customerBooking.booking.status==="Approved"&&<><p className="muted">Your booking is approved. Pay using the QR below, then submit your transaction reference.</p>{customerBooking.settings.qr&&<img className="qrPreview" src={customerBooking.settings.qr} alt="Payment QR"/>}<p className="muted">UPI: {customerBooking.settings.upi||"Ask TurfBook admin for payment details"}</p><label>UPI TRANSACTION ID / REFERENCE</label><input id="customer-payment-ref" defaultValue={customerBooking.booking.paymentRef||""} placeholder="Enter transaction reference"/><button className="goldBtn full" onClick={()=>sendCustomerPaymentProof(customerBooking.booking.id,document.getElementById("customer-payment-ref").value)}>SUBMIT PAYMENT REFERENCE</button></>}{customerBooking.booking.status==="Pending"&&<p className="muted">Waiting for the turf owner to approve your request. Payment is not due yet.</p>}{customerBooking.booking.status==="Declined"&&<p className="muted">This request was declined. Please choose another slot.</p>}<p className="muted">Payment status: {customerBooking.booking.payment}</p><button className="outline" onClick={()=>lookupCustomerBooking()}>REFRESH STATUS</button></section>}</main>}
    {page==="ownerLogin"&&<LoginCard title="OWNER LOGIN" sub="Sign in with the Owner ID and password assigned by TurfBook Admin." onSubmit={loginOwner}><label>OWNER ID</label><input value={ownerId} onChange={e=>setOwnerId(e.target.value)} required placeholder="Your assigned Owner ID"/><label>PASSWORD</label><input type="password" value={ownerPass} onChange={e=>setOwnerPass(e.target.value)} required placeholder="Your password"/><button className="goldBtn full">OPEN OWNER DASHBOARD <ArrowRight size={16}/></button></LoginCard>}
    {page==="adminLogin"&&<LoginCard title="ADMIN ACCESS" sub="Sign in with the Google account registered as TurfBook admin." onSubmit={loginAdmin}><label>GOOGLE ADMIN ACCOUNT</label><p className="muted">Only the Google account whose UID is registered in Firebase can access the admin dashboard.</p><button className="goldBtn full">CONTINUE WITH GOOGLE <ArrowRight size={16}/></button></LoginCard>}
    {page==="owner"&&user?.role==="owner"&&<main className="dash"><div className="dashHead"><div><div className="eyebrow">PARTNER CONTROL CENTRE</div><h2>OWNER <em>DASHBOARD</em></h2><p>Welcome, {user.name} · ID {user.code}</p><p className="muted">Available owner credit: {money(user.creditBalance||0)}</p></div><span className="pill">OWNER ACCOUNT</span></div><div className="metricGrid"><Metric label="TOTAL REQUESTS" value={ownBookings.length}/><Metric label="PENDING" value={ownBookings.filter(b=>b.status==="Pending").length}/><Metric label="APPROVED" value={ownBookings.filter(b=>b.status==="Approved").length}/></div><div className="dashSection"><h3>BOOKING REQUESTS</h3><div className="filterTabs">{["Pending","Approved","Declined","All"].map(x=><button className={tab===x?"chosen":""} onClick={()=>setTab(x)}>{x}</button>)}</div><BookingRows bookings={ownBookings.filter(b=>tab==="All"||b.status===tab)} ownerStatus={ownerStatus}/></div><div className="paymentInfo"><Wallet/><div><b>PAYMENT & SETTLEMENT</b><small>Customers pay after approval. TurfBook Admin verifies payment and records owner settlements.</small></div></div></main>}
    {page==="admin"&&user?.role==="admin"&&<main className="dash"><div className="dashHead"><div><div className="eyebrow">PLATFORM CONTROL CENTRE</div><h2>ADMIN <em>DASHBOARD</em></h2><p>Manage your entire TurfBook platform without editing code.</p></div><button className="outline" onClick={()=>document.getElementById("admin-settings")?.scrollIntoView({behavior:"smooth"})}><Settings size={15}/> SETTINGS</button></div><div className="metricGrid"><Metric label="TOTAL TURFS" value={db.turfs.length}/><Metric label="OWNER ACCOUNTS" value={db.owners.length}/><Metric label="ALL BOOKINGS" value={db.bookings.length}/><Metric label="VERIFIED PAYMENTS" value={money(revenue)}/></div><div className="adminGrid"><section className="adminPanel"><div className="panelHead"><h3>MANAGE TURFS</h3><button className="goldMini" onClick={()=>{setForm({name:"",location:"",price5:0,price7:0,priceMini7:0,mini7:false,active:true,imageUrl:""});setModal("turf")}}><Plus size={14}/> ADD TURF</button></div>{db.turfs.map(t=><div className="manageRow" key={t.id}><div className="manageTurfInfo">{t.imageUrl&&<img src={t.imageUrl} alt=""/>}<span><b>{t.name}</b><small>{t.location} · {(t.formats||[t.format||"7s"]).join(" / ")} · {t.active?"Active":"Hidden"}</small></span></div><div className="rowBtns"><button onClick={()=>{setForm({...t,price5:t.prices?.["5s"]??t.price??800,price7:t.prices?.["7s"]??t.price??800,priceMini7:t.prices?.["Mini 7s"]??0,mini7:(t.formats||[]).includes("Mini 7s")});setModal("turf")}}><Pencil size={15}/></button><button aria-label="Hide turf" onClick={()=>deleteTurf(t)}><Trash2 size={15}/></button></div></div>)}</section><section className="adminPanel"><div className="panelHead"><h3>OWNER ACCOUNTS</h3><button className="goldMini" onClick={()=>{setForm({name:"",code:"",password:"",phone:"",active:true});setModal("owner")}}><Plus size={14}/> ADD OWNER</button></div>{db.owners.map(o=><div className="manageRow" key={o.id}><div><b>{o.name}</b><small>ID: {o.code} · {o.active?"Active":"Disabled"}</small></div><div className="rowBtns"><button onClick={()=>{setForm({...o});setModal("owner")}}><Pencil size={15}/></button><button aria-label={o.active?"Disable owner":"Enable owner"} onClick={()=>toggleOwner(o)}>{o.active?<LockKeyhole size={15}/>:<ShieldCheck size={15}/>}</button></div></div>)}{!db.owners.length&&<p className="muted">No owners yet. Create an Owner ID and password.</p>}</section></div><section className="adminPanel fullPanel"><div className="panelHead"><h3>BOOKINGS & PAYMENT VERIFICATION</h3><span className="pill">{db.bookings.length} RECORDS</span></div><BookingRows bookings={adminBookings} ownerStatus={ownerStatus} admin updateBooking={updateBooking}/></section><div className="adminGrid"><section className="adminPanel qrPanel"><div className="panelHead"><h3><QrCode size={17}/> YOUR PAYMENT QR</h3></div>{db.qr?<img className="qrPreview" src={db.qr} alt="Payment QR"/>:<div className="qrPlaceholder"><QrCode size={40}/><span>Upload your UPI QR image here</span></div>}<label className="uploadBtn"><Upload size={15}/> {db.qr?"CHANGE QR IMAGE":"UPLOAD QR IMAGE"}<input type="file" accept="image/*" onChange={e=>fileToData(e.target.files[0],v=>setDb(d=>({...d,qr:v})))}/></label><label>UPI ID / PAYMENT NOTE</label><input value={db.upi} onChange={e=>setDb(d=>({...d,upi:e.target.value}))} placeholder="yourname@upi"/></section><section className="adminPanel" id="admin-settings"><div className="panelHead"><h3>PLATFORM SETTINGS & BRANDING</h3></div><label>PLATFORM COMMISSION (%)</label><input type="number" min="0" max="100" value={db.commission} onChange={e=>setDb(d=>({...d,commission:Number(e.target.value)}))}/><label>APP DISPLAY NAME</label><input value={db.appName} onChange={e=>setDb(d=>({...d,appName:e.target.value||"TurfBook"}))}/><label>APP ICON IMAGE</label>{db.appIcon&&<img className="appIconPreview" src={db.appIcon} alt="Current app icon"/>}<label className="uploadBtn"><Upload size={15}/> UPLOAD / CHANGE APP ICON<input type="file" accept="image/*" onChange={e=>fileToData(e.target.files[0],v=>setDb(d=>({...d,appIcon:v})))}/></label><button className="goldBtn full" onClick={saveSettings}>SAVE SETTINGS <Check size={15}/></button><p className="muted">The name and icon update inside the app. Changing the Android home-screen icon or launcher name requires building and installing a new app update.</p><div className="dividerLine"/><h3>HOME PAGE NOTICE BOARD</h3><label className="checkLabel"><input type="checkbox" checked={!!db.noticeBoard?.enabled} onChange={e=>setDb(d=>({...d,noticeBoard:{...(d.noticeBoard||{}),enabled:e.target.checked}}))}/> SHOW NOTICE BOARD</label><label>ANNOUNCEMENT</label><textarea rows="3" maxLength={1200} value={db.noticeBoard?.message||""} onChange={e=>setDb(d=>({...d,noticeBoard:{...(d.noticeBoard||{}),message:e.target.value}}))} placeholder="Write an announcement for players"/><label>NOTICE IMAGE (OPTIONAL)</label>{db.noticeBoard?.image&&<img className="appIconPreview" src={db.noticeBoard.image} alt="Notice board image"/>}<label className="uploadBtn"><Upload size={15}/> UPLOAD NOTICE IMAGE<input type="file" accept="image/*" onChange={e=>fileToData(e.target.files[0],v=>setDb(d=>({...d,noticeBoard:{...(d.noticeBoard||{}),image:v}})))}/></label><button className="goldBtn full" onClick={saveSettings}>SAVE ALL SETTINGS <Check size={15}/></button></section></div><section className="adminPanel"><div className="panelHead"><h3>BACKUP & RESTORE</h3></div><div className="backupBtns"><button className="outline" onClick={()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="turfbook-backup.json";a.click();URL.revokeObjectURL(a.href)}}>DOWNLOAD BACKUP</button><label className="uploadBtn">RESTORE BACKUP<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=()=>{try{setDb({...initial,...JSON.parse(r.result)});toast("Backup restored.")}catch{toast("Invalid backup file.")}};r.readAsText(f)}}}/></label></div></section></main>}
    {page==="owner"&&!user&&<p className="empty">Please sign in as an owner.</p>}
    {page==="admin"&&!adminMode&&<p className="empty">Please sign in as admin.</p>}
    {modal==="book"&&chosen&&<Modal title="REQUEST A BOOKING" close={()=>setModal("")}><p className="muted">{chosen.name} · {chosen.location}</p><form onSubmit={requestBooking}><label>BOOKING DATE</label><input type="date" min={today()} value={form.date} onChange={e=>set("date",e.target.value)} required/><label>GAME FORMAT</label><select value={form.format} onChange={e=>set("format",e.target.value)}>{(chosen.formats||[chosen.format||"7s"]).map(f=><option key={f}>{f}</option>)}</select><p className="muted">{money(chosen.prices?.[form.format]??chosen.price)}/hour</p><label>START TIME</label><select value={form.time} onChange={e=>set("time",e.target.value)}>{times.map(t=><option>{t}</option>)}</select><label>DURATION</label><select value={form.duration} onChange={e=>set("duration",e.target.value)}>{[1,2,3,4].map(n=><option value={n}>{n} hour{n>1?"s":""}</option>)}</select><label>YOUR NAME</label><input value={form.name} onChange={e=>set("name",e.target.value)} required/><label>PHONE NUMBER</label><input inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={form.phone} onChange={e=>set("phone",e.target.value.replace(/\D/g,"").slice(0,10))} required/><div className="totalLine">ESTIMATED TOTAL <b>{money(Number(chosen.prices?.[form.format]??chosen.price)*Number(form.duration||1))}</b></div><button className="goldBtn full">SEND BOOKING REQUEST <ArrowRight size={15}/></button><small className="muted">Payment is requested only after owner approval.</small></form></Modal>}
    {modal==="turf"&&<Modal title={form.id?"EDIT TURF":"ADD NEW TURF"} close={()=>setModal("")}><form onSubmit={saveTurf}><label>TURF NAME</label><input value={form.name||""} onChange={e=>set("name",e.target.value)} required/><label>LOCATION</label><input value={form.location||""} onChange={e=>set("location",e.target.value)} required/><label>TURF IMAGE</label>{(form.imageData||form.imageUrl)&&<img className="turfEditPreview" src={form.imageData||form.imageUrl} alt="Turf preview"/>}<label className="uploadBtn"><Upload size={15}/> UPLOAD / CHANGE TURF IMAGE<input type="file" accept="image/*" onChange={e=>fileToData(e.target.files[0],v=>set("imageData",v))}/></label><label>5-A-SIDE PRICE PER HOUR (₹)</label><input type="number" min="0" value={form.price5??800} onChange={e=>set("price5",e.target.value)} required/><label>7-A-SIDE PRICE PER HOUR (₹)</label><input type="number" min="0" value={form.price7??900} onChange={e=>set("price7",e.target.value)} required/><label className="checkLabel"><input type="checkbox" checked={!!form.mini7} onChange={e=>set("mini7",e.target.checked)}/> Also offer Mini 7s at this turf</label>{form.mini7&&<><label>MINI 7-A-SIDE PRICE PER HOUR (₹)</label><input type="number" min="0" value={form.priceMini7??0} onChange={e=>set("priceMini7",e.target.value)} required/></>}<label>ASSIGN OWNER</label><select value={form.ownerId||""} onChange={e=>set("ownerId",e.target.value)}><option value="">Not assigned</option>{db.owners.map(o=><option value={o.id}>{o.name} ({o.code})</option>)}</select><label className="checkLabel"><input type="checkbox" checked={form.active!==false} onChange={e=>set("active",e.target.checked)}/> Active and visible to players</label><button className="goldBtn full">SAVE TURF</button></form></Modal>}
    {modal==="owner"&&<Modal title={form.id?"EDIT OWNER":"CREATE OWNER ACCOUNT"} close={()=>setModal("")}><form onSubmit={saveOwner}><label>OWNER FULL NAME</label><input value={form.name||""} onChange={e=>set("name",e.target.value)} required/><label>OWNER ID {form.id?"(CANNOT BE CHANGED)":"(YOU CREATE THIS)"}</label><input value={form.code||""} onChange={e=>set("code",e.target.value)} required disabled={!!form.id}/><label>PASSWORD</label><input type="password" minLength={10} value={form.password||""} onChange={e=>set("password",e.target.value)} required={!form.id} placeholder={form.id?"Leave blank to keep current password":"At least 10 characters"}/><label>PHONE (OPTIONAL)</label><input value={form.phone||""} onChange={e=>set("phone",e.target.value)}/><label className="checkLabel"><input type="checkbox" checked={form.active!==false} onChange={e=>set("active",e.target.checked)}/> Account enabled</label><button className="goldBtn full">SAVE OWNER</button><small className="muted">For an existing owner, leave the password blank to keep the current password.</small></form></Modal>}
    {notice&&<div className="toast">{notice}<button onClick={()=>setNotice("")}><X size={15}/></button></div>}
    <footer><div className="brand"><span className="crest">{db.appIcon?<img src={db.appIcon} alt=""/>:<Trophy size={16}/>}</span><span>{db.appName}<small>THE GAME STARTS HERE</small></span></div><span>© {new Date().getFullYear()} · PLAY WITH PURPOSE</span></footer>
  </div>
}
function LoginCard({title,sub,onSubmit,children}){return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE PARTNER ACCESS</div><h2>{title}</h2><p>{sub}</p><form onSubmit={onSubmit}>{children}</form><small className="muted"><LockKeyhole size={13}/> Restricted access</small></section></main>}
function Metric({label,value}){return <div className="metric"><small>{label}</small><b>{value}</b></div>}
function BookingRows({bookings,ownerStatus,admin=false,updateBooking}){return <div className="bookingList">{bookings.map(b=><article className="bookingRow" key={b.id}><div className="bookingInfo"><b>{b.turfName}</b><span>{b.name} · {b.phone}</span><small><CalendarDays size={12}/>{b.format?`${b.format} · `:""}{b.date} <Clock3 size={12}/>{b.time} · {b.duration}h</small>{admin&&<small className="adminDetail">Payment: {b.payment}{b.paymentRef?` · Ref: ${b.paymentRef}`:""}</small>}</div><div className="bookingControls"><span className={`status ${b.status.toLowerCase()}`}>{b.status}</span>{b.status==="Pending"&&<div className="actionPair"><button className="approve" onClick={()=>ownerStatus(b.id,"Approved")}>APPROVE</button><button className="decline" onClick={()=>ownerStatus(b.id,"Declined")}>DECLINE</button></div>}{admin&&b.status==="Approved"&&<><select value={b.payment} onChange={e=>updateBooking(b.id,{payment:e.target.value})}><option>Not submitted</option><option>Proof submitted</option><option>Verified</option><option>Refunded</option></select>{b.payment==="Proof submitted"&&<button className="approve" onClick={()=>updateBooking(b.id,{payment:"Verified"})}>VERIFY PAYMENT</button>}</>}</div></article>)}{!bookings.length&&<p className="empty">No bookings to display.</p>}</div>}
function Modal({title,close,children}){return <div className="overlay" onClick={close}><section className="modal" onClick={e=>e.stopPropagation()}><button className="modalClose" onClick={close}><X/></button><div className="eyebrow">TURFBOOK CONTROL</div><h2>{title}</h2>{children}</section></div>}
export default App;
