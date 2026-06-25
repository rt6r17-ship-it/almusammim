/* =========================================================================
   المصمم العراقي — app.js
   ========================================================================= */

/* ---------- 1) Firebase Init ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyDBL6OyQBXuZ6E23PbBjiUaG13HHrjfE7Q",
  authDomain: "myapp-41a95.firebaseapp.com",
  databaseURL: "https://myapp-41a95-default-rtdb.firebaseio.com",
  projectId: "myapp-41a95",
  storageBucket: "myapp-41a95.firebasestorage.app",
  messagingSenderId: "1072576168299",
  appId: "1:1072576168299:web:fe434c2cc9ee445f18cc2e",
  measurementId: "G-1RS1ETT6KC"
};
firebase.initializeApp(firebaseConfig);
try { firebase.analytics(); } catch (e) { /* analytics may be blocked, ignore */ }

const auth = firebase.auth();
const db = firebase.firestore();

/* ---------- 2) Constants ---------- */
const ADMIN_EMAIL = "admin@mtger.iq"; // فقط هذا الحساب يدخل لوحة التحكم
const TELEGRAM_USERNAME = "th2f6";

/* ---------- 3) Global State ---------- */
const state = {
  user: null,            // Firebase auth user
  profile: null,         // Firestore users/{uid}
  isAdmin: false,
  route: "home",
  cards: [],
  proCards: [],
  settings: { social: {}, },
  unsub: [],             // active firestore listeners to clean up
};

/* ---------- 4) Helpers ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function toast(message, type = "success") {
  const wrap = $("#toastWrap");
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  const node = el(`<div class="toast ${type}"><span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span></div>`);
  wrap.appendChild(node);
  setTimeout(() => { node.style.opacity = "0"; node.style.transition = ".3s"; setTimeout(() => node.remove(), 300); }, 3200);
}
function openModal(id) { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}
function daysLeft(expiryTs) {
  if (!expiryTs) return 0;
  const exp = expiryTs.toDate ? expiryTs.toDate() : new Date(expiryTs);
  const diff = Math.ceil((exp - new Date()) / (1000 * 60 * 60 * 24));
  return diff;
}
function isProActive(profile) {
  if (!profile || !profile.proExpiresAt) return false;
  return daysLeft(profile.proExpiresAt) > 0;
}
function genCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

/* ---------- 5) Router ---------- */
function navigate(route) {
  state.route = route;
  history.replaceState(null, "", "#" + route);
  renderRoute();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function renderRoute() {
  $all(".nav-link").forEach(l => l.classList.toggle("active", l.dataset.route === state.route));
  const app = $("#app");
  app.innerHTML = "";

  switch (state.route) {
    case "home": app.appendChild(renderHomePage()); break;
    case "pro": app.appendChild(renderProPage()); break;
    case "profile": app.appendChild(renderProfilePage()); break;
    case "admin-login": app.appendChild(renderAdminLoginPage()); break;
    case "admin": app.appendChild(renderAdminPage()); break;
    default: app.appendChild(renderHomePage());
  }
}

window.addEventListener("hashchange", () => {
  const r = location.hash.replace("#", "") || "home";
  state.route = r;
  renderRoute();
});

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-route]");
  if (link) {
    e.preventDefault();
    navigate(link.dataset.route);
  }
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) closeModal(closeBtn.dataset.close);
  if (e.target.classList.contains("modal-overlay")) e.target.classList.remove("open");
});

/* ---------- 6) Init sequence ---------- */
function hideLoader() {
  const l = $("#pageLoader");
  if (l) { l.style.opacity = "0"; setTimeout(() => l.remove(), 400); }
}

$("#yearNow").textContent = new Date().getFullYear();

let authReady = false, settingsReady = false;
function maybeHideLoader() { if (authReady && settingsReady) hideLoader(); }

/* Load global settings (social links, etc.) realtime */
db.collection("settings").doc("general").onSnapshot((snap) => {
  state.settings = snap.exists ? snap.data() : { social: {} };
  renderAuthArea();
  renderFooterSocial();
  if (state.route === "home" || state.route === "admin") renderRoute();
  settingsReady = true; maybeHideLoader();
}, (err) => { console.error(err); settingsReady = true; maybeHideLoader(); });

/* Load home cards realtime */
db.collection("cards").orderBy("order", "asc").onSnapshot((snap) => {
  state.cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (state.route === "home") renderRoute();
  if (state.route === "admin") renderRoute();
}, (err) => console.error(err));

/* Load pro cards realtime */
db.collection("proCards").orderBy("order", "asc").onSnapshot((snap) => {
  state.proCards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (state.route === "pro") renderRoute();
  if (state.route === "admin") renderRoute();
}, (err) => console.error(err));

/* Auth state */
auth.onAuthStateChanged(async (user) => {
  state.user = user;
  state.isAdmin = false;
  state.profile = null;

  if (user) {
    state.isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();

    // Ensure user profile doc exists
    const ref = db.collection("users").doc(user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      const newProfile = {
        name: user.displayName || (user.email ? user.email.split("@")[0] : "مستخدم"),
        email: user.email || "",
        photoURL: user.photoURL || "",
        username: "user" + user.uid.slice(0, 6),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        proExpiresAt: null,
      };
      await ref.set(newProfile);
      state.profile = { id: user.uid, ...newProfile };
    } else {
      state.profile = { id: user.uid, ...snap.data() };
    }

    // live-listen to own profile (for Pro status changes from admin)
    state.unsub.forEach(u => u());
    state.unsub = [ref.onSnapshot(s => {
      if (s.exists) {
        state.profile = { id: user.uid, ...s.data() };
        renderAuthArea();
        if (["profile", "pro"].includes(state.route)) renderRoute();
      }
    })];
  } else {
    state.unsub.forEach(u => u());
    state.unsub = [];
  }

  renderAuthArea();
  renderRoute();
  authReady = true; maybeHideLoader();
});

