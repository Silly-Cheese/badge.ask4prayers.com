import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  collection, serverTimestamp, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDxdvhLLuZ6pWFvD8a4fLggV9hTAZc4ZMA",
  authDomain: "badge-tpp.firebaseapp.com",
  projectId: "badge-tpp",
  storageBucket: "badge-tpp.firebasestorage.app",
  messagingSenderId: "176500536285",
  appId: "1:176500536285:web:e1af33fec50cd62c70bc34"
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const appEl = document.getElementById("app");
const signOutButton = document.getElementById("signOutButton");
const navToggle = document.getElementById("navToggle");
const siteNav = document.getElementById("siteNav");
const printSheet = document.getElementById("printSheet");

let session = { user: null, profile: null, owner: null };
let scanner = null;
let pendingInstallPrompt = null;

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  pendingInstallPrompt = e;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=7", { updateViaCache:"none" })
    .then(reg => reg.update().catch(() => {}))
    .catch(() => {});
}
console.info("TPP Badge System build v7");

navToggle.addEventListener("click", () => {
  const open = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
siteNav.addEventListener("click", () => siteNav.classList.remove("open"));
signOutButton.addEventListener("click", async () => {
  await signOut(auth);
  session = { user: null, profile: null, owner: null };
  location.hash = "#/";
  toast("Signed out.");
});

onAuthStateChanged(auth, async user => {
  session.user = user;
  session.profile = null;
  session.owner = null;
  if (user) {
    const p = await getDoc(doc(db, "users", user.uid)).catch(() => null);
    if (p?.exists()) session.profile = p.data();
    const o = await getDoc(doc(db, "badgeOwners", user.uid)).catch(() => null);
    if (o?.exists()) session.owner = o.data();
  }
  refreshNav();
  route();
});

window.addEventListener("hashchange", route);

function refreshNav() {
  document.querySelectorAll("[data-admin-link]").forEach(el => {
    el.hidden = session.profile?.role !== "admin";
  });
  signOutButton.hidden = !session.user;
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function holderEmail(hash) {
  return "holder." + hash.slice(0, 40) + "@badge.ask4prayers.com";
}
function adminEmail(hash) {
  return "admin." + hash.slice(0, 40) + "@badge.ask4prayers.com";
}
function holderPassword(hash, pin) {
  return "TPP." + hash.slice(0, 24) + "." + pin + "!";
}
function adminPassword(hash, pin) {
  return "TPP.ADMIN." + hash.slice(0, 20) + "." + pin + "!";
}
function isPin(pin) { return /^\d{4}$/.test(pin); }
function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function makeBadgeId() {
  const year = new Date().getFullYear();
  return "TPP-BDG-" + year + "-" + randomToken(5).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
}
function nowIso() { return new Date().toISOString(); }
function formatDate(value, withTime = false) {
  if (!value) return "—";
  let d;
  if (value?.toDate) d = value.toDate();
  else d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return new Intl.DateTimeFormat("en-US", withTime
    ? { dateStyle:"medium", timeStyle:"short" }
    : { dateStyle:"medium" }).format(d);
}
function effectiveStatus(badge) {
  if (!badge) return "invalid";
  if (badge.status === "active" && badge.expiresAt) {
    const exp = new Date(badge.expiresAt + "T23:59:59");
    if (exp < new Date()) return "expired";
  }
  return (badge.status || "invalid").toLowerCase();
}
function statusPill(status) {
  const s = (status || "unknown").toLowerCase();
  return '<span class="status status-' + esc(s) + '">' + esc(s.toUpperCase()) + "</span>";
}
function verifyUrl(token) {
  return location.origin + location.pathname.replace(/[^/]*$/, "") + "#/verify/" + encodeURIComponent(token);
}
function toast(message, type = "") {
  const region = document.getElementById("toastRegion");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}
function pageHead(eyebrow, title, subtitle, action = "") {
  return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1 class="page-title">' +
    esc(title) + '</h1><p class="page-subtitle">' + esc(subtitle) + '</p></div>' + action + '</div>';
}
function qrInto(element, text, size = 256) {
  if (!element) return;
  element.innerHTML = "";
  if (!window.QRCode) {
    element.textContent = "QR unavailable";
    return;
  }
  new QRCode(element, {
    text, width:size, height:size,
    colorDark:"#0a0907", colorLight:"#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

async function route() {
  if (scanner) {
    try { await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
    scanner = null;
  }
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  const root = parts[0] || "";
  try {
    if (!root) return renderHome();
    if (root === "login") return renderLogin(parts[1] || "holder");
    if (root === "bootstrap") return renderBootstrap();
    if (root === "my-badge") return renderMyBadge();
    if (root === "scan") return renderScanner();
    if (root === "verify") return renderVerification(parts[1] || "");
    if (root === "admin") {
      if (session.profile?.role !== "admin") return renderAdminGate();
      if (parts[1] === "issue") return renderIssue();
      if (parts[1] === "badges") return renderBadgeDirectory();
      if (parts[1] === "badge" && parts[2]) return renderAdminBadge(parts[2]);
      if (parts[1] === "scans") return renderScanHistory();
      return renderAdminDashboard();
    }
    renderNotFound();
  } catch (err) {
    console.error(err);
    appEl.innerHTML = '<section class="panel form-card"><h2>Something went wrong</h2><p>' +
      esc(friendlyError(err)) + '</p><div class="button-row"><a class="btn btn-secondary" href="#/">Return home</a></div></section>';
  }
}

function renderHome() {
  const holderAction = session.profile?.role === "holder"
    ? '<a class="btn btn-primary" href="#/my-badge">Open My Badge</a>'
    : '<a class="btn btn-primary" href="#/login/holder">Badge Holder Login</a>';
  const adminAction = session.profile?.role === "admin"
    ? '<a class="btn btn-secondary" href="#/admin">Open Admin</a>'
    : '<a class="btn btn-secondary" href="#/login/admin">Admin Login</a>';
  appEl.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Official Credential System</div>
        <h1>Your Prayer Project badge. Anywhere.</h1>
        <p>Issue secure credentials, carry a digital badge on a phone, print a full-page credential, scan QR codes, and record every verification in one dedicated system.</p>
        <div class="hero-actions">
          ${holderAction}
          <a class="btn btn-secondary" href="#/scan">Scan a Badge</a>
          ${adminAction}
        </div>
      </div>
      <aside class="hero-card">
        <div class="hero-stat"><strong>Live verification</strong><p>Every QR check reads the current credential status, so revoked, suspended, and expired badges cannot present as active.</p></div>
        <div class="hero-stat"><strong>Every scan is recorded</strong><p>Successful and unsuccessful badge scans are written to the audit trail with time, result, and scan source.</p></div>
        <div class="hero-stat"><strong>Mobile first</strong><p>Badge holders get a clean phone credential with QR display, image download, and a printable full-page version.</p></div>
      </aside>
    </section>
    <section class="section">
      <div class="grid-3">
        <article class="feature-card"><div class="feature-icon">01</div><h3>Issue</h3><p>Administrators create official TPP credentials without storing photos of people.</p></article>
        <article class="feature-card"><div class="feature-icon">02</div><h3>Carry</h3><p>Badge holders sign in by name and their 4-digit PIN to access their credential.</p></article>
        <article class="feature-card"><div class="feature-icon">03</div><h3>Scan</h3><p>QR scans show live status and record the event in the badge audit history.</p></article>
      </div>
    </section>
    <section class="section panel soft">
      <div class="section-head"><div><h2>Administrative access</h2><p>Administration and initial system setup are kept separate from badge-holder access.</p></div></div>
      <div class="button-row">
        <a class="btn btn-secondary" href="#/login/admin">Administrator Login</a>
        <a class="btn btn-quiet" href="#/bootstrap">Initial Admin Bootstrap</a>
      </div>
    </section>`;
}

function renderLogin(mode) {
  if (mode === "admin") return renderAdminLogin();
  appEl.innerHTML = `
    ${pageHead("Badge Holder Access","Open your badge","Enter the exact full name used when your badge was issued. If this is your first sign-in, you will create your 4-digit PIN.")}
    <section class="panel form-card">
      <form id="holderNameForm">
        <div class="field"><label for="holderName">Full name</label><input class="input" id="holderName" autocomplete="name" required placeholder="Your full name"></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Continue</button></div>
      </form>
      <div id="loginStage"></div>
    </section>`;
  document.getElementById("holderNameForm").addEventListener("submit", holderNameLookup);
}

async function holderNameLookup(e) {
  e.preventDefault();
  const button = e.submitter;
  setBusy(button, true, "Checking…");
  const name = document.getElementById("holderName").value.trim();
  const hash = await sha256(normalizeName(name));
  const accessSnap = await getDoc(doc(db, "accessDirectory", hash)).catch(() => null);
  setBusy(button, false);
  const stage = document.getElementById("loginStage");
  if (!accessSnap?.exists()) {
    stage.innerHTML = '<div class="form-message error">No badge access record matches that exact name. Contact a Prayer Project administrator if your badge has already been issued.</div>';
    return;
  }
  const access = accessSnap.data();
  if (access.claimed) {
    stage.innerHTML = `
      <form id="holderPinForm" style="margin-top:18px">
        <div class="field"><label for="holderPin">4-digit PIN</label><input class="input" id="holderPin" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="current-password" required placeholder="••••"></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Open My Badge</button></div>
      </form>`;
    document.getElementById("holderPinForm").addEventListener("submit", async ev => {
      ev.preventDefault();
      const pin = document.getElementById("holderPin").value;
      if (!isPin(pin)) return toast("Enter your 4-digit PIN.", "error");
      setBusy(ev.submitter, true, "Signing in…");
      try {
        const cred = await signInWithEmailAndPassword(auth, access.authEmail, holderPassword(hash, pin));
        const [p, o] = await Promise.all([
          getDoc(doc(db, "users", cred.user.uid)),
          getDoc(doc(db, "badgeOwners", cred.user.uid))
        ]);
        session.user = cred.user;
        session.profile = p.exists() ? p.data() : null;
        session.owner = o.exists() ? o.data() : null;
        refreshNav();
        location.hash = "#/my-badge";
      } catch (err) {
        toast("That PIN was not accepted.", "error");
        setBusy(ev.submitter, false);
      }
    });
  } else {
    stage.innerHTML = `
      <div class="form-message">First sign-in detected. Create the 4-digit PIN you will use to open your badge on this device or another device.</div>
      <form id="claimForm" style="margin-top:18px">
        <div class="form-grid">
          <div class="field"><label for="newPin">Create PIN</label><input class="input" id="newPin" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="new-password" required placeholder="4 digits"></div>
          <div class="field"><label for="confirmPin">Confirm PIN</label><input class="input" id="confirmPin" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="new-password" required placeholder="Repeat PIN"></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Create PIN & Open Badge</button></div>
      </form>`;
    document.getElementById("claimForm").addEventListener("submit", ev => claimHolder(ev, name, hash, access));
  }
}

async function claimHolder(e, name, hash, access) {
  e.preventDefault();
  const pin = document.getElementById("newPin").value;
  const confirm = document.getElementById("confirmPin").value;
  if (!isPin(pin)) return toast("PIN must be exactly four digits.", "error");
  if (pin !== confirm) return toast("The PINs do not match.", "error");
  setBusy(e.submitter, true, "Creating access…");
  let created = null;
  try {
    const cred = await createUserWithEmailAndPassword(auth, access.authEmail, holderPassword(hash, pin));
    created = cred.user;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      displayName:name, role:"holder", createdAt:serverTimestamp()
    });
    batch.set(doc(db, "badgeOwners", cred.user.uid), {
      badgeId:access.badgeId, credentialToken:access.credentialToken, nameHash:hash, createdAt:serverTimestamp()
    });
    batch.update(doc(db, "accessDirectory", hash), {
      claimed:true, ownerUid:cred.user.uid, claimedAt:serverTimestamp()
    });
    await batch.commit();
    session.user = cred.user;
    session.profile = { displayName:name, role:"holder" };
    session.owner = {
      badgeId:access.badgeId,
      credentialToken:access.credentialToken,
      nameHash:hash
    };
    refreshNav();
    location.hash = "#/my-badge";
  } catch (err) {
    console.error(err);
    if (created) { try { await deleteUser(created); } catch {} }
    toast(friendlyError(err), "error");
    setBusy(e.submitter, false);
  }
}

function renderAdminLogin() {
  appEl.innerHTML = `
    ${pageHead("Administration","Administrator login","Enter the administrator name and 4-digit PIN created during bootstrap.")}
    <section class="panel form-card">
      <form id="adminLoginForm">
        <div class="form-grid">
          <div class="field full"><label for="adminName">Administrator name</label><input class="input" id="adminName" autocomplete="name" required></div>
          <div class="field full"><label for="adminPin">4-digit PIN</label><input class="input" id="adminPin" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="current-password" required></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Sign In</button></div>
      </form>
    </section>`;
  document.getElementById("adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("adminName").value;
    const pin = document.getElementById("adminPin").value;
    if (!isPin(pin)) return toast("Enter a four-digit PIN.", "error");
    const hash = await sha256(normalizeName(name));
    setBusy(e.submitter, true, "Signing in…");
    try {
      const cred = await signInWithEmailAndPassword(auth, adminEmail(hash), adminPassword(hash, pin));
      const p = await getDoc(doc(db, "users", cred.user.uid));
      if (!p.exists() || p.data().role !== "admin") {
        await signOut(auth);
        throw new Error("This account is not an administrator.");
      }
      session.user = cred.user;
      session.profile = p.data();
      refreshNav();
      location.hash = "#/admin";
    } catch (err) {
      toast("Administrator name or PIN was not accepted.", "error");
      setBusy(e.submitter, false);
    }
  });
}

function renderBootstrap() {
  appEl.innerHTML = `
    ${pageHead("One-time setup","Create the first administrator","This route initializes the Badge System. It can be used only before the system bootstrap record exists.")}
    <section class="panel form-card">
      <form id="bootstrapForm">
        <div class="form-grid">
          <div class="field full"><label for="bootName">Administrator full name</label><input class="input" id="bootName" autocomplete="name" required></div>
          <div class="field"><label for="bootPin">Create 4-digit PIN</label><input class="input" id="bootPin" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></div>
          <div class="field"><label for="bootConfirm">Confirm PIN</label><input class="input" id="bootConfirm" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></div>
          <div class="field full"><label for="bootCode">Bootstrap setup code</label><input class="input" id="bootCode" type="password" autocomplete="off" required><small>This is the one-time setup code provided with the initial deployment.</small></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Create Administrator</button></div>
      </form>
      <div id="bootstrapMessage"></div>
    </section>`;
  document.getElementById("bootstrapForm").addEventListener("submit", bootstrapAdmin);
}

async function bootstrapAdmin(e) {
  e.preventDefault();
  const name = document.getElementById("bootName").value.trim();
  const pin = document.getElementById("bootPin").value;
  const confirm = document.getElementById("bootConfirm").value;
  const setupCode = document.getElementById("bootCode").value.trim();
  const setupCodeHash = await sha256(setupCode);
  if (!isPin(pin)) return toast("PIN must be exactly four digits.", "error");
  if (pin !== confirm) return toast("The PINs do not match.", "error");
  const hash = await sha256(normalizeName(name));
  setBusy(e.submitter, true, "Initializing…");
  let created = null;
  try {
    const cred = await createUserWithEmailAndPassword(auth, adminEmail(hash), adminPassword(hash, pin));
    created = cred.user;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      displayName:name, role:"admin", nameHash:hash, setupCodeHash, createdAt:serverTimestamp()
    });
    batch.set(doc(db, "system", "bootstrap"), {
      ownerUid:cred.user.uid, initializedAt:serverTimestamp(), setupCodeHash
    });
    await batch.commit();
    await updateDoc(doc(db, "users", cred.user.uid), { setupCodeHash:deleteField() });
    await updateDoc(doc(db, "system", "bootstrap"), { setupCodeHash:deleteField() });
    session.user = cred.user;
    session.profile = { displayName:name, role:"admin", nameHash:hash };
    toast("Administrator created. The Badge System is initialized.");
    location.hash = "#/admin";
  } catch (err) {
    console.error(err);
    if (created) { try { await deleteUser(created); } catch {} }
    await signOut(auth).catch(() => {});
    document.getElementById("bootstrapMessage").innerHTML =
      '<div class="form-message error">' + esc(friendlyError(err)) + '</div>';
    setBusy(e.submitter, false);
  }
}

async function renderMyBadge() {
  if (!session.user || session.profile?.role !== "holder" || !session.owner) {
    appEl.innerHTML = `${pageHead("Badge Holder Access","Sign in to open your badge","Your badge is available after you sign in with your name and PIN.")}
      <section class="panel form-card"><a class="btn btn-primary btn-block" href="#/login/holder">Badge Holder Login</a></section>`;
    return;
  }
  const snap = await getDoc(doc(db, "publicCredentials", session.owner.credentialToken));
  if (!snap.exists()) throw new Error("Your badge record could not be found.");
  const badge = snap.data();
  appEl.innerHTML = `
    ${pageHead("My Badge","Your digital credential","Keep this page available on your phone. The QR code always verifies against the live Prayer Project credential record.")}
    <div class="badge-layout">
      ${badgeCardHtml(badge, "ownerBadgeQr")}
      <section class="panel">
        <h2>Badge controls</h2>
        <p>Show the QR for scanning, save a badge image to your phone, or print a full-page credential.</p>
        <div class="button-row">
          <button class="btn btn-primary" id="downloadBadge">Download to Phone</button>
          <button class="btn btn-secondary" id="printBadge">Full-Page Print</button>
          <button class="btn btn-secondary" id="installBadge">Add to Home Screen</button>
          <button class="btn btn-quiet" id="copyVerify">Copy Verification Link</button>
        </div>
        <div class="detail-list">
          <div class="detail-row"><span>Credential status</span><strong>${statusPill(effectiveStatus(badge))}</strong></div>
          <div class="detail-row"><span>Badge ID</span><strong>${esc(badge.badgeId)}</strong></div>
          <div class="detail-row"><span>TPP ID</span><strong>${esc(badge.tppId || "—")}</strong></div>
          <div class="detail-row"><span>Issued</span><strong>${formatDate(badge.issuedAt)}</strong></div>
          <div class="detail-row"><span>Expires</span><strong>${badge.expiresAt ? formatDate(badge.expiresAt) : "No set expiration"}</strong></div>
        </div>
      </section>
    </div>`;
  qrInto(document.getElementById("ownerBadgeQr"), verifyUrl(session.owner.credentialToken), 256);
  document.getElementById("downloadBadge").onclick = () => downloadBadgeImage("digitalBadgeCard", badge);
  document.getElementById("printBadge").onclick = () => printCredential(badge, session.owner.credentialToken);
  document.getElementById("copyVerify").onclick = async () => {
    await navigator.clipboard.writeText(verifyUrl(session.owner.credentialToken));
    toast("Verification link copied.");
  };
  document.getElementById("installBadge").onclick = showInstallPrompt;
}

function badgeCardHtml(badge, qrId, id = "digitalBadgeCard") {
  return `
    <section class="badge-card" id="${esc(id)}">
      <div class="badge-topline"><span class="badge-org">The Prayer Project</span><span class="badge-watermark">OFFICIAL CREDENTIAL</span></div>
      <div class="badge-person">
        <div class="badge-label">Credential holder</div>
        <h2>${esc(badge.fullName)}</h2>
        <p>${esc(badge.title || badge.credentialType || "Authorized Representative")}</p>
      </div>
      <div class="badge-qr-wrap">
        <div class="badge-qr" id="${esc(qrId)}"></div>
        <div class="badge-meta">
          <dl>
            <div><dt>TPP ID</dt><dd>${esc(badge.tppId || "—")}</dd></div>
            <div><dt>Badge ID</dt><dd>${esc(badge.badgeId)}</dd></div>
            <div><dt>Status</dt><dd>${statusPill(effectiveStatus(badge))}</dd></div>
            <div><dt>Expires</dt><dd>${badge.expiresAt ? formatDate(badge.expiresAt) : "No expiration"}</dd></div>
          </dl>
        </div>
      </div>
    </section>`;
}

async function showInstallPrompt() {
  if (pendingInstallPrompt) {
    pendingInstallPrompt.prompt();
    await pendingInstallPrompt.userChoice.catch(() => {});
    pendingInstallPrompt = null;
    return;
  }
  showModal("Add Badge to Your Phone", `
    <p><strong>iPhone/iPad:</strong> open this page in Safari, tap Share, then choose <em>Add to Home Screen</em>.</p>
    <p><strong>Android:</strong> open the browser menu and choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
    <p>You can also use <strong>Download to Phone</strong> to save a badge image directly.</p>`);
}

async function downloadBadgeImage(elementId, badge) {
  const el = document.getElementById(elementId);
  if (!window.html2canvas || !el) return toast("Badge download is unavailable.", "error");
  toast("Preparing badge image…");
  const canvas = await html2canvas(el, { backgroundColor:"#d8c29d", scale:2, useCORS:true });
  const link = document.createElement("a");
  link.download = (badge.fullName || "TPP-Badge").replace(/[^a-z0-9]+/gi, "-") + "-Badge.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function printCredential(badge, token) {
  printSheet.innerHTML = `
    <div class="print-page">
      <div><div class="print-brand">THE PRAYER PROJECT</div><div class="print-title">Official Credential</div></div>
      <div><div class="print-name">${esc(badge.fullName)}</div><div class="print-role">${esc(badge.title || badge.credentialType || "")}</div></div>
      <div class="print-qr" id="printQr"></div>
      <div class="print-status">${esc(effectiveStatus(badge).toUpperCase())}</div>
      <div class="print-meta">
        <div>TPP ID<strong>${esc(badge.tppId || "—")}</strong></div>
        <div>Badge ID<strong>${esc(badge.badgeId)}</strong></div>
        <div>Issued<strong>${formatDate(badge.issuedAt)}</strong></div>
        <div>Expires<strong>${badge.expiresAt ? formatDate(badge.expiresAt) : "No set expiration"}</strong></div>
      </div>
      <div>Scan the QR code to verify this credential at badge.ask4prayers.com</div>
    </div>`;
  qrInto(document.getElementById("printQr"), verifyUrl(token), 300);
  setTimeout(() => window.print(), 150);
}

async function renderScanner() {
  appEl.innerHTML = `
    ${pageHead("Credential Scanner","Scan a Prayer Project badge","Use the camera or select a downloaded badge image from your phone. Every completed verification is written to the scan log.")}
    <section class="scanner-wrap">
      <div class="panel">
        <div class="field">
          <label for="scanPurpose">Scan purpose</label>
          <select class="select" id="scanPurpose">
            <option>Identity Verification</option>
            <option>Event Check-In</option>
            <option>Event Check-Out</option>
            <option>Board Meeting</option>
            <option>Volunteer Check-In</option>
            <option>Volunteer Check-Out</option>
            <option>Administrative</option>
          </select>
        </div>

        <div class="scan-method-grid">
          <button class="scan-method-card" id="startScanner" type="button">
            <span class="scan-method-icon">⌁</span>
            <strong>Camera Scan</strong>
            <small id="cameraScanText">Scan a badge being shown in front of you.</small>
          </button>

          <button class="scan-method-card" id="chooseBadgeImage" type="button">
            <span class="scan-method-icon">▣</span>
            <strong>Downloaded ID</strong>
            <small id="downloadScanText">Select a saved Prayer Project badge from Photos or Files.</small>
          </button>
        </div>

        <input id="badgeImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden>

        <div class="scanner-box" id="scannerBox" hidden>
          <div class="scanner-live-head">
            <div>
              <strong>Live Camera</strong>
              <span id="cameraStatus">Ready to start.</span>
            </div>
            <button class="btn btn-quiet scanner-stop" id="stopScanner" type="button">Stop Camera</button>
          </div>
          <div id="cameraReader"></div>
        </div>

        <div id="fileReaderHost" class="file-reader-host" aria-hidden="true"></div>

        <div class="download-scan-status" id="downloadScanStatus" hidden></div>

        <p class="scan-help">Camera scanning and downloaded-image scanning happen in your browser. Downloaded badge images are not uploaded or stored; only the verification event is written to the scan log.</p>
      </div>
    </section>`;

  document.getElementById("startScanner").onclick = startScanner;
  document.getElementById("stopScanner").onclick = stopLiveScanner;
  document.getElementById("chooseBadgeImage").onclick = () => {
    document.getElementById("badgeImageInput").click();
  };
  document.getElementById("badgeImageInput").addEventListener("change", scanDownloadedBadge);
}

function currentScanPurpose() {
  return document.getElementById("scanPurpose")?.value || "Identity Verification";
}

async function processScannedValue(decoded, source) {
  const token = extractToken(decoded);
  if (!token) {
    await logScan(null, "invalid", source, currentScanPurpose(), String(decoded || "").slice(0,120));
    toast("That QR code is not a Prayer Project badge.", "error");
    return false;
  }

  sessionStorage.setItem("tppScanContext", JSON.stringify({
    purpose:currentScanPurpose(),
    scannerUid:session.profile?.role === "admin" ? session.user?.uid : null,
    source
  }));
  location.hash = "#/verify/" + encodeURIComponent(token);
  return true;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setCameraUi(state, message) {
  const button = document.getElementById("startScanner");
  const text = document.getElementById("cameraScanText");
  const status = document.getElementById("cameraStatus");
  if (text && message) text.textContent = message;
  if (status && message) status.textContent = message;
  if (button) {
    button.classList.toggle("is-loading", state === "loading");
    button.classList.toggle("is-active", state === "active");
    button.disabled = state === "loading" || state === "active";
  }
}

async function stopLiveScanner() {
  const scannerBox = document.getElementById("scannerBox");
  try {
    if (scanner) {
      try { await scanner.stop(); } catch {}
      try { scanner.clear(); } catch {}
    }
  } finally {
    scanner = null;
    if (scannerBox) scannerBox.hidden = true;
    const reader = document.getElementById("cameraReader");
    if (reader) reader.innerHTML = "";
    setCameraUi("idle", "Scan a badge being shown in front of you.");
  }
}

async function startScanner() {
  if (!window.Html5Qrcode) {
    toast("The QR scanner library failed to load. Refresh the page and try again.", "error");
    return;
  }

  const scannerBox = document.getElementById("scannerBox");
  const reader = document.getElementById("cameraReader");
  const button = document.getElementById("startScanner");

  if (!scannerBox || !reader || !button) {
    toast("The scanner page was not ready. Refresh and try again.", "error");
    return;
  }

  scannerBox.hidden = false;
  reader.innerHTML = "";
  setCameraUi("loading", "Requesting camera access…");

  // Let the newly-visible camera container obtain a real layout size before
  // html5-qrcode measures it.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const cameras = await withTimeout(
      Html5Qrcode.getCameras(),
      12000,
      "Camera permission timed out."
    );

    if (!Array.isArray(cameras) || !cameras.length) {
      throw new Error("No camera was found on this device.");
    }

    const preferred =
      cameras.find(camera => /back|rear|environment|world/i.test(camera.label || "")) ||
      cameras[0];

    scanner = new Html5Qrcode("cameraReader", { verbose:false });
    setCameraUi("loading", "Starting live camera…");

    // Do not provide a qrbox here. html5-qrcode's responsive qrbox calculation
    // can fail on narrow/just-rendered containers. Full-frame scanning is more
    // reliable on both desktop and mobile.
    await withTimeout(
      scanner.start(
        preferred.id,
        { fps:10, disableFlip:false },
        async decoded => {
          const live = scanner;
          scanner = null;
          try { await live?.stop(); } catch {}
          try { live?.clear(); } catch {}
          await processScannedValue(decoded, "camera-scanner");
        },
        () => {}
      ),
      15000,
      "The camera did not finish starting."
    );

    setCameraUi("active", "Camera is live — point it at the badge QR code.");
  } catch (err) {
    console.error("Camera scanner error:", err);

    const live = scanner;
    scanner = null;
    if (live) {
      try { await live.stop(); } catch {}
      try { live.clear(); } catch {}
    }

    reader.innerHTML = "";
    scannerBox.hidden = true;
    setCameraUi("idle", "Camera could not start. Tap to try again.");

    let message = "The camera could not start. You can retry or scan a downloaded ID instead.";
    const detail = String(err?.message || err || "").toLowerCase();

    if (err?.name === "NotAllowedError" || detail.includes("permission") || detail.includes("notallowed")) {
      message = "Camera permission is blocked. Allow camera access for badge.ask4prayers.com, then try again.";
    } else if (err?.name === "NotFoundError" || detail.includes("no camera") || detail.includes("not found")) {
      message = "No usable camera was found on this device.";
    } else if (detail.includes("in use") || detail.includes("could not start video source")) {
      message = "The camera is already in use by another app or browser tab.";
    }

    toast(message, "error");
  }
}

async function scanDownloadedBadge(e) {
  const input = e.currentTarget;
  const file = input.files?.[0];
  if (!file) return;

  await stopLiveScanner();

  const status = document.getElementById("downloadScanStatus");
  const button = document.getElementById("chooseBadgeImage");
  const text = document.getElementById("downloadScanText");

  status.hidden = false;
  status.innerHTML = "<strong>Reading downloaded badge…</strong><span>Looking for the credential QR code.</span>";
  button.disabled = true;
  button.classList.add("is-loading");
  if (text) text.textContent = "Reading the saved badge image…";

  let fileScanner = null;
  try {
    if (!window.Html5Qrcode) throw new Error("QR scanner library is unavailable.");

    const host = document.getElementById("fileReaderHost");
    if (host) host.innerHTML = "";

    fileScanner = new Html5Qrcode("fileReaderHost");
    const decoded = await withTimeout(
      fileScanner.scanFile(file, false),
      15000,
      "The image scan timed out."
    );

    try { fileScanner.clear(); } catch {}
    fileScanner = null;

    status.innerHTML = "<strong>QR code found.</strong><span>Opening live credential verification…</span>";
    const ok = await processScannedValue(decoded, "downloaded-badge");
    if (!ok) {
      status.innerHTML = "<strong>Not a valid Prayer Project badge.</strong><span>The image contained a QR code, but it was not a recognized TPP credential.</span>";
    }
  } catch (err) {
    console.error("Downloaded badge scan error:", err);
    try { fileScanner?.clear(); } catch {}
    status.innerHTML = "<strong>No readable badge QR found.</strong><span>Use the original downloaded badge PNG, make sure the QR code is visible, or try the camera scanner.</span>";
    toast("I couldn't read a Prayer Project badge QR code from that image.", "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (text) text.textContent = "Select a saved Prayer Project badge from Photos or Files.";
    input.value = "";
  }
}

function extractToken(value) {
  try {
    if (value.includes("#/verify/")) return decodeURIComponent(value.split("#/verify/")[1].split(/[?&]/)[0]);
    if (/^[A-Za-z0-9_-]{20,}$/.test(value.trim())) return value.trim();
  } catch {}
  return null;
}

async function renderVerification(token) {
  if (!token) return renderInvalidVerification("No credential token was supplied.");
  const snap = await getDoc(doc(db, "publicCredentials", token)).catch(() => null);
  if (!snap?.exists()) {
    await logScan(null, "invalid", "public-verification", null, token.slice(0,12));
    return renderInvalidVerification("This QR code is not recognized as a Prayer Project credential.");
  }
  const badge = snap.data();
  const status = effectiveStatus(badge);
  const rawContext = sessionStorage.getItem("tppScanContext");
  let context = null;
  if (rawContext) {
    try { context = JSON.parse(rawContext); } catch {}
    sessionStorage.removeItem("tppScanContext");
  }
  await logScan(badge, status, context?.source || "public-verification", context?.purpose || "Identity Verification");
  const bad = ["revoked","lost","stolen","expired","invalid"].includes(status);
  const suspended = status === "suspended";
  const cls = bad ? "verify-revoked" : suspended ? "verify-suspended" : "verify-active";
  const symbol = bad ? "×" : suspended ? "!" : "✓";
  const title = status === "active" ? "BADGE VERIFIED" : status.toUpperCase();
  const reason = ["revoked","lost","stolen"].includes(status) && badge.publicRevocationReason
    ? '<div class="verify-reason"><strong>Reason</strong>' + esc(badge.publicRevocationReason) + '</div>' : "";
  appEl.innerHTML = `
    <section class="verify-shell">
      <div class="verify-card ${cls}">
        <div class="verify-symbol">${symbol}</div>
        <h1>${esc(title)}</h1>
        <h2>${esc(badge.fullName)}</h2>
        <p>${esc(badge.title || badge.credentialType || "Prayer Project Credential")}</p>
        <div class="button-row" style="justify-content:center">${statusPill(status)}</div>
        ${reason}
        <div class="detail-list" style="margin-top:24px;text-align:left">
          <div class="detail-row"><span>TPP ID</span><strong>${esc(badge.tppId || "—")}</strong></div>
          <div class="detail-row"><span>Badge ID</span><strong>${esc(badge.badgeId)}</strong></div>
          <div class="detail-row"><span>Issued</span><strong>${formatDate(badge.issuedAt)}</strong></div>
          <div class="detail-row"><span>Expires</span><strong>${badge.expiresAt ? formatDate(badge.expiresAt) : "No set expiration"}</strong></div>
        </div>
        <p style="margin-top:22px">Live verification completed just now. This scan has been recorded.</p>
        <div class="button-row" style="justify-content:center"><a class="btn btn-secondary" href="#/scan">Scan Another Badge</a></div>
      </div>
    </section>`;
}

function renderInvalidVerification(message) {
  appEl.innerHTML = `
    <section class="verify-shell"><div class="verify-card verify-invalid">
      <div class="verify-symbol">×</div><h1>INVALID BADGE</h1>
      <p>${esc(message)}</p><p>This verification attempt has been recorded.</p>
      <div class="button-row" style="justify-content:center"><a class="btn btn-secondary" href="#/scan">Scan Another Badge</a></div>
    </div></section>`;
}

async function logScan(badge, result, source, purpose = "Identity Verification", invalidValue = null) {
  try {
    await addDoc(collection(db, "scanLogs"), {
      badgeId:badge?.badgeId || null,
      credentialToken:badge?.credentialToken || null,
      fullName:badge?.fullName || null,
      tppId:badge?.tppId || null,
      result,
      source,
      purpose:purpose || "Identity Verification",
      scannerUid:session.profile?.role === "admin" ? session.user?.uid || null : null,
      invalidValue:invalidValue || null,
      scannedAt:serverTimestamp(),
      userAgent:navigator.userAgent.slice(0,180)
    });
  } catch (err) {
    console.warn("Scan logging failed", err);
  }
}

function renderAdminGate() {
  appEl.innerHTML = `
    ${pageHead("Administration","Administrator access required","Sign in with the administrator name and PIN created during system bootstrap.")}
    <section class="panel form-card"><a class="btn btn-primary btn-block" href="#/login/admin">Administrator Login</a></section>`;
}

async function renderAdminDashboard() {
  const [badgeSnap, scanSnap] = await Promise.all([
    getDocs(collection(db, "badges")),
    getDocs(collection(db, "scanLogs"))
  ]);
  const badges = badgeSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  const scans = scanSnap.docs.map(d => d.data());
  const counts = badges.reduce((a,b) => { const s=effectiveStatus(b); a[s]=(a[s]||0)+1; return a; }, {});
  const today = new Date().toDateString();
  const scansToday = scans.filter(s => {
    const d=s.scannedAt?.toDate?.(); return d && d.toDateString()===today;
  }).length;
  appEl.innerHTML = `
    ${pageHead("Administration","Badge Command Center","Issue credentials, review badge status, scan credentials, and inspect the audit trail.",
      '<a class="btn btn-primary" href="#/admin/issue">+ Issue Badge</a>')}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Active badges</div><div class="stat-value">${counts.active||0}</div></div>
      <div class="stat-card"><div class="stat-label">Revoked / lost</div><div class="stat-value">${(counts.revoked||0)+(counts.lost||0)+(counts.stolen||0)}</div></div>
      <div class="stat-card"><div class="stat-label">Suspended</div><div class="stat-value">${counts.suspended||0}</div></div>
      <div class="stat-card"><div class="stat-label">Scans today</div><div class="stat-value">${scansToday}</div></div>
    </div>
    <div class="quick-grid">
      <a class="quick-link" href="#/admin/issue"><strong>Issue badge</strong><span>Create a new official credential.</span></a>
      <a class="quick-link" href="#/admin/badges"><strong>Badge directory</strong><span>Find, review, revoke, or replace badges.</span></a>
      <a class="quick-link" href="#/scan"><strong>Open scanner</strong><span>Verify QR credentials on this device.</span></a>
      <a class="quick-link" href="#/admin/scans"><strong>Scan audit</strong><span>Review successful and failed scans.</span></a>
    </div>`;
}

function renderIssue() {
  const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear()+1);
  const exp = oneYear.toISOString().slice(0,10);
  appEl.innerHTML = `
    ${pageHead("Administration","Issue a badge","Create a live Prayer Project credential. No photograph is collected or stored.")}
    <section class="panel form-card">
      <form id="issueForm">
        <div class="form-grid">
          <div class="field full"><label for="issueName">Full name</label><input class="input" id="issueName" required></div>
          <div class="field"><label for="issueTitle">Position / title</label><input class="input" id="issueTitle" required placeholder="Volunteer, Director, Coordinator…"></div>
          <div class="field"><label for="issueTppId">TPP ID</label><input class="input" id="issueTppId" required placeholder="TPP-000001"></div>
          <div class="field"><label for="issueType">Credential type</label><select class="select" id="issueType"><option>Director</option><option>Officer</option><option>Staff</option><option selected>Volunteer</option><option>Partner</option><option>Temporary</option><option>Other</option></select></div>
          <div class="field"><label for="issueExpiry">Expiration date</label><input class="input" id="issueExpiry" type="date" value="${exp}"></div>
        </div>
        <div class="form-actions"><a class="btn btn-quiet" href="#/admin">Cancel</a><button class="btn btn-primary" type="submit">Issue Badge</button></div>
      </form>
    </section>`;
  document.getElementById("issueForm").addEventListener("submit", issueBadge);
}

async function issueBadge(e) {
  e.preventDefault();
  const fullName = document.getElementById("issueName").value.trim();
  const title = document.getElementById("issueTitle").value.trim();
  const tppId = document.getElementById("issueTppId").value.trim().toUpperCase();
  const credentialType = document.getElementById("issueType").value;
  const expiresAt = document.getElementById("issueExpiry").value || null;
  const nameHash = await sha256(normalizeName(fullName));
  const accessRef = doc(db, "accessDirectory", nameHash);
  const existing = await getDoc(accessRef);
  if (existing.exists()) {
    return toast("That exact name already has badge-holder access. Open the existing badge and use Replace Badge if needed.", "error");
  }
  setBusy(e.submitter, true, "Issuing…");
  try {
    const badgeId = makeBadgeId();
    const token = randomToken(28);
    const issuedAt = nowIso();
    const privateRecord = {
      badgeId, credentialToken:token, fullName, title, tppId, credentialType,
      status:"active", issuedAt, expiresAt, nameHash,
      publicRevocationReason:null, revocationCategory:null,
      createdBy:session.user.uid, createdAt:serverTimestamp()
    };
    const publicRecord = {
      badgeId, credentialToken:token, fullName, title, tppId, credentialType,
      status:"active", issuedAt, expiresAt, publicRevocationReason:null
    };
    const batch = writeBatch(db);
    batch.set(doc(db, "badges", badgeId), privateRecord);
    batch.set(doc(db, "publicCredentials", token), publicRecord);
    batch.set(accessRef, {
      badgeId, credentialToken:token, authEmail:holderEmail(nameHash),
      claimed:false, ownerUid:null, createdAt:serverTimestamp()
    });
    await batch.commit();
    toast("Badge issued.");
    location.hash = "#/admin/badge/" + encodeURIComponent(badgeId);
  } catch (err) {
    toast(friendlyError(err), "error");
    setBusy(e.submitter, false);
  }
}

async function renderBadgeDirectory() {
  const snap = await getDocs(collection(db, "badges"));
  const badges = snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  appEl.innerHTML = `
    ${pageHead("Administration","Badge directory","Search all issued Prayer Project credentials and open a badge for administrative actions.",
      '<a class="btn btn-primary" href="#/admin/issue">+ Issue Badge</a>')}
    <section class="panel">
      <div class="toolbar"><input class="input" id="badgeSearch" placeholder="Search name, TPP ID, badge ID, or title"></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Title</th><th>TPP ID</th><th>Badge</th><th>Status</th></tr></thead><tbody id="badgeRows"></tbody></table></div>
    </section>`;
  const draw = term => {
    const t = term.trim().toLowerCase();
    const filtered = badges.filter(b => !t || [b.fullName,b.title,b.tppId,b.badgeId].some(v => String(v||"").toLowerCase().includes(t)));
    document.getElementById("badgeRows").innerHTML = filtered.length ? filtered.map(b => `
      <tr data-id="${esc(b.badgeId)}"><td><strong>${esc(b.fullName)}</strong></td><td>${esc(b.title)}</td><td>${esc(b.tppId)}</td><td>${esc(b.badgeId)}</td><td>${statusPill(effectiveStatus(b))}</td></tr>`).join("") :
      '<tr><td colspan="5"><div class="empty-state"><strong>No badges found</strong>Try a different search.</div></td></tr>';
    document.querySelectorAll("#badgeRows tr[data-id]").forEach(row => row.onclick = () => location.hash = "#/admin/badge/" + encodeURIComponent(row.dataset.id));
  };
  draw("");
  document.getElementById("badgeSearch").addEventListener("input", e => draw(e.target.value));
}

async function renderAdminBadge(badgeId) {
  const snap = await getDoc(doc(db, "badges", badgeId));
  if (!snap.exists()) throw new Error("Badge not found.");
  const badge = snap.data();
  appEl.innerHTML = `
    ${pageHead("Administration","Badge record","Manage this credential and preview exactly what the badge holder carries.",
      '<a class="btn btn-secondary" href="#/admin/badges">Back to Directory</a>')}
    <div class="badge-layout">
      ${badgeCardHtml(badge, "adminBadgeQr", "adminBadgeCard")}
      <section class="panel">
        <h2>${esc(badge.fullName)}</h2>
        <p>${esc(badge.title)} · ${esc(badge.badgeId)}</p>
        <div class="detail-list">
          <div class="detail-row"><span>Status</span><strong>${statusPill(effectiveStatus(badge))}</strong></div>
          <div class="detail-row"><span>TPP ID</span><strong>${esc(badge.tppId)}</strong></div>
          <div class="detail-row"><span>Type</span><strong>${esc(badge.credentialType)}</strong></div>
          <div class="detail-row"><span>Issued</span><strong>${formatDate(badge.issuedAt)}</strong></div>
          <div class="detail-row"><span>Expires</span><strong>${badge.expiresAt ? formatDate(badge.expiresAt) : "No set expiration"}</strong></div>
          ${badge.publicRevocationReason ? '<div class="detail-row"><span>Revocation reason</span><strong>' + esc(badge.publicRevocationReason) + '</strong></div>' : ""}
        </div>
        <div class="button-row">
          <button class="btn btn-secondary" id="adminDownload">Download</button>
          <button class="btn btn-secondary" id="adminPrint">Print</button>
          <button class="btn btn-quiet" id="copyHolderInfo">Copy Holder Instructions</button>
          ${badge.status === "active" ? '<button class="btn btn-danger" id="revokeBadge">Revoke Badge</button><button class="btn btn-quiet" id="suspendBadge">Suspend</button>' : ""}
          ${badge.status === "suspended" ? '<button class="btn btn-primary" id="restoreBadge">Restore Badge</button>' : ""}
          ${["revoked","lost","stolen"].includes(badge.status) ? '<button class="btn btn-primary" id="replaceBadge">Issue Replacement</button>' : ""}
        </div>
      </section>
    </div>`;
  qrInto(document.getElementById("adminBadgeQr"), verifyUrl(badge.credentialToken), 256);
  document.getElementById("adminDownload").onclick = () => downloadBadgeImage("adminBadgeCard", badge);
  document.getElementById("adminPrint").onclick = () => printCredential(badge, badge.credentialToken);
  document.getElementById("copyHolderInfo").onclick = async () => {
    const text = "Your Prayer Project badge is ready. Go to https://badge.ask4prayers.com/#/login/holder, enter your full name exactly as \"" + badge.fullName + "\", and create your 4-digit PIN on first sign-in.";
    await navigator.clipboard.writeText(text);
    toast("Badge-holder instructions copied.");
  };
  const revoke = document.getElementById("revokeBadge");
  if (revoke) revoke.onclick = () => showRevokeModal(badge);
  const suspend = document.getElementById("suspendBadge");
  if (suspend) suspend.onclick = () => changeBadgeStatus(badge, "suspended");
  const restore = document.getElementById("restoreBadge");
  if (restore) restore.onclick = () => changeBadgeStatus(badge, "active");
  const replace = document.getElementById("replaceBadge");
  if (replace) replace.onclick = () => replaceBadge(badge);
}

function showRevokeModal(badge) {
  showModal("Revoke Badge", `
    <p>The revocation reason below will be displayed whenever this badge is scanned. Internal-only notes can be added later without exposing them publicly.</p>
    <form id="revokeForm">
      <div class="field"><label for="revCategory">Category</label><select class="select" id="revCategory"><option>Affiliation Ended</option><option>Lost</option><option>Stolen</option><option>Replacement Issued</option><option>Administrative Action</option><option>Other</option></select></div>
      <div class="field" style="margin-top:14px"><label for="revReason">Public revocation reason</label><textarea class="textarea" id="revReason" required placeholder="This reason will be shown when the revoked badge is scanned."></textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-quiet" data-close-modal>Cancel</button><button class="btn btn-danger" type="submit">Revoke Badge</button></div>
    </form>`);
  document.getElementById("revokeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const category = document.getElementById("revCategory").value;
    const reason = document.getElementById("revReason").value.trim();
    if (!reason) return;
    setBusy(e.submitter, true, "Revoking…");
    const status = category === "Lost" ? "lost" : category === "Stolen" ? "stolen" : "revoked";
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "badges", badge.badgeId), {
        status, revocationCategory:category, publicRevocationReason:reason,
        revokedAt:serverTimestamp(), revokedBy:session.user.uid
      });
      batch.update(doc(db, "publicCredentials", badge.credentialToken), {
        status, publicRevocationReason:reason
      });
      await batch.commit();
      closeModal();
      toast("Badge revoked. Future scans will show the reason.");
      route();
    } catch (err) {
      toast(friendlyError(err), "error");
      setBusy(e.submitter, false);
    }
  });
}

async function changeBadgeStatus(badge, status) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "badges", badge.badgeId), { status, updatedAt:serverTimestamp(), updatedBy:session.user.uid });
    batch.update(doc(db, "publicCredentials", badge.credentialToken), { status });
    await batch.commit();
    toast(status === "active" ? "Badge restored." : "Badge suspended.");
    route();
  } catch (err) { toast(friendlyError(err), "error"); }
}

async function replaceBadge(badge) {
  if (!confirm("Issue a replacement badge? The old credential will remain revoked and its QR will never become active again.")) return;
  try {
    const accessRef = doc(db, "accessDirectory", badge.nameHash);
    const accessSnap = await getDoc(accessRef);
    if (!accessSnap.exists()) throw new Error("Badge-holder access record is missing.");
    const access = accessSnap.data();
    const newBadgeId = makeBadgeId();
    const newToken = randomToken(28);
    const issuedAt = nowIso();
    const newPrivate = {
      ...badge, badgeId:newBadgeId, credentialToken:newToken, status:"active",
      issuedAt, publicRevocationReason:null, revocationCategory:null,
      replacedBadgeId:badge.badgeId, createdBy:session.user.uid, createdAt:serverTimestamp(),
      revokedAt:deleteField(), revokedBy:deleteField()
    };
    delete newPrivate.id;
    const newPublic = {
      badgeId:newBadgeId, credentialToken:newToken, fullName:badge.fullName, title:badge.title,
      tppId:badge.tppId, credentialType:badge.credentialType, status:"active",
      issuedAt, expiresAt:badge.expiresAt || null, publicRevocationReason:null
    };
    const batch = writeBatch(db);
    batch.update(doc(db, "badges", badge.badgeId), {
      status:"revoked", revocationCategory:"Replacement Issued",
      publicRevocationReason:"This badge was replaced by a newly issued credential.",
      revokedAt:serverTimestamp(), revokedBy:session.user.uid, replacementBadgeId:newBadgeId
    });
    batch.update(doc(db, "publicCredentials", badge.credentialToken), {
      status:"revoked", publicRevocationReason:"This badge was replaced by a newly issued credential."
    });
    batch.set(doc(db, "badges", newBadgeId), newPrivate);
    batch.set(doc(db, "publicCredentials", newToken), newPublic);
    batch.update(accessRef, { badgeId:newBadgeId, credentialToken:newToken, updatedAt:serverTimestamp() });
    if (access.ownerUid) {
      batch.update(doc(db, "badgeOwners", access.ownerUid), {
        badgeId:newBadgeId, credentialToken:newToken, updatedAt:serverTimestamp()
      });
    }
    await batch.commit();
    toast("Replacement badge issued.");
    location.hash = "#/admin/badge/" + encodeURIComponent(newBadgeId);
  } catch (err) { toast(friendlyError(err), "error"); }
}

async function renderScanHistory() {
  const snap = await getDocs(collection(db, "scanLogs"));
  const scans = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => {
    const at=a.scannedAt?.toMillis?.()||0, bt=b.scannedAt?.toMillis?.()||0; return bt-at;
  });
  appEl.innerHTML = `
    ${pageHead("Administration","Scan audit trail","Every successful, revoked, expired, and invalid verification attempt appears here.")}
    <section class="panel">
      <div class="toolbar"><input class="input" id="scanSearch" placeholder="Search badge, name, result, purpose, or TPP ID"></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Person / Badge</th><th>Purpose</th><th>Source</th><th>Result</th></tr></thead><tbody id="scanRows"></tbody></table></div>
    </section>`;
  const draw = term => {
    const t=term.trim().toLowerCase();
    const filtered=scans.filter(s => !t || [s.fullName,s.badgeId,s.tppId,s.result,s.purpose,s.source].some(v=>String(v||"").toLowerCase().includes(t)));
    document.getElementById("scanRows").innerHTML = filtered.length ? filtered.map(s => `
      <tr><td>${formatDate(s.scannedAt,true)}</td><td><strong>${esc(s.fullName || "Unknown credential")}</strong><br><small>${esc(s.badgeId || s.invalidValue || "—")}</small></td><td>${esc(s.purpose || "—")}</td><td>${esc(s.source || "—")}</td><td>${statusPill(s.result)}</td></tr>`).join("") :
      '<tr><td colspan="5"><div class="empty-state"><strong>No scan records</strong>No matching scans were found.</div></td></tr>';
  };
  draw("");
  document.getElementById("scanSearch").addEventListener("input", e=>draw(e.target.value));
}

function showModal(title, body) {
  const wrap=document.createElement("div");
  wrap.className="modal-backdrop";wrap.id="activeModal";
  wrap.innerHTML='<div class="modal"><div class="modal-head"><h2>'+esc(title)+'</h2><button class="icon-btn" data-close-modal aria-label="Close">×</button></div>'+body+'</div>';
  document.body.appendChild(wrap);
  wrap.addEventListener("click", e => {
    if (e.target === wrap || e.target.closest("[data-close-modal]")) closeModal();
  });
}
function closeModal(){ document.getElementById("activeModal")?.remove(); }

function renderNotFound() {
  appEl.innerHTML = '<section class="panel form-card"><h2>Page not found</h2><p>The requested Badge System page does not exist.</p><a class="btn btn-secondary" href="#/">Return home</a></section>';
}

function friendlyError(err) {
  const code = err?.code || "";
  if (code.includes("permission-denied")) return "Firebase denied this action. Confirm that the included Firestore rules have been deployed.";
  if (code.includes("email-already-in-use")) return "This badge login has already been claimed. Try signing in instead.";
  if (code.includes("weak-password")) return "The credential PIN could not be converted into an accepted sign-in credential.";
  if (code.includes("network-request-failed")) return "The network request failed. Check the connection and try again.";
  return err?.message || "The request could not be completed.";
}

route();