/* initial route from hash */
state.route = location.hash.replace("#", "") || "home";

/* =========================================================================
   7) AUTH AREA (top bar) + AUTH MODAL LOGIC
   ========================================================================= */
function renderAuthArea() {
  const area = $("#authArea");
  if (!area) return;
  area.innerHTML = "";

  if (state.user) {
    const photo = state.profile?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(state.profile?.name || "U")}`;
    const chip = el(`
      <a href="#" class="user-chip" data-route="profile">
        <img src="${escapeHtml(photo)}" alt="">
        <span>${escapeHtml((state.profile?.name || "حسابي").split(" ")[0])}</span>
      </a>
    `);
    area.appendChild(chip);
  } else {
    const btn = el(`<button class="btn btn-primary btn-sm" id="openAuthBtn">تسجيل الدخول</button>`);
    btn.addEventListener("click", () => openModal("authModal"));
    area.appendChild(btn);
  }
}

function renderFooterSocial() {
  const wrap = $("#footerSocial");
  if (!wrap) return;
  const s = state.settings.social || {};
  const items = [
    { key: "instagram", icon: "📷", label: "Instagram" },
    { key: "tiktok", icon: "🎵", label: "TikTok" },
    { key: "telegram", icon: "✈️", label: "Telegram" },
  ];
  wrap.innerHTML = "";
  items.forEach(it => {
    const url = s[it.key];
    if (url) {
      wrap.appendChild(el(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${it.label}">${it.icon}</a>`));
    }
  });
}

/* Modal tabs */
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-authtab]");
  if (tab) {
    $all(".modal-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.authtab;
    $("#loginForm").classList.toggle("hidden", which !== "login");
    $("#signupForm").classList.toggle("hidden", which !== "signup");
    $("#authModalTitle").textContent = which === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد";
  }
});

$("#googleAuthBtn").addEventListener("click", async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    closeModal("authModal");
    toast("تم تسجيل الدخول بنجاح");
  } catch (err) {
    console.error(err);
    toast("تعذر تسجيل الدخول عبر Google", "error");
  }
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "جاري الدخول...";
  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeModal("authModal");
    toast("تم تسجيل الدخول بنجاح");
    e.target.reset();
  } catch (err) {
    toast(authErrorMessage(err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "تسجيل الدخول";
  }
});

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#signupName").value.trim();
  const email = $("#signupEmail").value.trim();
  const password = $("#signupPassword").value;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "جاري الإنشاء...";
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection("users").doc(cred.user.uid).set({
      name, email,
      photoURL: "",
      username: "user" + cred.user.uid.slice(0, 6),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      proExpiresAt: null,
    });
    closeModal("authModal");
    toast("تم إنشاء الحساب بنجاح");
    e.target.reset();
  } catch (err) {
    toast(authErrorMessage(err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "إنشاء حساب";
  }
});

function authErrorMessage(err) {
  const map = {
    "auth/email-already-in-use": "هذا البريد مستخدم مسبقًا",
    "auth/invalid-email": "البريد الإلكتروني غير صالح",
    "auth/weak-password": "كلمة السر ضعيفة جدًا",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/wrong-password": "كلمة السر غير صحيحة",
    "auth/invalid-credential": "بيانات الدخول غير صحيحة",
    "auth/too-many-requests": "محاولات كثيرة، حاول لاحقًا",
  };
  return map[err.code] || "حدث خطأ، حاول مرة أخرى";
}

/* =========================================================================
   8) HOME PAGE
   ========================================================================= */
function renderHomePage() {
  const wrap = el(`<div></div>`);

  wrap.appendChild(el(`
    <section class="hero">
      <div class="hero-eyebrow"><span class="dot"></span> أدوات وموارد تصميم محدّثة باستمرار</div>
      <h1>كل أدوات <span class="grad-text">التصميم</span><br>بمكان واحد</h1>
      <p>مجموعة مختارة من الأدوات والتطبيقات للمصممين، تابع الجديد، واستخدم ما يناسبك بضغطة واحدة.</p>
      <div class="hero-actions">
        <a href="#" class="btn btn-primary" data-route="pro">اكتشف محتوى Pro</a>
        <a href="https://t.me/${TELEGRAM_USERNAME}" target="_blank" rel="noopener" class="btn btn-secondary">تواصل عبر تيلجرام</a>
      </div>
    </section>
  `));

  const section = el(`
    <section class="section container">
      <div class="section-head">
        <div>
          <h2>الأدوات المتاحة</h2>
          <p>تصفّح القائمة واضغط "استخدام" للانتقال مباشرة للتطبيق</p>
        </div>
      </div>
      <div class="grid" id="homeGrid"></div>
    </section>
  `);
  wrap.appendChild(section);

  const grid = $("#homeGrid", section);
  if (state.cards.length === 0) {
    grid.appendChild(el(`
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="icon">🗂️</span>
        <strong>لا توجد أدوات بعد</strong>
        ستظهر الأدوات هنا فور إضافتها من لوحة التحكم
      </div>
    `));
  } else {
    state.cards.forEach(card => grid.appendChild(renderToolCard(card)));
  }

  return wrap;
}

function renderToolCard(card) {
  const img = card.imageUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(card.title || "tool")}`;
  return el(`
    <div class="card">
      <div class="card-media"><img src="${escapeHtml(img)}" alt="${escapeHtml(card.title || "")}" loading="lazy"></div>
      <div class="card-body">
        <h3>${escapeHtml(card.title || "بدون عنوان")}</h3>
        <p>${escapeHtml(card.description || "")}</p>
        <a href="${escapeHtml(card.linkUrl || "#")}" target="_blank" rel="noopener" class="btn btn-primary">استخدام</a>
      </div>
    </div>
  `);
}


/* =========================================================================
   9) PRO PAGE
   ========================================================================= */
function renderProPage() {
  const wrap = el(`<div class="container section"></div>`);

  if (!state.user) {
    wrap.appendChild(el(`
      <div class="pro-gate">
        <div class="lock-icon">🔒</div>
        <h2>محتوى Pro مقفل</h2>
        <p>سجّل الدخول أولًا لتتمكن من تفعيل اشتراكك والوصول لمحتوى Pro الإضافي.</p>
        <button class="btn btn-primary btn-block" id="proLoginBtn">تسجيل الدخول</button>
      </div>
    `));
    wrap.querySelector("#proLoginBtn").addEventListener("click", () => openModal("authModal"));
    return wrap;
  }

  const active = isProActive(state.profile);

  if (!active) {
    const gate = el(`
      <div class="pro-gate">
        <div class="lock-icon">🔒</div>
        <h2>اشترك للوصول إلى Pro</h2>
        <p>محتوى Pro يحتوي على أدوات وموارد إضافية حصرية. فعّل اشتراكك بثلاث خطوات بسيطة:</p>
        <div class="pro-steps">
          <div><span class="num">1</span> تواصل معنا عبر تيلجرام لإتمام الدفع</div>
          <div><span class="num">2</span> سيصلك كود اشتراك خاص بك بعد التأكيد</div>
          <div><span class="num">3</span> أدخل الكود بالأسفل لتفعيل Pro فورًا</div>
        </div>
        <div class="code-input-row">
          <input type="text" id="proCodeInput" placeholder="ادخل كود الاشتراك" maxlength="12">
        </div>
        <button class="btn btn-gold btn-block" id="redeemCodeBtn">تفعيل الكود</button>
        <div class="divider-or">أو</div>
        <a href="https://t.me/${TELEGRAM_USERNAME}" target="_blank" rel="noopener" class="btn btn-secondary btn-block">
          ✈️ تواصل عبر تيلجرام للاشتراك
        </a>
      </div>
    `);
    wrap.appendChild(gate);

    gate.querySelector("#redeemCodeBtn").addEventListener("click", () => redeemProCode(gate));
    gate.querySelector("#proCodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") redeemProCode(gate);
    });
    return wrap;
  }

  // Active Pro view
  const left = daysLeft(state.profile.proExpiresAt);
  wrap.appendChild(el(`
    <div class="text-center mt-2" style="margin-bottom:8px;">
      <span class="pro-active-badge">⭐ اشتراك Pro نشط — يتبقى ${left} يوم</span>
    </div>
  `));

  const section = el(`
    <div class="section-head">
      <div>
        <h2>محتوى Pro</h2>
        <p>أدوات وموارد حصرية لمشتركي Pro</p>
      </div>
    </div>
    <div class="grid" id="proGrid"></div>
  `);
  wrap.appendChild(section);

  const grid = $("#proGrid", wrap);
  if (state.proCards.length === 0) {
    grid.appendChild(el(`
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="icon">✨</span>
        <strong>لا يوجد محتوى Pro حاليًا</strong>
        سيتم إضافة المحتوى الحصري هنا قريبًا
      </div>
    `));
  } else {
    state.proCards.forEach(card => {
      const c = renderToolCard(card);
      c.querySelector(".card-media").insertAdjacentHTML("afterbegin", `<div class="card-pro-tag">⭐ PRO</div>`);
      grid.appendChild(c);
    });
  }

  return wrap;
}

async function redeemProCode(scope) {
  const input = scope.querySelector("#proCodeInput");
  const btn = scope.querySelector("#redeemCodeBtn");
  const code = input.value.trim().toUpperCase();
  if (!code) { toast("ادخل كود الاشتراك أولًا", "error"); return; }

  btn.disabled = true; btn.textContent = "جاري التحقق...";
  try {
    const codeRef = db.collection("subscriptionCodes").doc(code);
    const snap = await codeRef.get();

    if (!snap.exists) { toast("الكود غير صحيح", "error"); return; }
    const data = snap.data();

    if (data.usedBy) { toast("هذا الكود مستخدم مسبقًا", "error"); return; }
    if (data.assignedTo && data.assignedTo !== state.user.email) {
      toast("هذا الكود غير مخصص لحسابك", "error"); return;
    }

    const durationDays = data.durationDays || 30;
    const now = new Date();
    const currentExpiry = state.profile.proExpiresAt
      ? (state.profile.proExpiresAt.toDate ? state.profile.proExpiresAt.toDate() : new Date(state.profile.proExpiresAt))
      : now;
    const base = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const batch = db.batch();
    batch.update(codeRef, {
      usedBy: state.user.email,
      usedByUid: state.user.uid,
      usedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(db.collection("users").doc(state.user.uid), {
      proExpiresAt: firebase.firestore.Timestamp.fromDate(newExpiry),
    });
    await batch.commit();

    toast(`تم تفعيل Pro لمدة ${durationDays} يوم 🎉`);
    input.value = "";
  } catch (err) {
    console.error(err);
    toast("حدث خطأ أثناء تفعيل الكود", "error");
  } finally {
    btn.disabled = false; btn.textContent = "تفعيل الكود";
  }
}


/* =========================================================================
   10) PROFILE PAGE
   ========================================================================= */
function renderProfilePage() {
  if (!state.user) {
    const wrap = el(`
      <div class="container section">
        <div class="pro-gate">
          <div class="lock-icon">👤</div>
          <h2>سجّل الدخول لعرض حسابك</h2>
          <p>تحتاج لتسجيل الدخول لعرض ملفك الشخصي وحالة اشتراكك.</p>
          <button class="btn btn-primary btn-block" id="profileLoginBtn">تسجيل الدخول</button>
        </div>
      </div>
    `);
    wrap.querySelector("#profileLoginBtn").addEventListener("click", () => openModal("authModal"));
    return wrap;
  }

  const p = state.profile || {};
  const active = isProActive(p);
  const photo = p.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.name || "U")}`;

  const wrap = el(`
    <div class="container section">
      <div class="profile-header">
        <div class="profile-avatar-wrap">
          <img src="${escapeHtml(photo)}" class="profile-avatar" alt="">
        </div>
        <div class="profile-info">
          <h2>${escapeHtml(p.name || "مستخدم")} ${active ? '<span class="pro-pill">⭐ PRO</span>' : ""}</h2>
          <div class="username">@${escapeHtml(p.username || "")} · ${escapeHtml(p.email || "")}</div>
          ${active ? `<div class="field-hint mt-1">ينتهي اشتراكك بعد ${daysLeft(p.proExpiresAt)} يوم (${fmtDate(p.proExpiresAt)})</div>` : `<div class="field-hint mt-1">لا يوجد اشتراك Pro نشط</div>`}
        </div>
        <div class="profile-actions">
          ${!active ? `<a href="#" class="btn btn-gold" data-route="pro">تفعيل Pro</a>` : `<a href="#" class="btn btn-secondary" data-route="pro">عرض محتوى Pro</a>`}
          <button class="btn btn-secondary" id="editProfileBtn">تعديل الملف</button>
          <button class="btn btn-danger" id="logoutBtn">تسجيل خروج</button>
        </div>
      </div>

      <div class="admin-card" id="editProfileCard" style="display:none;">
        <h3>تعديل الملف الشخصي</h3>
        <div class="form-row-2">
          <div class="form-group">
            <label>الاسم</label>
            <input type="text" id="editName" value="${escapeHtml(p.name || "")}">
          </div>
          <div class="form-group">
            <label>اسم المستخدم</label>
            <input type="text" id="editUsername" value="${escapeHtml(p.username || "")}">
          </div>
        </div>
        <div class="form-group">
          <label>رابط الصورة الشخصية (اختياري)</label>
          <input type="text" id="editPhoto" value="${escapeHtml(p.photoURL || "")}" placeholder="https://...">
          <div class="field-hint">اتركه فارغًا لاستخدام صورة Google الافتراضية إن وجدت</div>
        </div>
        <button class="btn btn-primary" id="saveProfileBtn">حفظ التغييرات</button>
      </div>
    </div>
  `);

  wrap.querySelector("#logoutBtn").addEventListener("click", async () => {
    await auth.signOut();
    toast("تم تسجيل الخروج");
    navigate("home");
  });

  wrap.querySelector("#editProfileBtn").addEventListener("click", () => {
    const card = wrap.querySelector("#editProfileCard");
    card.style.display = card.style.display === "none" ? "block" : "none";
  });

  wrap.querySelector("#saveProfileBtn").addEventListener("click", async (e) => {
    const btn = e.target;
    const name = wrap.querySelector("#editName").value.trim();
    const username = wrap.querySelector("#editUsername").value.trim();
    const photoURL = wrap.querySelector("#editPhoto").value.trim();
    if (!name || !username) { toast("الاسم واسم المستخدم مطلوبان", "error"); return; }
    if (photoURL && !isValidUrl(photoURL)) { toast("رابط الصورة غير صالح", "error"); return; }

    btn.disabled = true; btn.textContent = "جاري الحفظ...";
    try {
      await db.collection("users").doc(state.user.uid).update({ name, username, photoURL });
      toast("تم حفظ التغييرات بنجاح");
    } catch (err) {
      console.error(err);
      toast("تعذر حفظ التغييرات", "error");
    } finally {
      btn.disabled = false; btn.textContent = "حفظ التغييرات";
    }
  });

  return wrap;
}


/* =========================================================================
   11) ADMIN LOGIN PAGE (secret route: #admin-login)
   ========================================================================= */
function renderAdminLoginPage() {
  // If already logged in as admin, go straight to dashboard
  if (state.user && state.isAdmin) {
    setTimeout(() => navigate("admin"), 0);
    return el(`<div></div>`);
  }

  const wrap = el(`
    <div class="container section" style="max-width:420px;">
      <div class="admin-card">
        <h3 style="text-align:center; font-size:20px; margin-bottom:6px;">لوحة تحكم المصمم العراقي</h3>
        <p class="text-center field-hint" style="margin-bottom:22px;">دخول مخصص للإدارة فقط</p>
        <form id="adminLoginForm">
          <div class="form-group">
            <label>البريد الإلكتروني</label>
            <input type="email" id="adminEmail" placeholder="admin@example.com" required>
          </div>
          <div class="form-group">
            <label>كلمة السر</label>
            <input type="password" id="adminPassword" placeholder="••••••••" required>
          </div>
          <button type="submit" class="btn btn-primary btn-block">دخول</button>
        </form>
        <p id="adminLoginMsg" class="field-error text-center mt-2"></p>
      </div>
    </div>
  `);

  wrap.querySelector("#adminLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = wrap.querySelector("#adminEmail").value.trim();
    const password = wrap.querySelector("#adminPassword").value;
    const msg = wrap.querySelector("#adminLoginMsg");
    const btn = e.target.querySelector("button[type=submit]");
    msg.textContent = "";
    btn.disabled = true; btn.textContent = "جاري الدخول...";
    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      if ((cred.user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        await auth.signOut();
        msg.textContent = "هذا الحساب لا يملك صلاحية الوصول للوحة التحكم";
        return;
      }
      toast("مرحبًا بك في لوحة التحكم");
      navigate("admin");
    } catch (err) {
      msg.textContent = authErrorMessage(err);
    } finally {
      btn.disabled = false; btn.textContent = "دخول";
    }
  });

  return wrap;
}

/* =========================================================================
   12) ADMIN DASHBOARD
   ========================================================================= */
let adminActivePanel = "cards"; // cards | proCards | codes | users | settings

function renderAdminPage() {
  if (!state.user || !state.isAdmin) {
    setTimeout(() => navigate("admin-login"), 0);
    return el(`<div></div>`);
  }

  const wrap = el(`
    <div class="admin-shell">
      <aside class="admin-sidebar" id="adminSidebar">
        <div class="brand"><span class="brand-mark">عر</span> لوحة التحكم</div>
        <a href="#" class="admin-nav-item" data-admin-panel="cards">🗂️ بطاقات الرئيسية</a>
        <a href="#" class="admin-nav-item" data-admin-panel="proCards">⭐ بطاقات Pro</a>
        <a href="#" class="admin-nav-item" data-admin-panel="codes">🎟️ أكواد الاشتراك</a>
        <a href="#" class="admin-nav-item" data-admin-panel="users">👥 المستخدمون</a>
        <a href="#" class="admin-nav-item" data-admin-panel="settings">⚙️ إعدادات الموقع</a>
        <div style="flex:1;"></div>
        <a href="#" class="admin-nav-item" data-route="home">🏠 رجوع للموقع</a>
        <button class="admin-nav-item" id="adminLogoutBtn" style="width:100%; text-align:right;">🚪 تسجيل خروج</button>
      </aside>
      <div class="admin-main">
        <div class="admin-topline">
          <h1 id="adminPanelTitle">بطاقات الرئيسية</h1>
          <button class="icon-btn" id="adminSidebarToggle" style="display:none;">☰</button>
        </div>
        <div class="stat-row" id="adminStats"></div>
        <div id="adminPanelHost"></div>
      </div>
    </div>
  `);

  wrap.querySelectorAll("[data-admin-panel]").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      adminActivePanel = item.dataset.adminPanel;
      renderRoute();
    });
  });
  wrap.querySelector("#adminLogoutBtn").addEventListener("click", async () => {
    await auth.signOut();
    navigate("home");
  });

  wrap.querySelectorAll(".admin-nav-item[data-admin-panel]").forEach(i => {
    i.classList.toggle("active", i.dataset.adminPanel === adminActivePanel);
  });

  const titles = {
    cards: "بطاقات الرئيسية", proCards: "بطاقات Pro", codes: "أكواد الاشتراك",
    users: "المستخدمون", settings: "إعدادات الموقع",
  };
  wrap.querySelector("#adminPanelTitle").textContent = titles[adminActivePanel];

  renderAdminStats(wrap.querySelector("#adminStats"));

  const host = wrap.querySelector("#adminPanelHost");
  if (adminActivePanel === "cards") host.appendChild(renderAdminCardsPanel("cards"));
  if (adminActivePanel === "proCards") host.appendChild(renderAdminCardsPanel("proCards"));
  if (adminActivePanel === "codes") host.appendChild(renderAdminCodesPanel());
  if (adminActivePanel === "users") host.appendChild(renderAdminUsersPanel());
  if (adminActivePanel === "settings") host.appendChild(renderAdminSettingsPanel());

  return wrap;
}

function renderAdminStats(host) {
  host.innerHTML = `
    <div class="stat-card"><div class="label">بطاقات الرئيسية</div><div class="value">${state.cards.length}</div></div>
    <div class="stat-card"><div class="label">بطاقات Pro</div><div class="value">${state.proCards.length}</div></div>
    <div class="stat-card"><div class="label">أكواد غير مستخدمة</div><div class="value" id="statUnusedCodes">…</div></div>
    <div class="stat-card"><div class="label">المستخدمون</div><div class="value" id="statUsers">…</div></div>
  `;
  db.collection("subscriptionCodes").where("usedBy", "==", null).get()
    .then(s => { const node = $("#statUnusedCodes", host); if (node) node.textContent = s.size; })
    .catch(() => {});
  db.collection("users").get()
    .then(s => { const node = $("#statUsers", host); if (node) node.textContent = s.size; })
    .catch(() => {});
}


/* ---------- 12a) Admin: Cards Panel (shared for cards & proCards) ---------- */
function renderAdminCardsPanel(collectionName) {
  const wrap = el(`<div></div>`);
  const isPro = collectionName === "proCards";

  wrap.appendChild(el(`
    <div class="admin-card">
      <h3>${isPro ? "إضافة بطاقة Pro جديدة" : "إضافة بطاقة جديدة"}</h3>
      <div class="form-row-2">
        <div class="form-group">
          <label>العنوان</label>
          <input type="text" id="cardTitle" placeholder="اسم الأداة">
        </div>
        <div class="form-group">
          <label>رابط الصورة</label>
          <input type="text" id="cardImage" placeholder="https://...">
        </div>
      </div>
      <div class="form-group">
        <label>الوصف</label>
        <textarea id="cardDesc" placeholder="وصف قصير عن الأداة"></textarea>
      </div>
      <div class="form-group">
        <label>رابط الاستخدام (يفتح عند الضغط على زر "استخدام")</label>
        <input type="text" id="cardLink" placeholder="https://...">
      </div>
      <button class="btn btn-primary" id="addCardBtn">إضافة البطاقة</button>
    </div>
    <div class="admin-table-wrap">
      <table>
        <thead><tr><th>الصورة</th><th>العنوان</th><th>الوصف</th><th>الرابط</th><th>الترتيب</th><th>إجراءات</th></tr></thead>
        <tbody id="cardsTableBody"></tbody>
      </table>
    </div>
  `));

  wrap.querySelector("#addCardBtn").addEventListener("click", async (e) => {
    const btn = e.target;
    const title = wrap.querySelector("#cardTitle").value.trim();
    const imageUrl = wrap.querySelector("#cardImage").value.trim();
    const description = wrap.querySelector("#cardDesc").value.trim();
    const linkUrl = wrap.querySelector("#cardLink").value.trim();

    if (!title || !linkUrl) { toast("العنوان ورابط الاستخدام مطلوبان", "error"); return; }
    if (!isValidUrl(linkUrl)) { toast("رابط الاستخدام غير صالح", "error"); return; }
    if (imageUrl && !isValidUrl(imageUrl)) { toast("رابط الصورة غير صالح", "error"); return; }

    btn.disabled = true; btn.textContent = "جاري الإضافة...";
    try {
      const list = isPro ? state.proCards : state.cards;
      const maxOrder = list.reduce((m, c) => Math.max(m, c.order || 0), 0);
      await db.collection(collectionName).add({
        title, imageUrl, description, linkUrl,
        order: maxOrder + 1,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      toast("تمت إضافة البطاقة بنجاح");
      ["#cardTitle", "#cardImage", "#cardDesc", "#cardLink"].forEach(s => wrap.querySelector(s).value = "");
    } catch (err) {
      console.error(err);
      toast("تعذرت إضافة البطاقة", "error");
    } finally {
      btn.disabled = false; btn.textContent = "إضافة البطاقة";
    }
  });

  const tbody = wrap.querySelector("#cardsTableBody");
  const list = isPro ? state.proCards : state.cards;
  if (list.length === 0) {
    tbody.appendChild(el(`<tr><td colspan="6" class="text-center" style="color:var(--text-faint); padding:30px;">لا توجد بطاقات بعد</td></tr>`));
  } else {
    list.forEach(card => {
      const row = el(`
        <tr>
          <td><img src="${escapeHtml(card.imageUrl || 'https://api.dicebear.com/7.x/shapes/svg?seed=x')}" alt=""></td>
          <td>${escapeHtml(card.title || "")}</td>
          <td style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(card.description || "")}</td>
          <td style="max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><a href="${escapeHtml(card.linkUrl)}" target="_blank" style="color:var(--blue);">${escapeHtml(card.linkUrl || "")}</a></td>
          <td>${card.order ?? "—"}</td>
          <td>
            <div class="table-actions">
              <button class="mini-btn" data-edit-card="${card.id}" title="تعديل">✎</button>
              <button class="mini-btn" data-delete-card="${card.id}" title="حذف">🗑</button>
            </div>
          </td>
        </tr>
      `);
      tbody.appendChild(row);
    });
  }

  tbody.querySelectorAll("[data-delete-card]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذه البطاقة؟")) return;
      try {
        await db.collection(collectionName).doc(btn.dataset.deleteCard).delete();
        toast("تم حذف البطاقة");
      } catch (err) { toast("تعذر الحذف", "error"); }
    });
  });

  tbody.querySelectorAll("[data-edit-card]").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = list.find(c => c.id === btn.dataset.editCard);
      if (card) openEditCardModal(collectionName, card);
    });
  });

  return wrap;
}

function openEditCardModal(collectionName, card) {
  const overlayId = "editCardModal";
  let overlay = document.getElementById(overlayId);
  if (overlay) overlay.remove();

  overlay = el(`
    <div class="modal-overlay open" id="${overlayId}">
      <div class="modal-box">
        <div class="modal-head"><h3>تعديل البطاقة</h3><button class="modal-close" id="closeEditCard">✕</button></div>
        <div class="form-group"><label>العنوان</label><input type="text" id="editCardTitle" value="${escapeHtml(card.title || "")}"></div>
        <div class="form-group"><label>رابط الصورة</label><input type="text" id="editCardImage" value="${escapeHtml(card.imageUrl || "")}"></div>
        <div class="form-group"><label>الوصف</label><textarea id="editCardDesc">${escapeHtml(card.description || "")}</textarea></div>
        <div class="form-group"><label>رابط الاستخدام</label><input type="text" id="editCardLink" value="${escapeHtml(card.linkUrl || "")}"></div>
        <div class="form-group"><label>الترتيب</label><input type="number" id="editCardOrder" value="${card.order || 0}"></div>
        <button class="btn btn-primary btn-block" id="saveEditCard">حفظ التعديلات</button>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);

  overlay.querySelector("#closeEditCard").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#saveEditCard").addEventListener("click", async (e) => {
    const btn = e.target;
    const title = overlay.querySelector("#editCardTitle").value.trim();
    const imageUrl = overlay.querySelector("#editCardImage").value.trim();
    const description = overlay.querySelector("#editCardDesc").value.trim();
    const linkUrl = overlay.querySelector("#editCardLink").value.trim();
    const order = Number(overlay.querySelector("#editCardOrder").value) || 0;

    if (!title || !linkUrl) { toast("العنوان والرابط مطلوبان", "error"); return; }
    if (!isValidUrl(linkUrl) || (imageUrl && !isValidUrl(imageUrl))) { toast("تحقق من صحة الروابط", "error"); return; }

    btn.disabled = true; btn.textContent = "جاري الحفظ...";
    try {
      await db.collection(collectionName).doc(card.id).update({ title, imageUrl, description, linkUrl, order });
      toast("تم حفظ التعديلات");
      overlay.remove();
    } catch (err) {
      toast("تعذر الحفظ", "error");
      btn.disabled = false; btn.textContent = "حفظ التعديلات";
    }
  });
}


/* ---------- 12b) Admin: Subscription Codes Panel ---------- */
function renderAdminCodesPanel() {
  const wrap = el(`
    <div>
      <div class="admin-card">
        <h3>توليد كود اشتراك جديد</h3>
        <div class="form-row-2">
          <div class="form-group">
            <label>مدة الاشتراك (بالأيام)</label>
            <input type="number" id="codeDuration" value="30" min="1">
          </div>
          <div class="form-group">
            <label>تخصيص الكود لبريد معيّن (اختياري)</label>
            <input type="email" id="codeAssignedEmail" placeholder="example@email.com">
          </div>
        </div>
        <button class="btn btn-primary" id="generateCodeBtn">توليد كود جديد</button>
      </div>
      <div class="admin-table-wrap">
        <table>
          <thead><tr><th>الكود</th><th>المدة</th><th>مخصص لـ</th><th>الحالة</th><th>استُخدم من</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
          <tbody id="codesTableBody"><tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">جاري التحميل...</td></tr></tbody>
        </table>
      </div>
    </div>
  `);

  wrap.querySelector("#generateCodeBtn").addEventListener("click", async (e) => {
    const btn = e.target;
    const durationDays = Number(wrap.querySelector("#codeDuration").value) || 30;
    const assignedTo = wrap.querySelector("#codeAssignedEmail").value.trim() || null;

    btn.disabled = true; btn.textContent = "جاري التوليد...";
    try {
      const code = genCode(8);
      await db.collection("subscriptionCodes").doc(code).set({
        durationDays, assignedTo,
        usedBy: null, usedByUid: null, usedAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      toast(`تم توليد الكود: ${code}`);
      wrap.querySelector("#codeAssignedEmail").value = "";
      loadCodesTable(wrap);
    } catch (err) {
      console.error(err);
      toast("تعذر توليد الكود", "error");
    } finally {
      btn.disabled = false; btn.textContent = "توليد كود جديد";
    }
  });

  loadCodesTable(wrap);
  return wrap;
}

async function loadCodesTable(wrap) {
  const tbody = wrap.querySelector("#codesTableBody");
  try {
    const snap = await db.collection("subscriptionCodes").orderBy("createdAt", "desc").limit(100).get();
    tbody.innerHTML = "";
    if (snap.empty) {
      tbody.appendChild(el(`<tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">لا توجد أكواد بعد</td></tr>`));
      return;
    }
    snap.forEach(doc => {
      const d = doc.data();
      const status = d.usedBy
        ? `<span class="badge gray">مستخدم</span>`
        : `<span class="badge green">متاح</span>`;
      const row = el(`
        <tr>
          <td><span class="code-pill">${escapeHtml(doc.id)}</span></td>
          <td>${d.durationDays} يوم</td>
          <td>${escapeHtml(d.assignedTo || "أي مستخدم")}</td>
          <td>${status}</td>
          <td>${escapeHtml(d.usedBy || "—")}</td>
          <td>${fmtDate(d.createdAt)}</td>
          <td><button class="mini-btn" data-delete-code="${doc.id}" title="حذف">🗑</button></td>
        </tr>
      `);
      tbody.appendChild(row);
    });
    tbody.querySelectorAll("[data-delete-code]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("حذف هذا الكود؟")) return;
        await db.collection("subscriptionCodes").doc(btn.dataset.deleteCode).delete();
        toast("تم حذف الكود");
        loadCodesTable(wrap);
      });
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">تعذر تحميل الأكواد</td></tr>`;
  }
}

/* ---------- 12c) Admin: Users Panel ---------- */
function renderAdminUsersPanel() {
  const wrap = el(`
    <div class="admin-table-wrap">
      <table>
        <thead><tr><th>الصورة</th><th>الاسم</th><th>البريد</th><th>اسم المستخدم</th><th>حالة Pro</th><th>تاريخ التسجيل</th><th>إجراءات</th></tr></thead>
        <tbody id="usersTableBody"><tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">جاري التحميل...</td></tr></tbody>
      </table>
    </div>
  `);
  loadUsersTable(wrap);
  return wrap;
}

async function loadUsersTable(wrap) {
  const tbody = wrap.querySelector("#usersTableBody");
  try {
    const snap = await db.collection("users").orderBy("createdAt", "desc").limit(200).get();
    tbody.innerHTML = "";
    if (snap.empty) {
      tbody.appendChild(el(`<tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">لا يوجد مستخدمون بعد</td></tr>`));
      return;
    }
    snap.forEach(doc => {
      const u = doc.data();
      const active = isProActive(u);
      const photo = u.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name || "U")}`;
      const proBadge = active
        ? `<span class="badge gold">PRO (${daysLeft(u.proExpiresAt)} يوم)</span>`
        : `<span class="badge gray">عادي</span>`;
      const row = el(`
        <tr>
          <td><img src="${escapeHtml(photo)}" alt=""></td>
          <td>${escapeHtml(u.name || "—")}</td>
          <td>${escapeHtml(u.email || "—")}</td>
          <td>${escapeHtml(u.username || "—")}</td>
          <td>${proBadge}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            <div class="table-actions">
              <button class="mini-btn" data-grant-pro="${doc.id}" title="منح/تمديد 30 يوم Pro">⭐</button>
              <button class="mini-btn" data-revoke-pro="${doc.id}" title="إلغاء Pro">✕</button>
            </div>
          </td>
        </tr>
      `);
      tbody.appendChild(row);
    });

    tbody.querySelectorAll("[data-grant-pro]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.grantPro;
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.collection("users").doc(uid).update({ proExpiresAt: firebase.firestore.Timestamp.fromDate(newExpiry) });
        toast("تم منح 30 يوم Pro");
        loadUsersTable(wrap);
      });
    });
    tbody.querySelectorAll("[data-revoke-pro]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("إلغاء اشتراك Pro لهذا المستخدم؟")) return;
        const uid = btn.dataset.revokePro;
        await db.collection("users").doc(uid).update({ proExpiresAt: null });
        toast("تم إلغاء اشتراك Pro");
        loadUsersTable(wrap);
      });
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:24px; color:var(--text-faint);">تعذر تحميل المستخدمين</td></tr>`;
  }
}

/* ---------- 12d) Admin: Settings Panel (social links + footer) ---------- */
function renderAdminSettingsPanel() {
  const s = state.settings.social || {};
  const wrap = el(`
    <div class="admin-card">
      <h3>روابط التواصل الاجتماعي (تظهر أسفل الموقع)</h3>
      <div class="form-group"><label>📷 رابط Instagram</label><input type="text" id="setInstagram" value="${escapeHtml(s.instagram || "")}" placeholder="https://instagram.com/..."></div>
      <div class="form-group"><label>🎵 رابط TikTok</label><input type="text" id="setTiktok" value="${escapeHtml(s.tiktok || "")}" placeholder="https://tiktok.com/@..."></div>
      <div class="form-group"><label>✈️ رابط Telegram</label><input type="text" id="setTelegram" value="${escapeHtml(s.telegram || "")}" placeholder="https://t.me/..."></div>
      <button class="btn btn-primary" id="saveSettingsBtn">حفظ الإعدادات</button>
    </div>
  `);

  wrap.querySelector("#saveSettingsBtn").addEventListener("click", async (e) => {
    const btn = e.target;
    const instagram = wrap.querySelector("#setInstagram").value.trim();
    const tiktok = wrap.querySelector("#setTiktok").value.trim();
    const telegram = wrap.querySelector("#setTelegram").value.trim();

    for (const v of [instagram, tiktok, telegram]) {
      if (v && !isValidUrl(v)) { toast("تحقق من صحة الروابط المدخلة", "error"); return; }
    }

    btn.disabled = true; btn.textContent = "جاري الحفظ...";
    try {
      await db.collection("settings").doc("general").set({ social: { instagram, tiktok, telegram } }, { merge: true });
      toast("تم حفظ الإعدادات بنجاح");
    } catch (err) {
      console.error(err);
      toast("تعذر حفظ الإعدادات", "error");
    } finally {
      btn.disabled = false; btn.textContent = "حفظ الإعدادات";
    }
  });

  return wrap;
}

/* ---------- 13) First render ---------- */
renderAuthArea();
renderFooterSocial();
renderRoute();
