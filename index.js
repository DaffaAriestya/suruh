/* =====================================================================
   UNESA SURUH - frontend
   Semua data berasal dari database lewat file .php (lihat sync_all.php).
   Identitas pengguna ditentukan server dari sesi login, bukan dari browser.
   ===================================================================== */

// ---------- STATE ----------
let currentRole = 'pemesan';          // 'pemesan' | 'mitra'
let currentActiveTab = 'landing';
let currentSelectedCategory = 'all';
let currentMitraArea = 'Ketintang';
let currentLoggedInUser = null;       // diisi dari server
let currentProvider = null;           // diisi dari server (null jika bukan mitra)

let platformFee = 1000;
let minPrice = 1000;
let minWithdraw = 10000;

let dbCategories = [
    { id_category: 1, nama_kategori: "Titip Makanan / Kantin", ikon: "fa-utensils", alur: "beli", mode_lokasi: "rute" },
    { id_category: 2, nama_kategori: "Print & Jilid Skripsi", ikon: "fa-print", alur: "print", mode_lokasi: "rute" },
    { id_category: 3, nama_kategori: "Ambil Paket Kos / Lobby", ikon: "fa-box-open", alur: "ambil", mode_lokasi: "rute" },
    { id_category: 4, nama_kategori: "Antar Dokumen / Berkas", ikon: "fa-file-signature", alur: "antar", mode_lokasi: "rute" },
    { id_category: 5, nama_kategori: "Beli Alat Tulis / Fotokopi", ikon: "fa-pen-ruler", alur: "beli", mode_lokasi: "rute" },
    { id_category: 7, nama_kategori: "Antar Jemput Orang", ikon: "fa-motorcycle", alur: "orang", mode_lokasi: "rute" },
    { id_category: 8, nama_kategori: "Bantuan Tugas / Bersih-Bersih", ikon: "fa-broom", alur: "kerja", mode_lokasi: "satu" },
    { id_category: 6, nama_kategori: "Permintaan Custom", ikon: "fa-wand-magic-sparkles", alur: "custom", mode_lokasi: "rute" }
]; // cadangan jika server belum terhubung; diganti data tabel `categories` setelah sinkron

let dbMyOrders = [];        // pesanan saya (sebagai pemesan)
let dbOpenOrders = [];      // bursa suruhan terbuka (untuk mitra)
let dbOffersReceived = [];  // tawaran masuk ke pesanan saya
let dbMyBids = [];          // tawaran yang saya kirim (sebagai mitra)
let dbPayments = [];
let dbReports = [];
let dbReviews = [];
let dbWallet = { total: 0, withdrawn: 0, available: 0, completed: 0, fee_total: 0 };
let dbWithdrawals = [];

let actionBusy = 0;         // >0 saat ada aksi yang sedang dikirim (jeda auto-refresh)
let syncWarned = false;
let snapshot = null;        // untuk mendeteksi perubahan dari pihak lain
let areaInitFor = null;

// ---------- UTILITAS ----------
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDate(s) {
    if (!s) return '-';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${+m[3]} ${BULAN[+m[2] - 1]} ${m[1]}, ${m[4]}:${m[5]}` : esc(s);
}
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || '-'; }
function waLink(hp, text) {
    let d = String(hp || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '62' + d.slice(1);
    return `https://wa.me/${d}?text=${encodeURIComponent(text || '')}`;
}
function avatarFor(name, url) {
    if (url) return url;
    const ini = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#003366"/><text x="50" y="64" font-size="40" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#FFC72C">${esc(ini)}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function statusBadge(s) {
    const map = { 'Menunggu Tawaran': 'bg-amber-100 text-amber-800', 'Diproses': 'bg-blue-100 text-blue-700', 'Selesai': 'bg-emerald-100 text-emerald-700', 'Dibatalkan': 'bg-slate-200 text-slate-600' };
    return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${map[s] || 'bg-slate-100 text-slate-600'}">${esc(s)}</span>`;
}
function el(id) { return document.getElementById(id); }
function setText(id, t) { const e = el(id); if (e) e.innerText = t; }

/** Kirim data ke server (POST JSON). Selalu mengembalikan {ok, message, data}. */
async function api(path, payload = {}, opts = {}) {
    const attempts = opts.retry ? 3 : 1;   // retry hanya untuk aksi yang aman diulang (mis. chat, lokasi, ON/OFF)
    let res, text, lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try {
            res = await fetch(path, {
                method: 'POST',
                redirect: 'manual',   // jangan ikuti pengalihan ke halaman error hosting
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'UNESA-Suruh' },
                body: JSON.stringify(payload)
            });
            if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
                return { ok: false, message: `Hosting menolak / mengalihkan permintaan ke ${path} (biasanya 403 Forbidden). Pastikan file ini sudah terupload dan izinnya 644 di File Manager.` };
            }
            text = await res.text();
            lastErr = null;
            break;
        } catch (e) {
            lastErr = e;
            console.warn('[api] koneksi ke', path, 'terputus:', e);
            if (i + 1 < attempts) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    if (lastErr) {
        return { ok: false, message: navigator.onLine === false
            ? 'Anda sedang offline. Periksa koneksi internet, lalu coba lagi.'
            : 'Koneksi ke server terputus sesaat (hosting gratis kadang sibuk). Silakan coba lagi.' };
    }
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, message: `Server mengirim respons tidak valid dari ${path} (HTTP ${res.status}). Pastikan file .php sudah diunggah dan config.php sudah diisi benar.` }; }
    if (res.status === 401 && currentLoggedInUser) handleSessionExpired();
    return { ok: data.status === 'success', message: data.message || '', data };
}

/** Cegah klik ganda: kunci tombol selama proses berjalan. */
async function lockRun(btn, fn) {
    if (btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }
    actionBusy++;
    try { await fn(); }
    finally {
        actionBusy--;
        if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-not-allowed'); }
    }
}
function submitBtn(event) { return event?.submitter || event?.target?.querySelector?.('[type="submit"]') || null; }

function handleSessionExpired() {
    closeChat(true);
    clearUserState();
    showToast('Sesi login berakhir. Silakan masuk kembali.', 'warning');
    renderAll();
    openLoginModal();
}
function clearUserState() {
    currentLoggedInUser = null; currentProvider = null; snapshot = null; areaInitFor = null;
    dbMyOrders = []; dbOpenOrders = []; dbOffersReceived = []; dbMyBids = [];
    dbPayments = []; dbReports = []; dbReviews = []; dbWithdrawals = []; dbPhotos = []; dbTracking = []; dbChatUnread = {}; providerBusy = false;
    if (typeof stopShare === 'function' && isSharing()) stopShare(false);
    dbWallet = { total: 0, withdrawn: 0, available: 0, completed: 0, fee_total: 0 };
}

// ---------- INISIALISASI ----------
window.onload = async function () {
    setRole('pemesan');
    switchTab('landing');
    renderCategoriesPemesan();
    updateAuthUIState();
    await syncAll();
    setInterval(() => { // hemat kuota hosting gratis: hanya saat tab terlihat & sudah login
        if (document.visibilityState === 'visible' && currentLoggedInUser && !actionBusy && !chatId) syncAll();
    }, 20000);
};
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentLoggedInUser && !actionBusy) syncAll();
});

// ---------- SINKRONISASI DATABASE -> TAMPILAN ----------
async function syncAll() {
    let r;
    try {
        const res = await fetch('sync_all.php', { credentials: 'same-origin', cache: 'no-store' });
        r = JSON.parse(await res.text());
    } catch (e) {
        if (!syncWarned) {
            showToast('Belum terhubung ke database. Cek config.php dan buka db_check.php.', 'error');
            syncWarned = true;
        }
        return false;
    }
    if (!r || r.status !== 'success') {
        if (!syncWarned) { showToast((r && r.message) || 'Gagal memuat data dari server.', 'error'); syncWarned = true; }
        return false;
    }
    syncWarned = false;

    const wasLoggedIn = !!currentLoggedInUser;
    const cfg = r.config || {};
    platformFee = Number(cfg.platform_fee ?? platformFee);
    minPrice = Number(cfg.min_price ?? minPrice);
    minWithdraw = Number(cfg.min_withdraw ?? minWithdraw);

    if (Array.isArray(r.categories) && r.categories.length) dbCategories = r.categories;
    currentLoggedInUser = r.user || null;
    currentProvider = r.provider || null;
    dbMyOrders = r.my_orders || [];
    dbOpenOrders = r.open_orders || [];
    dbOffersReceived = r.offers_received || [];
    dbMyBids = r.my_bids || [];
    dbPayments = r.payments || [];
    dbReports = r.reports || [];
    dbReviews = r.reviews || [];
    dbWithdrawals = r.withdrawals || [];
    dbPhotos = r.photos || [];
    dbTracking = r.tracking || [];
    if (cfg.flows) flows = cfg.flows;
    dbChatUnread = r.chat_unread || {};
    providerBusy = !!r.provider_busy;
    chatGraceHours = Number(cfg.chat_grace_hours ?? chatGraceHours);
    expireHours = Number(cfg.order_expire_hours ?? expireHours);
    dbWallet = r.wallet || { total: 0, withdrawn: 0, available: 0, completed: 0, fee_total: 0 };

    if (!currentLoggedInUser) {
        if (wasLoggedIn) { snapshot = null; }
        if (currentRole === 'mitra') setRole('pemesan');
    } else {
        // area kerja awal mitra mengikuti data di database
        if (currentProvider && areaInitFor !== currentLoggedInUser.id_user) {
            areaInitFor = currentLoggedInUser.id_user;
            currentMitraArea = currentProvider.Area_kerja || currentMitraArea;
        }
        notifyChanges();
    }
    renderAll();
    return true;
}

/** Beri tahu pengguna jika pihak lain melakukan sesuatu (tawaran baru, tawaran diterima, tugas selesai). */
function notifyChanges() {
    const _tc = toastCounter;
    const now = {
        offers: new Set(dbOffersReceived.map(o => String(o.id_offer))),
        bids: new Map(dbMyBids.map(b => [String(b.id_offer), b.status_offer])),
        orders: new Map(dbMyOrders.map(o => [String(o.id_Orders), o.status_order])),
        open: new Set(dbOpenOrders.map(o => String(o.id_Orders))),
        prog: new Map(dbMyOrders.map(o => [String(o.id_Orders), Number(o.progress || 0)])),
        chat: Object.assign({}, dbChatUnread),
        rep: new Map(dbReports.map(r => [String(r.id_report), r.Status])),
        bord: new Map(dbMyBids.map(b => [String(b.id_Orders), b.status_order]))
    };
    if (snapshot && snapshot.uid === currentLoggedInUser.id_user) {
        dbOffersReceived.forEach(o => {
            if (!snapshot.offers.has(String(o.id_offer)) && o.status_offer === 'Pending') {
                const ord = dbMyOrders.find(x => x.id_Orders === o.id_Orders);
                showToast(`Tawaran baru dari ${firstName(o.mitra_nama)} untuk "${ord ? ord.Judul : o.id_Orders}" (${rp(o.Harga_tawaran)})`, 'info');
            }
        });
        dbMyBids.forEach(b => {
            if (snapshot.bids.get(String(b.id_offer)) === 'Pending' && b.status_offer === 'Accepted')
                showToast(`Tawaran Anda diterima & sudah dibayar: "${b.Judul}". Hubungi pemesan lewat tab Tugas.`, 'success');
        });
        dbMyOrders.forEach(o => {
            if (snapshot.orders.get(String(o.id_Orders)) === 'Diproses' && o.status_order === 'Selesai')
                showToast(`"${o.Judul}" sudah diselesaikan Mitra. Jangan lupa beri ulasan!`, 'success');
        });
        dbMyOrders.forEach(o => {
            const before = snapshot.prog.get(String(o.id_Orders));
            if (before !== undefined && Number(o.progress) > before && o.status_order === 'Diproses')
                showToast(`"${o.Judul}": ${stepLabel(o)}`, 'info');
        });
        dbMyOrders.forEach(o => {
            if (['Diproses', 'Menunggu Tawaran'].includes(snapshot.orders.get(String(o.id_Orders))) && o.status_order === 'Dibatalkan')
                showToast(`"${o.Judul}" dibatalkan (${o.Dibatalkan_oleh || 'sistem'}): ${o.Alasan_batal || ''}`, 'warning');
        });
        dbMyBids.forEach(b => {
            if (snapshot.bord.get(String(b.id_Orders)) === 'Diproses' && b.status_order === 'Dibatalkan')
                showToast(`Tugas "${b.Judul}" dibatalkan: ${b.Alasan_batal || ''}`, 'warning');
        });
        dbReports.forEach(r => {
            if (snapshot.rep.get(String(r.id_report)) && snapshot.rep.get(String(r.id_report)) !== 'Selesai' && r.Status === 'Selesai')
                showToast(`Laporan #${r.id_report} sudah ditanggapi admin. Lihat di Pusat Kendala.`, 'success');
        });
        Object.keys(dbChatUnread).forEach(id => {
            if (Number(dbChatUnread[id]) > Number(snapshot.chat?.[id] || 0) && chatId !== id) {
                const o = findOrder(id);
                showToast(`Pesan baru di chat "${o ? o.Judul : id}"`, 'info');
            }
        });
        const baru = dbOpenOrders.filter(o => !snapshot.open.has(String(o.id_Orders)) && (o.Area_awal === currentMitraArea || o.Area_tujuan === currentMitraArea));
        if (currentRole === 'mitra' && baru.length) showToast(`${baru.length} suruhan baru di Kampus ${currentMitraArea}`, 'info');
    }
    if (snapshot && toastCounter > _tc) notifyBeep();   // bunyi hanya saat ada kabar baru dari pihak lain
    snapshot = Object.assign(now, { uid: currentLoggedInUser.id_user });
}

function renderAll() {
    ensureTracking();
    updateAuthUIState();
    renderNavForRole();
    renderCategoriesPemesan();
    renderPemesanOrders();
    renderPemesanOffers();
    renderPemesanPayments();
    renderMitraFeed();
    renderMitraTasks();
    renderMitraEarnings();
    renderMitraProfile();
    renderReports();
    renderMitraStatusBar();
    updateTabBadge();
    if (detailId) renderOrderDetail(false);
}

// ---------- AUTH ----------
function requireAuth() {
    if (!currentLoggedInUser) {
        showToast("Silakan masuk dengan akun UNESA terlebih dahulu!", "warning");
        openLoginModal();
        return false;
    }
    return true;
}

function handleStartOrderCTA() {
    if (!currentLoggedInUser) {
        showToast("Silakan login / daftar terlebih dahulu untuk membuat pesanan.", "info");
        openLoginModal();
    } else {
        setRole('pemesan');
        switchTab('pemesan-create');
    }
}

function handleBecomeMitraCTA() {
    if (!currentLoggedInUser) {
        showToast("Buat akun dulu, lalu centang \"Daftar sekaligus sebagai Mitra Suruh\".", "info");
        openRegisterModal();
        const chk = el('regIsProvider');
        if (chk) { chk.checked = true; toggleRegProviderFields(); }
    } else if (!currentProvider) {
        openBecomeMitraModal();
    } else {
        setRole('mitra');
        switchTab('mitra-feed');
    }
}

function checkAuthAndCreateOrder() {
    if (requireAuth()) switchTab('pemesan-create');
}

function afterAuthSuccess(user, provider) {
    currentLoggedInUser = user;
    currentProvider = provider || null;
    snapshot = null;
    if (currentProvider) { currentMitraArea = currentProvider.Area_kerja || currentMitraArea; areaInitFor = user.id_user; }
    updateAuthUIState();
    if (currentProvider) { setRole('mitra'); switchTab('mitra-feed'); }
    else { setRole('pemesan'); switchTab('pemesan-orders'); }
    return syncAll();
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const email = (el('loginEmail')?.value || '').trim();
        const password = el('loginPassword')?.value || '';
        const r = await api('login.php', { email, password });
        if (!r.ok) {
            const msg = r.message || 'Email atau kata sandi salah.';
            showLoginError(msg);
            return showToast(msg, 'error');
        }
        showLoginError('');
        closeLoginModal();
        if (el('loginPassword')) el('loginPassword').value = '';
        showToast(`Login berhasil! Selamat datang, ${r.data.user.Nama}`, 'success');
        await afterAuthSuccess(r.data.user, r.data.provider);
    });
}

async function handleRegisterSubmit(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const isMitra = !!el('regIsProvider')?.checked;
        const payload = {
            nama: el('regNama')?.value || '',
            email: el('regEmail')?.value || '',
            no_hp: el('regNoHp')?.value || '',
            password: el('regPassword')?.value || '',
            gender: el('regGender')?.value || 'L',
            is_mitra: isMitra,
            nim: isMitra ? (el('regNIM')?.value || '') : '',
            fakultas: isMitra ? (el('regFakultas')?.value || '') : '',
            area_kerja: isMitra ? (el('regAreaKerja')?.value || '') : ''
        };
        const r = await api('register.php', payload);
        if (!r.ok) return showToast('Gagal mendaftar: ' + r.message, 'error');
        closeRegisterModal();
        showToast('Pendaftaran berhasil! Akun tersimpan di database.', 'success');
        await afterAuthSuccess(r.data.user, r.data.provider);
    });
}

async function handleLogout() {
    closeOrderDetail();
    closeChat(true);
    await api('logout.php');
    clearUserState();
    setRole('pemesan');
    renderAll();
    switchTab('landing');
    showToast('Anda telah keluar dari akun.', 'info');
}

function openLoginModal() { showLoginError(''); el('modalLogin')?.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }
/** Pesan kesalahan login tepat di dalam kotak login agar langsung terlihat. */
function showLoginError(msg) {
    const b = el('loginError');
    if (!b) return;
    b.textContent = msg || '';
    b.classList.toggle('hidden', !msg);
}
function closeLoginModal() { el('modalLogin')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
function openRegisterModal() { el('modalRegister')?.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }
function closeRegisterModal() { el('modalRegister')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
function toggleRegProviderFields() {
    el('regProviderFields')?.classList.toggle('hidden', !el('regIsProvider')?.checked);
}

// Pengguna yang sudah punya akun mendaftar jadi Mitra
function openBecomeMitraModal() { el('modalBecomeMitra')?.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }
function closeBecomeMitraModal() { el('modalBecomeMitra')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
async function handleBecomeMitra(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const r = await api('become_mitra.php', {
            nim: el('bmNIM')?.value || '',
            fakultas: el('bmFakultas')?.value || '',
            area_kerja: el('bmArea')?.value || ''
        });
        if (!r.ok) return showToast(r.message || 'Gagal mendaftar sebagai Mitra.', 'error');
        closeBecomeMitraModal();
        showToast('Selamat! Anda sekarang terdaftar sebagai Mitra Suruh.', 'success');
        await afterAuthSuccess(r.data.user, r.data.provider);
    });
}

function updateAuthUIState() {
    const userState = el('authUserState'), guestState = el('authGuestState');
    if (currentLoggedInUser) {
        userState?.classList.remove('hidden');
        guestState?.classList.add('hidden');
        setText('userNameNav', currentLoggedInUser.Nama || 'Pengguna UNESA');
        setText('userRoleNav', currentProvider ? `Mitra (${currentProvider.Area_kerja})` : 'Pemesan');
        const av = el('userAvatarNav');
        if (av) av.src = avatarFor(currentLoggedInUser.Nama, currentLoggedInUser.Foto_profil);
    } else {
        userState?.classList.add('hidden');
        guestState?.classList.remove('hidden');
    }
    document.querySelectorAll('.guest-only').forEach(e => e.classList.toggle('hidden', !!currentLoggedInUser));
    el('adminLink')?.classList.toggle('hidden', !(currentLoggedInUser && Number(currentLoggedInUser.is_admin)));
}

// ---------- ROLE & NAVIGASI ----------
const NAV_PEMESAN = [
    ['landing', 'fa-house text-unesa-navy', 'Beranda'],
    ['pemesan-orders', 'fa-box-archive text-amber-500', 'Pesanan Saya'],
    ['pemesan-create', 'fa-circle-plus text-unesa-navy', 'Buat Pesanan'],
    ['pemesan-offers', 'fa-comments-dollar text-emerald-600', 'Tawaran Masuk'],
    ['pemesan-payments', 'fa-receipt text-indigo-600', 'Pembayaran'],
    ['reports-list', 'fa-triangle-exclamation text-rose-500', 'Pusat Kendala']
];
const NAV_MITRA = [
    ['landing', 'fa-house text-unesa-navy', 'Beranda'],
    ['mitra-feed', 'fa-briefcase text-amber-500', 'Bursa Suruhan'],
    ['mitra-tasks', 'fa-tasks text-emerald-600', 'Tugas & Penawaran'],
    ['mitra-earnings', 'fa-wallet text-amber-500', 'Pendapatan'],
    ['mitra-profile', 'fa-id-card text-indigo-600', 'Profil & KTM'],
    ['reports-list', 'fa-triangle-exclamation text-rose-500', 'Pusat Kendala']
];

function navBadgeCount(tabId) {
    if (tabId === 'pemesan-offers') return dbOffersReceived.filter(o => o.status_offer === 'Pending').length;
    if (tabId === 'mitra-tasks') return dbMyBids.filter(b => b.status_offer === 'Accepted' && b.status_order === 'Diproses').length;
    return 0;
}

function renderNavForRole() {
    const container = el('navTabsList');
    if (!container) return;
    const items = currentRole === 'pemesan' ? NAV_PEMESAN : NAV_MITRA;
    container.innerHTML = items.map(([id, icon, label]) => {
        const n = navBadgeCount(id);
        const handler = id === 'pemesan-create' ? 'checkAuthAndCreateOrder()' : `switchTab('${id}')`;
        return `<button onclick="${handler}" id="tab-${id}" class="nav-tab px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl flex items-center space-x-1.5 whitespace-nowrap hover:bg-slate-100 shrink-0">
            <i class="fa-solid ${icon} text-xs sm:text-sm"></i>
            <span>${label}</span>
            ${n ? `<span class="bg-rose-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">${n}</span>` : ''}
        </button>`;
    }).join('');
    highlightActiveTab(false);
}

function setRole(role) {
    if (role === 'mitra') {
        if (!currentLoggedInUser) { showToast('Masuk atau daftar dulu untuk menjadi Mitra Suruh.', 'warning'); openLoginModal(); return; }
        if (!currentProvider) { showToast('Akun Anda belum terdaftar sebagai Mitra. Lengkapi data berikut.', 'info'); openBecomeMitraModal(); return; }
    }
    currentRole = role;
    const btnPemesan = el('btnRolePemesan'), btnMitra = el('btnRoleMitra'), roleBadge = el('roleIndicatorBadge');
    const base = "flex-1 px-3 py-1.5 sm:px-4 rounded-lg text-xs font-bold transition-all duration-200 whitespace-nowrap text-center";

    if (role === 'pemesan') {
        if (btnPemesan) btnPemesan.className = `${base} bg-unesa-gold text-unesa-navy shadow`;
        if (btnMitra) btnMitra.className = `${base} text-slate-300 hover:text-white`;
        if (roleBadge) {
            roleBadge.className = "hidden md:inline-block text-[10px] bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap";
            roleBadge.innerText = "Portal Pemesan";
        }
        renderNavForRole();
        if (currentActiveTab !== 'landing') switchTab('pemesan-orders');
    } else {
        if (btnMitra) btnMitra.className = `${base} bg-emerald-500 text-white shadow`;
        if (btnPemesan) btnPemesan.className = `${base} text-slate-300 hover:text-white`;
        if (roleBadge) {
            roleBadge.className = "hidden md:inline-block text-[10px] bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap";
            roleBadge.innerText = `Portal Mitra (${currentMitraArea})`;
        }
        renderNavForRole();
        if (currentActiveTab !== 'landing') switchTab('mitra-feed');
    }
}

function highlightActiveTab(scroll) {
    document.querySelectorAll('.nav-tab').forEach(b => {
        b.classList.remove('bg-unesa-navy', 'bg-emerald-700', 'text-white');
        b.classList.add('hover:bg-slate-100');
    });
    const btn = el('tab-' + currentActiveTab);
    if (btn) {
        btn.classList.remove('hover:bg-slate-100');
        btn.classList.add(currentRole === 'pemesan' ? 'bg-unesa-navy' : 'bg-emerald-700', 'text-white');
        if (scroll) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function switchTab(tabId) {
    currentActiveTab = tabId;
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    el('view-' + tabId)?.classList.remove('hidden');
    highlightActiveTab(true);

    if (tabId === 'pemesan-orders') { renderCategoriesPemesan(); renderPemesanOrders(); }
    if (tabId === 'pemesan-create') {
        renderCategoriesPemesan(); renderPhotoBox('order'); renderPointChip('awal'); renderPointChip('tujuan');
        onCategoryChange();
    }
    if (tabId === 'pemesan-offers') renderPemesanOffers();
    if (tabId === 'pemesan-payments') renderPemesanPayments();
    if (tabId === 'mitra-feed') renderMitraFeed();
    if (tabId === 'mitra-tasks') renderMitraTasks();
    if (tabId === 'mitra-earnings') renderMitraEarnings();
    if (tabId === 'mitra-profile') renderMitraProfile();
    if (tabId === 'reports-list') renderReports();
    if (currentLoggedInUser && !actionBusy && tabId !== 'landing') syncAll(); // data terbaru saat pindah tab
}

function changeMitraArea(newArea) {
    currentMitraArea = newArea;
    if (el('selectFeedAreaFilter')) el('selectFeedAreaFilter').value = newArea;
    setText('lblFeedActiveArea', newArea);
    if (currentRole === 'mitra') {
        setText('roleIndicatorBadge', `Portal Mitra (${newArea})`);
        renderMitraFeed();
        showToast(`Menampilkan suruhan di Kampus ${newArea}`, 'info');
    }
}

async function updateProfileArea(newArea) {
    if (!currentProvider) return;
    const r = await api('update_area.php', { area_kerja: newArea });
    if (!r.ok) { showToast(r.message || 'Gagal menyimpan area kerja.', 'error'); renderMitraProfile(); return; }
    currentProvider.Area_kerja = newArea;
    changeMitraArea(newArea);
    updateAuthUIState();
    renderMitraProfile();
    showToast('Area kerja utama disimpan.', 'success');
}

// ---------- KATEGORI ----------
function renderCategoriesPemesan() {
    const container = el('categoriesContainerPemesan');
    const catSelect = el('orderCategory');

    if (catSelect) {
        const keep = catSelect.value;
        catSelect.innerHTML = dbCategories.map(c =>
            `<option value="${Number(c.id_category)}">${esc(c.nama_kategori)}</option>`).join('');
        if (keep) catSelect.value = keep;
    }
    if (!container) return;

    const btn = (id, icon, label) => {
        const active = String(currentSelectedCategory) === String(id);
        return `<button onclick="selectCategory(${id === 'all' ? "'all'" : Number(id)})" class="p-2 sm:p-2.5 rounded-xl border text-left flex items-center space-x-2 transition ${active ? 'bg-unesa-navy text-white border-unesa-navy' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}">
            <div class="w-6 h-6 sm:w-7 sm:h-7 rounded-lg ${active ? 'bg-unesa-gold text-unesa-navy' : 'bg-white text-unesa-navy'} flex items-center justify-center font-bold shrink-0 text-xs"><i class="fa-solid ${esc(icon)}"></i></div>
            <span class="font-bold text-[11px] sm:text-xs truncate">${esc(label)}</span>
        </button>`;
    };
    container.innerHTML = btn('all', 'fa-border-all', 'Semua Kategori') + dbCategories.map(c => btn(c.id_category, c.ikon, c.nama_kategori)).join('');
}

function selectCategory(catId) {
    currentSelectedCategory = catId;
    renderCategoriesPemesan();
    renderPemesanOrders();
}

// ---------- PEMESAN: PESANAN SAYA ----------
function routeBox(o) {
    if (o.Mode_lokasi === 'satu') {
        return `<div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
            <div class="flex items-center text-slate-600 space-x-2 min-w-0">
                <span class="bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shrink-0">LOKASI</span>
                <span class="truncate">📍 <strong>${esc(o.Area_awal)}</strong> - ${esc(o.Lokasi_awal)}</span>
            </div></div>`;
    }
    return `<div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs space-y-1">
        <div class="flex items-center text-slate-600 space-x-2 min-w-0">
            <span class="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shrink-0">JEMPUT</span>
            <span class="truncate">📍 <strong>${esc(o.Area_awal)}</strong> - ${esc(o.Lokasi_awal)}</span>
        </div>
        <div class="flex items-center text-slate-600 space-x-2 min-w-0">
            <span class="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shrink-0">TUJUAN</span>
            <span class="truncate">📍 <strong>${esc(o.Area_tujuan)}</strong> - ${esc(o.Lokasi_tujuan)}</span>
        </div>
    </div>`;
}

function renderPemesanOrders() {
    const container = el('pemesanOrdersGrid');
    if (!container) return;

    if (!currentLoggedInUser) {
        container.innerHTML = `<div class="col-span-full text-center py-8 sm:py-10 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
            <i class="fa-solid fa-user-lock text-3xl sm:text-4xl text-amber-500 mb-2"></i>
            <h4 class="font-bold text-slate-800 text-sm">Mode Tamu / Belum Masuk Akun</h4>
            <p class="text-xs text-slate-500 mt-1 mb-4">Masuk ke akun Anda untuk melihat pesanan yang Anda buat.</p>
            <button onclick="openLoginModal()" class="px-4 py-2 bg-unesa-navy text-unesa-gold font-bold text-xs rounded-xl shadow">Masuk Akun Pemesan</button></div>`;
        return;
    }

    let list = dbMyOrders;
    if (currentSelectedCategory !== 'all') list = list.filter(o => String(o.id_category) === String(currentSelectedCategory));

    if (!list.length) {
        container.innerHTML = `<div class="col-span-full text-center py-8 sm:py-10 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
            <i class="fa-solid fa-inbox text-3xl sm:text-4xl text-slate-300 mb-2"></i>
            <p class="font-bold text-slate-600 text-sm">Belum ada pesanan suruhan</p>
            <p class="text-xs text-slate-400 mt-1 mb-3">Klik tombol di bawah untuk membuat permintaan bantuan baru.</p>
            <button onclick="switchTab('pemesan-create')" class="px-4 py-2 bg-unesa-navy text-unesa-gold font-bold text-xs rounded-xl shadow">+ Buat Pesanan Baru</button></div>`;
        return;
    }

    container.innerHTML = list.map(o => {
        const offersCount = dbOffersReceived.filter(f => f.id_Orders === o.id_Orders).length;
        const hasMitra = o.id_provider && (o.status_order === 'Diproses' || o.status_order === 'Selesai');
        const harga = o.Harga_final || o.Harga_diajukan;
        const id = esc(o.id_Orders);
        let action = '';

        if (o.status_order === 'Menunggu Tawaran') {
            action = `<button onclick="cancelOrder(this,'${id}')" class="px-2.5 py-1.5 bg-white text-slate-500 border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold transition">Batalkan</button>
                <button onclick="switchTab('pemesan-offers')" class="px-2.5 py-1.5 bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 rounded-xl text-xs font-bold transition">📩 ${offersCount} Tawaran</button>`;
        } else if (o.status_order === 'Diproses' && Number(o.progress) === 0) {
            action = `<button onclick="cancelPaidOrder(this,'${id}')" class="px-2.5 py-1.5 bg-white text-rose-600 border border-rose-300 hover:bg-rose-50 rounded-xl text-xs font-bold transition">Batalkan & Refund</button>`;
        } else if (o.status_order === 'Dibatalkan') {
            action = `<span class="text-[11px] text-slate-500 italic">${esc(o.Alasan_batal || 'Dibatalkan')}</span>`;
        } else if (o.status_order === 'Selesai' && !Number(o.has_review)) {
            action = `<button onclick="openReviewModal('${id}')" class="px-3 py-1.5 bg-amber-400 hover:bg-amber-500 text-unesa-navy rounded-xl text-xs font-bold transition">⭐ Beri Ulasan</button>`;
        } else if (o.status_order === 'Selesai') {
            action = `<span class="text-[11px] font-bold text-emerald-700">✔ Sudah diulas</span>`;
        }

        const mitraBox = hasMitra ? `<div class="bg-blue-50 border border-blue-100 rounded-xl p-2.5 text-xs">
                <span class="block text-[10px] text-slate-400">Dikerjakan oleh</span>
                <strong class="text-slate-800 truncate block">${esc(o.mitra_nama)}</strong>
                <span class="text-amber-600 font-bold">${Number(o.mitra_total) ? '⭐ ' + Number(o.mitra_rating || 0).toFixed(1) : 'Mitra baru'}</span>
            </div>` : '';
        const progressBlock = o.status_order === 'Diproses'
            ? `<div class="space-y-1">${progressBar(o)}<p class="text-[11px] font-bold text-blue-700"><i class="fa-solid fa-circle-dot mr-1"></i>${esc(stepLabel(o))}</p>
               ${o.kode_selesai ? `<p class="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2 py-1">Kode serah terima: <strong class="tracking-widest text-sm">${esc(o.kode_selesai)}</strong> <span class="text-amber-700">(beri ke Mitra setelah barang diterima)</span></p>` : ''}</div>` : '';
        const reorderBtn = ['Selesai', 'Dibatalkan'].includes(o.status_order) ? `<button onclick="reorder('${id}')" class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"><i class="fa-solid fa-rotate-right mr-1"></i>Pesan Lagi</button>` : '';
        const expireNote = o.status_order === 'Menunggu Tawaran' ? `<p class="text-[10px] text-slate-400">Otomatis hangus jika tidak ada tawaran dibayar dalam ${expireHours} jam sejak dibuat.</p>` : '';
        const detailBtn = `<button onclick="openOrderDetail('${id}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"><i class="fa-solid fa-map-location-dot mr-1"></i>${o.status_order === 'Diproses' ? 'Lacak' : 'Detail'}</button>`;

        return `<div class="bg-white rounded-2xl border ${Number(o.is_custom) ? 'border-purple-300 bg-purple-50/20' : 'border-slate-200'} p-4 sm:p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-3 sm:space-y-4">
            <div class="space-y-2">
                <div class="flex justify-between items-start gap-2">
                    <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 min-w-0">
                        <i class="fa-solid ${esc(o.ikon || 'fa-tag')}"></i><span class="truncate max-w-[120px]">${esc(o.nama_kategori || 'Reguler')}</span></span>
                    ${statusBadge(o.status_order)}
                </div>
                <div class="flex justify-between items-center text-[10px] text-slate-400 font-mono"><span>${id}</span><span>${fmtDate(o.created_at)}</span></div>
                <h4 class="font-bold text-slate-800 text-sm">${esc(o.Judul)}</h4>
                <p class="text-xs text-slate-500 line-clamp-2">${esc(o.Deskripsi_Permintaan)}</p>
                ${routeBox(o)}
                ${progressBlock}
                ${expireNote}
                ${mitraBox}
            </div>
            <div class="border-t border-slate-100 pt-3 space-y-2">
                <div><span class="block text-[10px] text-slate-400 font-semibold uppercase">${o.Harga_final ? 'Tarif Disepakati' : 'Tarif Imbalan'}</span>
                    <span class="text-sm font-extrabold text-emerald-600">${rp(harga)}</span></div>
                <div class="flex flex-wrap items-center gap-2">${detailBtn}${chatBtn(o)}${reorderBtn}${action}</div>
            </div>
        </div>`;
    }).join('');
}

async function handleCreateOrder(event) {
    event.preventDefault();
    if (!requireAuth()) return;
    await lockRun(submitBtn(event), async () => {
        const harga = parseInt(el('orderHargaDiajukan')?.value || 0, 10);
        if (!(harga >= minPrice)) return showToast(`Tulis tarif yang kamu tawarkan (minimal ${rp(minPrice)}).`, 'warning');
        if (!el('orderSetuju')?.checked) return showToast('Centang persetujuan aturan barang dan permintaan terlarang dulu.', 'warning');
        const mode = orderModeNow();
        for (const w of (mode === 'satu' ? ['awal'] : ['awal', 'tujuan'])) {
            const g = orderGeo[w];
            if (g.invalid) return showToast('Link Google Maps tidak valid.', 'warning');
            if (g.lat === null && !g.url) return showToast(`Tentukan titik ${mode === 'satu' ? 'pengerjaan' : (w === 'awal' ? 'jemput' : 'tujuan')} di peta atau tempel link Google Maps.`, 'warning');
        }
        if (!photosReady('order')) return showToast('Tunggu foto selesai diunggah.', 'info');
        const A = orderGeo.awal, T = mode === 'satu' ? orderGeo.awal : orderGeo.tujuan;
        const r = await api('create_order.php', {
            judul: el('orderJudul')?.value || '',
            id_category: parseInt(el('orderCategory')?.value || 0, 10),
            mode_lokasi: mode,
            setuju: true,
            harga,
            area_awal: el('orderAreaAwal')?.value || '',
            lokasi_awal: el('orderLokasiAwalDetail')?.value || '',
            lat_awal: A.lat, lng_awal: A.lng, peta_awal_url: A.url,
            area_tujuan: mode === 'satu' ? (el('orderAreaAwal')?.value || '') : (el('orderAreaTujuan')?.value || ''),
            lokasi_tujuan: mode === 'satu' ? (el('orderLokasiAwalDetail')?.value || '') : (el('orderLokasiTujuanDetail')?.value || ''),
            lat_tujuan: T.lat, lng_tujuan: T.lng, peta_tujuan_url: T.url,
            deskripsi: el('orderDeskripsi')?.value || '',
            photo_ids: photoIds('order')
        });
        if (!r.ok) return showToast('Gagal menyimpan pesanan: ' + r.message, 'error');
        showToast('Suruhan Anda dipublikasikan. Mitra yang sesuai akan segera melihatnya.', 'success');
        el('formCreateOrder')?.reset();
        resetOrderGeo();
        resetPhotoBox('order');
        onCategoryChange();
        await syncAll();
        switchTab('pemesan-orders');
    });
}

async function cancelOrder(btn, orderId) {
    if (!confirm('Batalkan pesanan ini? Semua tawaran yang masuk akan ditolak.')) return;
    await lockRun(btn, async () => {
        const r = await api('cancel_order.php', { id_orders: orderId });
        if (!r.ok) return showToast(r.message || 'Gagal membatalkan pesanan.', 'error');
        showToast('Pesanan dibatalkan.', 'info');
        await syncAll();
    });
}

// ---------- PEMESAN: TAWARAN MASUK & PEMBAYARAN ----------
function renderPemesanOffers() {
    const container = el('pemesanOffersContainer');
    if (!container) return;
    const empty = msg => `<div class="p-6 sm:p-8 text-center text-slate-400 font-bold bg-white rounded-2xl border text-xs sm:text-sm">${msg}</div>`;

    if (!currentLoggedInUser) { container.innerHTML = empty('Silakan login sebagai Pemesan untuk melihat tawaran mitra.'); return; }
    const orders = dbMyOrders.filter(o => o.status_order !== 'Dibatalkan');
    if (!orders.length) { container.innerHTML = empty('Anda belum membuat pesanan aktif.'); return; }

    const rank = { 'Menunggu Tawaran': 0, 'Diproses': 1, 'Selesai': 2 };
    orders.sort((a, b) => (rank[a.status_order] ?? 9) - (rank[b.status_order] ?? 9));

    container.innerHTML = orders.map(ord => {
        const offers = dbOffersReceived.filter(f => f.id_Orders === ord.id_Orders);
        const offerHtml = offers.map(off => {
            let right;
            if (off.status_offer === 'Accepted') right = `<span class="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-lg">Diterima & Dibayar</span>`;
            else if (off.status_offer === 'Rejected') right = `<span class="bg-slate-200 text-slate-500 text-xs font-bold px-3 py-1 rounded-lg">Tidak dipilih</span>`;
            else right = `<button onclick="acceptOffer('${esc(ord.id_Orders)}', ${Number(off.id_offer)})" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow">Terima & Bayar</button>`;
            const rating = Number(off.mitra_total) > 0 ? `⭐ ${Number(off.mitra_rating).toFixed(1)} · ${Number(off.mitra_total)} tugas` : 'Mitra baru';
            return `<div class="bg-slate-50 p-3 sm:p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${off.status_offer === 'Rejected' ? 'opacity-60' : ''}">
                <div class="min-w-0 flex-grow">
                    <span class="font-bold text-xs text-slate-800">${esc(off.mitra_nama)}</span>
                    <span class="text-[10px] text-slate-500 ml-1">${rating} · ${esc(off.mitra_fakultas)}</span>
                    <p class="text-xs text-slate-600 mt-0.5 italic">"${esc(off.Pesan)}"</p>
                </div>
                <div class="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                    <span class="font-extrabold text-sm text-emerald-700">${rp(off.Harga_tawaran)}</span>${right}
                </div></div>`;
        }).join('');

        return `<div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 sm:space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                    <div class="flex items-center space-x-2">
                        <span class="font-mono text-xs font-bold text-unesa-navy bg-slate-100 px-2 py-0.5 rounded">${esc(ord.id_Orders)}</span>${statusBadge(ord.status_order)}
                    </div>
                    <h4 class="font-bold text-slate-800 text-sm sm:text-base mt-1">${esc(ord.Judul)}</h4>
                </div>
                <div><span class="text-[10px] text-slate-400 block">${ord.Harga_final ? 'Tarif Disepakati' : 'Imbalan Diajukan'}</span>
                    <span class="font-extrabold text-emerald-600 text-sm sm:text-base">${rp(ord.Harga_final || ord.Harga_diajukan)}</span></div>
            </div>
            <div class="space-y-2">
                <h5 class="text-xs font-bold text-slate-600">Daftar Tawaran Masuk (${offers.length})</h5>
                ${offers.length ? offerHtml : `<p class="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl">Belum ada Mitra Suruh yang mengirim penawaran.</p>`}
            </div></div>`;
    }).join('');
}

function acceptOffer(orderId, offerId) {
    const off = dbOffersReceived.find(f => Number(f.id_offer) === Number(offerId));
    if (!off) return showToast('Tawaran tidak ditemukan. Muat ulang halaman.', 'error');
    const harga = Number(off.Harga_tawaran);
    el('payOrderId').value = orderId;
    el('payOfferId').value = offerId;
    setText('payHargaFinalText', rp(harga));
    setText('payTotalBayarText', rp(harga + platformFee));
    openPaymentModal();
}
function openPaymentModal() { el('modalPayment')?.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); }
function closePaymentModal() { el('modalPayment')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

async function handleProcessPayment(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const r = await api('process_payment.php', {
            id_orders: el('payOrderId')?.value,
            id_offer: parseInt(el('payOfferId')?.value || 0, 10),
            metode: el('payMetode')?.value
        });
        if (!r.ok) { showToast('Gagal memproses pembayaran: ' + r.message, 'error'); await syncAll(); return; }
        closePaymentModal();
        showToast('Pembayaran lunas & tercatat. Hubungi Mitra lewat tombol WhatsApp di Pesanan Saya.', 'success');
        await syncAll();
        switchTab('pemesan-orders');
    });
}

function renderPemesanPayments() {
    const tbody = el('pemesanPaymentsTableBody');
    if (!tbody) return;
    if (!dbPayments.length) { tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">Belum ada riwayat pembayaran lunas.</td></tr>`; return; }
    tbody.innerHTML = dbPayments.map(p => `<tr class="hover:bg-slate-50 transition">
        <td class="p-3.5 font-mono font-bold text-unesa-navy">${esc(p.id_Payment)}</td>
        <td class="p-3.5"><span class="font-mono font-bold text-slate-600 block">${esc(p.id_Orders)}</span><span class="text-[10px] text-slate-400">${esc(p.Judul)}</span></td>
        <td class="p-3.5 font-semibold text-slate-800">${esc(p.Metode)}</td>
        <td class="p-3.5 font-bold text-slate-700">${rp(p.Jumlah)}</td>
        <td class="p-3.5 text-slate-500">${rp(p.Biaya_platform)}</td>
        <td class="p-3.5 font-extrabold text-emerald-700">${rp(p.Total_bayar)}</td>
        <td class="p-3.5"><span class="${p.Status === 'Dikembalikan' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-800'} font-bold px-2.5 py-0.5 rounded-full text-[10px]">${esc(p.Status || 'Lunas')}</span></td>
        <td class="p-3.5 text-slate-400 font-mono">${fmtDate(p.paid_at)}</td></tr>`).join('');
}

// ---------- ULASAN (pemesan menilai mitra) ----------
function closeReviewModal() { el('modalReview')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
// ---------- MITRA: BURSA SURUHAN ----------
function renderMitraFeed() {
    const container = el('mitraFeedGrid');
    if (!container) return;
    setText('lblFeedActiveArea', currentMitraArea);
    if (el('selectFeedAreaFilter') && el('selectFeedAreaFilter').value !== currentMitraArea) el('selectFeedAreaFilter').value = currentMitraArea;

    const emptyBox = (icon, title, sub, btn = '') => `<div class="col-span-full text-center py-8 sm:py-12 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
        <i class="fa-solid ${icon} text-3xl sm:text-4xl text-slate-300 mb-2"></i><p class="font-bold text-slate-600 text-sm">${title}</p><p class="text-xs text-slate-400 mt-1">${sub}</p>${btn ? `<div class="mt-3">${btn}</div>` : ''}</div>`;

    if (!currentLoggedInUser || !currentProvider) { container.innerHTML = emptyBox('fa-lock', 'Bursa suruhan khusus Mitra', 'Masuk dan daftar sebagai Mitra Suruh untuk melihat pesanan terbuka.'); return; }
    if (currentProvider.Status_verifikasi !== 'Terverifikasi') {
        const rej = currentProvider.Status_verifikasi === 'Ditolak';
        container.innerHTML = emptyBox(rej ? 'fa-circle-xmark' : 'fa-hourglass-half', rej ? 'Verifikasi Mitra ditolak' : 'Akun Mitra menunggu verifikasi', (rej ? esc(currentProvider.Catatan_verifikasi || 'Silakan kirim ulang KTM yang jelas.') : 'Unggah foto KTM di tab Profil, lalu tunggu admin memeriksa.'), `<button onclick="switchTab('mitra-profile')" class="px-4 py-2 bg-unesa-navy text-unesa-gold font-bold text-xs rounded-xl shadow">Buka Profil & KTM</button>`);
        return;
    }
    if (providerBusy) { container.innerHTML = emptyBox('fa-person-running', 'Anda sedang mengerjakan tugas', 'Selesaikan tugas yang berjalan dulu sebelum menerima suruhan lain.', `<button onclick="switchTab('mitra-tasks')" class="px-4 py-2 bg-emerald-700 text-white font-bold text-xs rounded-xl shadow">Buka Tugas Saya</button>`); return; }
    if (Number(currentProvider.is_online) !== 1) { container.innerHTML = emptyBox('fa-power-off', 'Status Anda sedang OFF', 'Nyalakan "Siap Menerima Suruhan" untuk melihat dan menawar suruhan.', `<button onclick="toggleOnline(this)" class="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow">Nyalakan Sekarang</button>`); return; }

    const radius = Number(currentProvider.Radius_km || 5);
    const q = (el('searchMitraFeedInput')?.value || '').toLowerCase();
    const list = dbOpenOrders.filter(o => orderMatchesMitra(o) &&
        ((o.Judul || '').toLowerCase().includes(q) || (o.Deskripsi_Permintaan || '').toLowerCase().includes(q)));

    if (!list.length) { container.innerHTML = emptyBox('fa-briefcase', `Belum ada suruhan di sekitar Kampus ${esc(currentMitraArea)}`, `Jangkauan Anda ${radius} km. Perbesar jangkauan di tab Profil atau tunggu pesanan baru.`); return; }

    container.innerHTML = list.map(o => {
        const sudah = Number(o.sudah_menawar) > 0;
        const nFoto = dbPhotos.filter(p => p.id_Orders === o.id_Orders && p.kind === 'lampiran').length;
        const km = nearestKm(o);
        const detailBtn = `<button onclick="openOrderDetail('${esc(o.id_Orders)}')" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold shrink-0"><i class="fa-solid fa-map-location-dot mr-1"></i>Peta</button>`;
        const btn = sudah
            ? `<span class="px-3.5 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold shrink-0"><i class="fa-solid fa-check mr-1"></i>Tawaran Terkirim</span>`
            : `<button onclick="openOfferModal('${esc(o.id_Orders)}', ${Number(o.Harga_diajukan)})" class="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1.5 shrink-0"><i class="fa-solid fa-hand-holding-dollar"></i><span>Ajukan Tawaran</span></button>`;
        return `<div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-3 sm:space-y-4">
            <div class="space-y-2">
                <div class="flex justify-between items-start gap-2">
                    <span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center space-x-1 shrink-0"><i class="fa-solid ${esc(o.ikon || 'fa-tag')}"></i><span class="truncate max-w-[120px]">${esc(o.nama_kategori || 'Reguler')}</span></span>
                    <span class="text-[10px] text-slate-400 font-mono shrink-0">${fmtDate(o.created_at)}</span>
                </div>
                <h4 class="font-extrabold text-slate-800 text-sm">${esc(o.Judul)}</h4>
                <p class="text-xs text-slate-500 line-clamp-2">${esc(o.Deskripsi_Permintaan)}</p>
                ${routeBox(o)}
                <p class="text-[10px] text-slate-400">Pemesan: <strong>${esc(o.pemesan_nama)}</strong> ${ratingChip(o.pemesan_rating, o.pemesan_dinilai)} · ${Number(o.jumlah_tawaran)} tawaran masuk${nFoto ? ` · <i class="fa-solid fa-image"></i> ${nFoto} foto` : ''}${km !== null ? ` · ±${km.toFixed(1).replace('.', ',')} km dari Kampus ${esc(currentMitraArea)}` : ''}</p>
            </div>
            <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
                <div class="shrink-0"><span class="block text-[10px] text-slate-400 font-semibold uppercase">Tarif Imbalan</span><span class="text-sm font-extrabold text-emerald-700">${rp(o.Harga_diajukan)}</span></div>
                <div class="flex items-center gap-2">${detailBtn}${btn}</div>
            </div></div>`;
    }).join('');
}

function openOfferModal(orderId, defaultHarga) {
    if (!requireAuth()) return;
    if (!currentProvider) return openBecomeMitraModal();
    if (currentProvider.Status_verifikasi !== 'Terverifikasi') return showToast('Akun Mitra Anda belum terverifikasi.', 'warning');
    if (Number(currentProvider.is_online) !== 1) return showToast('Status Anda sedang OFF. Nyalakan "Siap Menerima Suruhan" dulu.', 'warning');
    if (providerBusy) return showToast('Anda sedang mengerjakan tugas. Selesaikan dulu sebelum menawar pesanan lain.', 'warning');
    el('modalOfferOrderId').value = orderId;
    el('modalOfferHarga').value = defaultHarga;
    if (el('modalOfferPesan')) el('modalOfferPesan').value = '';
    el('modalOffer')?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}
function closeOfferModal() { el('modalOffer')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

async function handleSendOffer(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const r = await api('send_offer.php', {
            id_orders: el('modalOfferOrderId')?.value,
            harga_tawaran: parseInt(el('modalOfferHarga')?.value || 0, 10),
            pesan: el('modalOfferPesan')?.value || ''
        });
        if (!r.ok) { showToast('Gagal mengirim penawaran: ' + r.message, 'error'); await syncAll(); return; }
        closeOfferModal();
        showToast('Penawaran terkirim! Pemesan akan diberi tahu.', 'success');
        await syncAll();
        switchTab('mitra-tasks');
    });
}

// ---------- MITRA: TUGAS ----------
function renderMitraTasks() {
    const container = el('mitraTasksContainer');
    if (!container) return;
    if (!currentProvider || !dbMyBids.length) {
        container.innerHTML = `<div class="p-6 sm:p-8 text-center text-slate-400 font-bold bg-white rounded-2xl border text-xs sm:text-sm">Anda belum pernah mengajukan tawaran pekerjaan.</div>`;
        return;
    }
    container.innerHTML = trackingBanner() + dbMyBids.map(b => {
        const done = b.status_order === 'Selesai' && b.status_offer === 'Accepted';
        const cancelled = b.status_order === 'Dibatalkan';
        const running = b.status_offer === 'Accepted' && b.status_order === 'Diproses';
        const id = esc(b.id_Orders);
        let label, cls, action, progress = '';

        if (done) { label = 'Tugas Selesai'; cls = 'bg-emerald-100 text-emerald-700'; action = `<span class="px-3.5 py-2 bg-emerald-100 text-emerald-800 rounded-xl font-bold text-xs"><i class="fa-solid fa-circle-check mr-1.5"></i>Tugas Selesai</span>${Number(b.has_review_pemesan) ? '' : `<button onclick="openReviewModal('${id}','pemesan')" class="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-unesa-navy rounded-xl font-bold text-xs">⭐ Nilai Pemesan</button>`}`; }
        else if (running) {
            label = 'Diterima & Sudah Dibayar'; cls = 'bg-blue-100 text-blue-700';
            const next = flowOf(b.alur)[Number(b.progress || 0)];
            const final = Number(b.progress || 0) === 3;
            progress = `<div class="space-y-1">${progressBar(b)}<p class="text-[11px] font-bold text-blue-700"><i class="fa-solid fa-circle-dot mr-1"></i>Saat ini: ${esc(stepLabel(b))}</p></div>`;
            action = `<button onclick="openProgressModal('${id}')" class="w-full sm:w-auto px-3.5 py-2 ${final ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'} text-white rounded-xl font-bold text-xs shadow transition active:scale-95"><i class="fa-solid ${final ? 'fa-key' : 'fa-flag-checkered'} mr-1"></i>${final ? 'Selesaikan dengan Kode' : 'Tandai: ' + esc(next)}</button>`;
        }
        else if (cancelled) { label = 'Pesanan Dibatalkan'; cls = 'bg-slate-200 text-slate-600'; action = `<span class="text-slate-400 italic text-[11px]">${esc(b.Alasan_batal || 'Pesanan dibatalkan')}</span>`; }
        else if (b.status_offer === 'Rejected') { label = 'Tidak Dipilih Pemesan'; cls = 'bg-slate-200 text-slate-600'; action = `<span class="text-slate-400 italic text-[11px]">Pemesan memilih Mitra lain</span>`; }
        else { label = 'Menunggu Respon Pemesan'; cls = 'bg-amber-100 text-amber-800'; action = `<span class="text-slate-400 italic text-[11px]">Sedang dalam antrean pemesan</span>`; }

        const withdrawBtn = running && Number(b.progress || 0) === 0 ? `<button onclick="withdrawTask(this,'${id}')" class="px-3 py-2 bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs">Mundur</button>` : '';
        const canMap = !(cancelled || b.status_offer === 'Rejected');
        return `<div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <span class="font-mono text-xs font-bold text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded">${id}</span>
                <span class="text-[11px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full ${cls}">Status: ${label}</span>
            </div>
            <div>
                <h4 class="font-bold text-slate-800 text-sm">${esc(b.Judul)}</h4>
                <p class="text-xs text-slate-500 mt-0.5">Pemesan: <strong>${esc(b.pemesan_nama)}</strong> ${ratingChip(b.pemesan_rating, b.pemesan_dinilai)}</p>
            </div>
            ${routeBox(b)}
            ${progress}
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div><span class="text-slate-400 block text-[10px]">Tawaran Anda:</span><span class="font-extrabold text-emerald-700 text-sm">${rp(b.Harga_tawaran)}</span></div>
                <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    ${canMap ? `<button onclick="openOrderDetail('${id}')" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs"><i class="fa-solid fa-map-location-dot mr-1"></i>Peta & Detail</button>` : ''}
                    ${chatBtn(b)}
                    ${action}${withdrawBtn}
                </div>
            </div></div>`;
    }).join('');
}

// ---------- MITRA: PENDAPATAN ----------
function renderMitraEarnings() {
    setText('walletTotalEarnings', rp(dbWallet.total));
    setText('walletAvailable', rp(dbWallet.available));
    setText('walletFeeTotal', rp(dbWallet.fee_total));

    const tbody = el('mitraEarningsTableBody');
    if (tbody) {
        const done = dbMyBids.filter(b => b.status_offer === 'Accepted' && b.status_order === 'Selesai');
        tbody.innerHTML = done.length ? done.map(b => `<tr class="hover:bg-slate-50 transition">
            <td class="p-3.5 font-mono font-bold text-emerald-900">${esc(b.id_Orders)}</td>
            <td class="p-3.5 font-semibold text-slate-700">${esc(b.Judul)}</td>
            <td class="p-3.5 font-extrabold text-emerald-700">${rp(b.Harga_tawaran)}</td>
            <td class="p-3.5"><span class="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full text-[10px]">Masuk Saldo</span></td>
            <td class="p-3.5 text-slate-400 font-mono">${fmtDate(b.completed_at)}</td></tr>`).join('')
            : `<tr><td colspan="5" class="p-4 text-center text-slate-400">Belum ada catatan pendapatan transaksi.</td></tr>`;
    }

    const wd = el('withdrawalsContainer');
    if (wd) {
        wd.innerHTML = dbWithdrawals.length ? dbWithdrawals.map(w => `<div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
            <div><span class="font-bold text-slate-800">${rp(w.Jumlah)}</span> <span class="text-slate-500">ke ${esc(w.Metode)} ${esc(w.Tujuan)}</span><span class="block text-[10px] text-slate-400 font-mono">${fmtDate(w.created_at)}</span></div>
            <span class="px-2 py-0.5 rounded-full font-bold text-[10px] ${w.Status === 'Selesai' ? 'bg-emerald-100 text-emerald-800' : (w.Status === 'Ditolak' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}">${esc(w.Status)}</span></div>`).join('')
            : `<p class="text-xs text-slate-400 text-center py-2">Belum ada permintaan penarikan.</p>`;
    }
}

function openWithdrawModal() {
    if (!currentProvider) return;
    if (dbWallet.available < minWithdraw) return showToast(`Saldo belum cukup. Minimal penarikan ${rp(minWithdraw)}.`, 'warning');
    setText('wdAvailable', rp(dbWallet.available));
    el('wdJumlah').value = dbWallet.available;
    el('wdJumlah').max = dbWallet.available;
    el('wdJumlah').min = minWithdraw;
    el('modalWithdraw')?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}
function closeWithdrawModal() { el('modalWithdraw')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }
async function handleWithdraw(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const r = await api('request_withdrawal.php', {
            metode: el('wdMetode')?.value,
            tujuan: el('wdTujuan')?.value || '',
            jumlah: parseInt(el('wdJumlah')?.value || 0, 10)
        });
        if (!r.ok) { showToast(r.message || 'Gagal mengajukan penarikan.', 'error'); await syncAll(); return; }
        closeWithdrawModal();
        showToast('Permintaan penarikan dicatat. Dana diproses ke e-wallet Anda.', 'success');
        await syncAll();
    });
}

// ---------- MITRA: PROFIL & KTM ----------
function renderMitraProfile() {
    if (currentProvider && currentLoggedInUser) {
        const p = currentProvider;
        const verified = p.Status_verifikasi === 'Terverifikasi';
        if (el('ktmFoto')) el('ktmFoto').src = avatarFor(currentLoggedInUser.Nama, p.foto_KTM || currentLoggedInUser.Foto_profil);
        setText('ktmNama', currentLoggedInUser.Nama);
        setText('ktmNIM', `NIM: ${p.NIM}`);
        setText('ktmFakultas', p.Fakultas);
        setText('ktmAreaKerja', p.Area_kerja);
        setText('ktmRating', Number(p.Total_order_selesai) > 0 || Number(p.Rating) > 0 ? `⭐ ${Number(p.Rating).toFixed(1)} / 5.0` : 'Belum ada rating');
        setText('ktmTotalOrder', `${Number(p.Total_order_selesai)} Selesai`);
        const st = el('ktmStatus');
        if (st) {
            st.innerText = verified ? 'Terverifikasi' : (p.Status_verifikasi === 'Ditolak' ? 'Ditolak' : 'Menunggu Verifikasi');
            st.className = `text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap border ${verified ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : (p.Status_verifikasi === 'Ditolak' ? 'bg-rose-500/20 text-rose-300 border-rose-400/40' : 'bg-amber-500/20 text-amber-300 border-amber-400/40')}`;
        }
        if (el('profileAreaSelect')) el('profileAreaSelect').value = p.Area_kerja;
        if (el('profileRadiusSelect')) el('profileRadiusSelect').value = String(Number(p.Radius_km || 5));
    }
    renderReviews();
    renderKtmBox();
}

function renderReviews() {
    const c = el('reviewsListContainer');
    if (!c) return;
    c.innerHTML = dbReviews.length ? dbReviews.map(r => `<div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
        <div class="flex items-center justify-between"><span class="font-bold text-amber-500">${'⭐'.repeat(Math.max(1, Math.min(5, Number(r.Rating))))} ${Number(r.Rating).toFixed(1)} / 5.0</span><span class="text-[10px] text-slate-400 font-mono">${fmtDate(r.created_at)}</span></div>
        <p class="text-slate-700 italic">${r.Komentar ? `"${esc(r.Komentar)}"` : 'Tanpa komentar'}</p>
        <p class="text-[10px] text-slate-400">oleh ${esc(r.pemesan_nama)} · ${esc(r.id_Orders)}</p></div>`).join('')
        : `<p class="text-xs text-slate-400 text-center py-4">Belum ada ulasan dari pemesan. Selesaikan tugas untuk mendapat rating pertama.</p>`;
}

// ---------- PUSAT KENDALA ----------
function reportableOrders() {
    const map = new Map();
    dbMyOrders.filter(o => ['Diproses', 'Selesai'].includes(o.status_order)).forEach(o => map.set(o.id_Orders, o.Judul));
    dbMyBids.filter(b => b.status_offer === 'Accepted' && ['Diproses', 'Selesai'].includes(b.status_order)).forEach(b => map.set(b.id_Orders, b.Judul));
    return [...map.entries()];
}
function openReportModal() {
    if (!requireAuth()) return;
    const list = reportableOrders();
    if (!list.length) return showToast('Belum ada pesanan yang sedang diproses atau selesai untuk dilaporkan.', 'info');
    el('reportOrderIdSelect').innerHTML = list.map(([id, judul]) => `<option value="${esc(id)}">${esc(id)} - ${esc(judul)}</option>`).join('');
    if (el('reportAlasan')) el('reportAlasan').value = '';
    resetPhotoBox('report');
    el('modalReport')?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}
function closeReportModal() { el('modalReport')?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

async function handleSendReport(event) {
    event.preventDefault();
    if (!photosReady('report')) return showToast('Tunggu foto selesai diunggah.', 'info');
    await lockRun(submitBtn(event), async () => {
        const r = await api('create_report.php', {
            id_orders: el('reportOrderIdSelect')?.value,
            alasan: el('reportAlasan')?.value || '',
            id_photo: photoIds('report')[0] || 0
        });
        if (!r.ok) return showToast('Gagal mengirim laporan: ' + r.message, 'error');
        closeReportModal();
        showToast('Laporan kendala diterima dan tersimpan.', 'success');
        await syncAll();
    });
}

function renderReports() {
    const c = el('reportsContainer');
    if (!c) return;
    if (!currentLoggedInUser) { c.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Masuk untuk melihat laporan kendala Anda.</div>`; return; }
    c.innerHTML = dbReports.length ? dbReports.map(r => `<div class="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2">
        <div class="flex items-center justify-between gap-2"><span class="font-mono font-bold text-rose-700">Laporan #${Number(r.id_report)} (${esc(r.id_Orders)})</span><span class="${r.Status === 'Selesai' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} font-bold px-2 py-0.5 rounded-full text-[10px] shrink-0">${esc(r.Status === 'Selesai' ? 'Ditangani' : r.Status)}</span></div>
        <p class="font-semibold text-slate-600">${esc(r.Judul)}</p>
        <p class="text-slate-700">${esc(r.Alasan)}</p>
        ${r.Catatan_admin ? `<p class="bg-white border border-emerald-200 rounded-lg p-2 text-[11px]"><strong>${esc(KEPUTUSAN_LABEL[r.Keputusan] || 'Tanggapan admin')}:</strong> ${esc(r.Catatan_admin)}</p>` : ''}
        ${r.id_photo ? `<div>${photoThumb(r.id_photo, 'w-24 h-24')}</div>` : ''}
        <p class="text-[10px] text-slate-400 font-mono">Dilaporkan pada: ${fmtDate(r.created_at)}</p></div>`).join('')
        : `<div class="p-6 text-center text-slate-400 text-xs">Belum ada laporan kendala.</div>`;
}

// =====================================================================
// v2: PETA (Leaflet + Google Maps), FOTO LANGSUNG, PELACAKAN TUGAS
// =====================================================================
let flows = {};
let dbPhotos = [];
let dbTracking = [];

const AREA_CENTER = { 'Ketintang': [-7.3139, 112.7249], 'Lidah Wetan': [-7.3045, 112.6745], 'Magetan': [-7.6470, 111.3300] }; // titik awal peta (perkiraan)
const orderGeo = { awal: { lat: null, lng: null, url: '' }, tujuan: { lat: null, lng: null, url: '' } };
const GMAPS_RE = /^https:\/\/((www\.|maps\.)?google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl)(\/|\?|$)/i;

function leafletOk() { return typeof window.L !== 'undefined' && typeof window.L.map === 'function'; }
function syncBodyLock() {
    const open = document.querySelectorAll('[id^="modal"]:not(.hidden)').length;
    document.body.classList.toggle('overflow-hidden', open > 0);
}
function pinIcon(color, glyph = 'fa-location-dot') {
    return L.divIcon({ className: 'pin-icon', html: `<i class="fa-solid ${glyph}" style="color:${color};font-size:30px"></i>`, iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26] });
}
function addTiles(map) {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
}
function geoErrMsg(err) {
    return err && err.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi di pengaturan browser.' : 'Lokasi tidak dapat ditentukan. Pastikan GPS aktif dan situs dibuka lewat HTTPS.';
}

// ---------- Helper titik & link Google Maps ----------
function hasGeo(lat, lng) { return lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '' && isFinite(lat) && isFinite(lng); }
function ptOf(o, w) {
    const W = w === 'awal' ? 'awal' : 'tujuan';
    const lat = o['Lat_' + W], lng = o['Lng_' + W];
    const g = hasGeo(lat, lng);
    return { lat: g ? Number(lat) : null, lng: g ? Number(lng) : null, url: o['Peta_' + W + '_url'] || '' };
}
function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : ''; }
function gmapsOpenUrl(p) { return p.lat !== null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : safeUrl(p.url); }
function gmapsNavUrl(p) { return p.lat !== null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : safeUrl(p.url); }
function gmapsRouteUrl(a, b) { return (a.lat !== null && b.lat !== null) ? `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}` : ''; }
function parseGmapsLink(u) {
    const pats = [/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i];
    for (const p of pats) { const m = u.match(p); if (m) return { lat: +m[1], lng: +m[2] }; }
    return null;
}

// ---------- Titik di form pesanan ----------
function renderPointChip(which) {
    const g = orderGeo[which], c = el(which === 'awal' ? 'mapChipAwal' : 'mapChipTujuan');
    if (!c) return;
    let txt = 'Belum ada titik dipilih', cls = 'text-slate-400';
    if (g.invalid) { txt = 'Link harus dari Google Maps (google.com/maps atau maps.app.goo.gl).'; cls = 'text-rose-600'; }
    else if (g.lat !== null && g.url) { txt = '✓ Titik terbaca dari link Google Maps'; cls = 'text-emerald-700 font-bold'; }
    else if (g.lat !== null) { txt = `✓ Titik dipilih di peta (${g.lat.toFixed(5)}, ${g.lng.toFixed(5)})`; cls = 'text-emerald-700 font-bold'; }
    else if (g.url) { txt = '✓ Link tersimpan. Mitra akan membukanya lewat Google Maps.'; cls = 'text-emerald-700 font-bold'; }
    c.className = 'text-[11px] ' + cls;
    c.textContent = txt;
}
function onGmapsInput(which) {
    const inp = el(which === 'awal' ? 'orderGmapsAwal' : 'orderGmapsTujuan');
    const v = (inp?.value || '').trim();
    if (!v) {
        if (orderGeo[which].url || orderGeo[which].invalid) orderGeo[which] = { lat: null, lng: null, url: '' };
    } else if (!GMAPS_RE.test(v)) {
        orderGeo[which] = { lat: null, lng: null, url: '', invalid: true };
    } else {
        const c = parseGmapsLink(v);
        orderGeo[which] = { lat: c ? c.lat : null, lng: c ? c.lng : null, url: v };
    }
    renderPointChip(which);
}
function resetOrderGeo() {
    orderGeo.awal = { lat: null, lng: null, url: '' };
    orderGeo.tujuan = { lat: null, lng: null, url: '' };
    ['orderGmapsAwal', 'orderGmapsTujuan'].forEach(id => { if (el(id)) el(id).value = ''; });
    renderPointChip('awal'); renderPointChip('tujuan');
}

// ---------- Pemilih titik di peta ----------
let pickerMap = null, pickerMarker = null, pickerWhich = null, pickerPoint = null;

function openMapPicker(which) {
    pickerWhich = which; pickerPoint = null;
    el('modalMapPicker').classList.remove('hidden');
    syncBodyLock();
    setText('pickerTitle', which === 'awal' ? 'Titik jemput / ambil barang' : 'Titik tujuan / antar');
    el('pickerResults').classList.add('hidden');
    el('pickerSearch').value = '';
    el('pickerConfirm').disabled = true;
    setText('pickerCoord', 'Ketuk peta untuk menaruh pin');
    if (!leafletOk()) { el('pickerFallback').classList.remove('hidden'); el('pickerMapCanvas').classList.add('hidden'); return; }
    el('pickerFallback').classList.add('hidden');
    el('pickerMapCanvas').classList.remove('hidden');

    const area = el(which === 'awal' ? 'orderAreaAwal' : 'orderAreaTujuan')?.value || 'Ketintang';
    const g = orderGeo[which];
    const start = g.lat !== null ? [g.lat, g.lng] : pickerFallbackCenter(which, area);
    setTimeout(() => {
        if (!pickerMap) {
            pickerMap = L.map('pickerMapCanvas');
            addTiles(pickerMap);
            pickerMap.on('click', e => setPickerPoint(e.latlng.lat, e.latlng.lng, false));
        }
        pickerMap.setView(start, g.lat !== null ? 18 : 16);
        pickerMap.invalidateSize();
        if (pickerMarker) { pickerMap.removeLayer(pickerMarker); pickerMarker = null; }
        if (g.lat !== null) setPickerPoint(g.lat, g.lng, false);
    }, 60);
}
function setPickerPoint(lat, lng, pan) {
    lat = +Number(lat).toFixed(6); lng = +Number(lng).toFixed(6);
    pickerPoint = { lat, lng };
    if (!pickerMarker) {
        pickerMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon(pickerWhich === 'awal' ? '#f59e0b' : '#059669') }).addTo(pickerMap);
        pickerMarker.on('dragend', () => { const p = pickerMarker.getLatLng(); setPickerPoint(p.lat, p.lng, false); });
    } else pickerMarker.setLatLng([lat, lng]);
    if (pan) pickerMap.setView([lat, lng], 18);
    setText('pickerCoord', `${lat}, ${lng}`);
    el('pickerConfirm').disabled = false;
}
async function searchPlace() {
    const q = (el('pickerSearch')?.value || '').trim();
    if (q.length < 3) return showToast('Ketik minimal 3 huruf nama tempat.', 'warning');
    const box = el('pickerResults');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="p-3 text-slate-400">Mencari...</div>';
    try {
        const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=id&q=' + encodeURIComponent(q));
        const data = await res.json();
        box.innerHTML = data.length
            ? data.map((d, i) => `<button type="button" data-i="${i}" class="w-full text-left p-2.5 hover:bg-slate-50">${esc(d.display_name)}</button>`).join('')
            : '<div class="p-3 text-slate-400">Tempat tidak ditemukan. Coba kata kunci lain atau ketuk langsung di peta.</div>';
        box.querySelectorAll('button').forEach(b => b.onclick = () => {
            const d = data[+b.dataset.i];
            box.classList.add('hidden');
            if (pickerMap && d) setPickerPoint(+d.lat, +d.lon, true);
        });
    } catch (e) {
        box.innerHTML = '<div class="p-3 text-rose-600">Pencarian gagal. Ketuk langsung di peta.</div>';
    }
}
function useMyLocation() {
    if (!leafletOk() || !pickerMap) return;
    if (!navigator.geolocation) return showToast('Perangkat tidak mendukung GPS.', 'warning');
    navigator.geolocation.getCurrentPosition(p => setPickerPoint(p.coords.latitude, p.coords.longitude, true),
        err => showToast(geoErrMsg(err), 'warning'), { enableHighAccuracy: true, timeout: 15000 });
}
function confirmMapPicker() {
    if (!pickerPoint) return;
    orderGeo[pickerWhich] = { lat: pickerPoint.lat, lng: pickerPoint.lng, url: '' };
    const inp = el(pickerWhich === 'awal' ? 'orderGmapsAwal' : 'orderGmapsTujuan');
    if (inp) inp.value = '';
    renderPointChip(pickerWhich);
    closeMapPicker();
}
function closeMapPicker() { el('modalMapPicker')?.classList.add('hidden'); syncBodyLock(); }

// ---------- Foto langsung dari perangkat (disimpan di database) ----------
const photoBoxes = {
    order: { max: 3, items: [], kind: 'lampiran' },
    report: { max: 1, items: [], kind: 'laporan' },
    progress: { max: 1, items: [], kind: 'progres' },
    ktm: { max: 1, items: [], kind: 'ktm' }
};
async function compressImage(file, maxSide = 1280, quality = 0.78) {
    let src = null;
    if (window.createImageBitmap) { try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; } }
    if (!src) {
        src = await new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error('Foto tidak bisa dibaca. Coba foto lain.'));
            img.src = URL.createObjectURL(file);
        });
    }
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    let blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size > 1200 * 1024) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
    if (!blob) throw new Error('Foto gagal diproses.');
    return blob;
}
async function uploadPhoto(blob, kind) {
    const fd = new FormData();
    fd.append('foto', blob, 'foto.jpg');
    fd.append('kind', kind);
    let res, text;
    try {
        res = await fetch('upload_photo.php', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'UNESA-Suruh' }, body: fd });
        text = await res.text();
    } catch (e) { return { ok: false, message: 'Tidak dapat terhubung ke server.' }; }
    try {
        const d = JSON.parse(text);
        if (res.status === 401 && currentLoggedInUser) handleSessionExpired();
        return { ok: d.status === 'success', message: d.message || '', data: d };
    } catch (e) { return { ok: false, message: 'Respons server tidak valid saat mengunggah foto (cek upload_photo.php).' }; }
}
function renderPhotoBox(key) {
    const box = photoBoxes[key], c = el('photoBox-' + key);
    if (!c) return;
    const tile = (icon, label, capture) => `<label class="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-unesa-navy hover:text-unesa-navy flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer text-center">
            <i class="fa-solid ${icon} text-lg mb-0.5"></i>${label}
            <input type="file" accept="image/*" ${capture ? 'capture="environment"' : ''} ${(box.max > 1 && !capture) ? 'multiple' : ''} class="hidden" onchange="pickPhotos('${key}', this)">
        </label>`;
    c.innerHTML = box.items.map((it, i) => `<div class="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
            <img src="${esc(it.preview)}" class="w-full h-full object-cover" alt="Foto ${i + 1}">
            ${it.uploading ? '<div class="absolute inset-0 bg-white/70 flex items-center justify-center"><i class="fa-solid fa-spinner fa-spin text-unesa-navy"></i></div>' : ''}
            <button type="button" onclick="removePhoto('${key}', ${i})" class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-[10px] flex items-center justify-center" aria-label="Hapus foto"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
        + (box.items.length < box.max ? tile('fa-camera', 'Kamera', true) + tile('fa-image', 'Galeri', false) : '');
}
async function pickPhotos(key, input) {
    if (!currentLoggedInUser) { input.value = ''; return requireAuth(); }
    const box = photoBoxes[key];
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
        if (box.items.length >= box.max) { showToast(`Maksimal ${box.max} foto.`, 'warning'); break; }
        if (!/^image\//.test(f.type)) { showToast('File harus berupa gambar.', 'warning'); continue; }
        const item = { id: null, preview: '', uploading: true };
        box.items.push(item);
        renderPhotoBox(key);
        try {
            const blob = await compressImage(f);
            item.preview = URL.createObjectURL(blob);
            renderPhotoBox(key);
            const r = await uploadPhoto(blob, box.kind);
            if (!r.ok) throw new Error(r.message || 'Foto gagal diunggah.');
            item.id = r.data.id_photo;
            item.uploading = false;
        } catch (e) {
            const i = box.items.indexOf(item);
            if (i >= 0) box.items.splice(i, 1);
            showToast(e.message || 'Foto gagal diunggah.', 'error');
        }
        renderPhotoBox(key);
    }
}
function removePhoto(key, i) {
    const box = photoBoxes[key], it = box.items[i];
    if (it && it.preview) URL.revokeObjectURL(it.preview);
    box.items.splice(i, 1);
    renderPhotoBox(key);
}
function resetPhotoBox(key) {
    photoBoxes[key].items.forEach(it => it.preview && URL.revokeObjectURL(it.preview));
    photoBoxes[key].items = [];
    renderPhotoBox(key);
}
function photosReady(key) { return !photoBoxes[key].items.some(i => i.uploading); }
function photoIds(key) { return photoBoxes[key].items.filter(i => i.id).map(i => i.id); }
function photoThumb(id, size = 'w-20 h-20') {
    return `<a href="photo.php?id=${Number(id)}" target="_blank" rel="noopener"><img src="photo.php?id=${Number(id)}" loading="lazy" alt="Foto" class="${size} object-cover rounded-xl border border-slate-200 bg-slate-100"></a>`;
}

// ---------- Kategori & tarif ----------
function catById(id) { return dbCategories.find(c => String(c.id_category) === String(id)); }
function onCategoryChange() {
    const hint = el('orderTarifHint');
    if (hint) hint.textContent = 'Tulis tarif yang kamu tawarkan. Mitra bisa menyetujui atau menawar balik.';
    applyOrderMode();
}
function orderModeNow() {
    const c = catById(el('orderCategory')?.value);
    if (!c) return 'rute';
    if (c.alur === 'custom') return document.querySelector('input[name="orderModeCustom"]:checked')?.value === 'satu' ? 'satu' : 'rute';
    return c.mode_lokasi === 'satu' ? 'satu' : 'rute';
}
/** Sesuaikan form: satu lokasi pengerjaan atau jemput + antar. */
function applyOrderMode() {
    const c = catById(el('orderCategory')?.value), m = orderModeNow();
    el('orderModeBox')?.classList.toggle('hidden', !(c && c.alur === 'custom'));
    el('orderBlockTujuan')?.classList.toggle('hidden', m === 'satu');
    setText('orderLblAwal', m === 'satu' ? 'LOKASI PENGERJAAN' : 'LOKASI AWAL / JEMPUT');
    ['orderAreaTujuan', 'orderLokasiTujuanDetail'].forEach(id => { const e = el(id); if (e) e.required = (m !== 'satu'); });
}
function pickerFallbackCenter(which, area) {
    if (AREA_CENTER[area]) return AREA_CENTER[area];
    const other = orderGeo[which === 'awal' ? 'tujuan' : 'awal'];
    if (other.lat !== null) return [other.lat, other.lng];
    const oa = el(which === 'awal' ? 'orderAreaTujuan' : 'orderAreaAwal')?.value;
    return AREA_CENTER[oa] || AREA_CENTER.Ketintang;
}

// ---------- Tahapan tugas ----------
function flowOf(alur) { return flows[alur] || flows.custom || ['Menuju lokasi', 'Sedang dikerjakan', 'Dalam perjalanan ke tujuan', 'Tugas selesai']; }
function stepLabel(o) {
    const p = Number(o.progress || 0);
    if (o.status_order === 'Selesai') return flowOf(o.alur)[3];
    return p === 0 ? 'Mitra ditugaskan' : flowOf(o.alur)[p - 1];
}
function progressBar(o) {
    const p = Number(o.progress || 0);
    return `<div class="flex gap-1">${[1, 2, 3, 4].map(i => `<div class="h-1.5 flex-1 rounded-full ${p >= i ? 'bg-emerald-500' : 'bg-slate-200'}"></div>`).join('')}</div>`;
}
function runningTasks() { return dbMyBids.filter(b => b.status_offer === 'Accepted' && b.status_order === 'Diproses'); }
function fmtAgo(s) {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T') + '+07:00');
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    if (isNaN(m)) return '';
    if (m < 1) return 'baru saja';
    return m < 60 ? `${m} menit lalu` : fmtDate(s);
}
function findOrder(id) {
    const mine = dbMyOrders.find(o => o.id_Orders === id);
    if (mine) return Object.assign({}, mine, { _role: 'pemesan' });
    const bid = dbMyBids.find(b => b.id_Orders === id);
    if (bid) return Object.assign({}, bid, { _role: 'mitra' });
    const open = dbOpenOrders.find(o => o.id_Orders === id);
    return open ? Object.assign({}, open, { _role: 'preview' }) : null;
}

// ---------- Detail pesanan: peta, lini masa, foto ----------
let detailId = null, detailMap = null, detailView = null, detailSig = '';

function openOrderDetail(id) {
    detailId = id; detailView = null; detailSig = '';
    el('modalOrderDetail').classList.remove('hidden');
    syncBodyLock();
    renderOrderDetail(true);
}
function closeOrderDetail() {
    detailId = null; detailSig = '';
    if (detailMap) { detailMap.remove(); detailMap = null; }
    el('modalOrderDetail')?.classList.add('hidden');
    syncBodyLock();
}
function mapBtn(href, icon, label, cls) {
    if (!href) return '';
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="px-3 py-2.5 rounded-xl text-xs font-bold text-center ${cls}"><i class="fa-solid ${icon} mr-1"></i>${label}</a>`;
}
function renderTimeline(o) {
    const flow = flowOf(o.alur);
    const done = new Map(dbTracking.filter(t => t.id_Orders === o.id_Orders).map(t => [Number(t.step), t]));
    const steps = [{ step: 0, label: 'Pembayaran diterima, Mitra ditugaskan' }].concat(flow.map((l, i) => ({ step: i + 1, label: l })));
    const cur = Number(o.progress || 0);
    return `<ol class="space-y-2.5">${steps.map(s => {
        const t = done.get(s.step);
        const ok = !!t || (s.step === 0 && o.status_order !== 'Menunggu Tawaran') || s.step <= cur;
        const now = o.status_order === 'Diproses' && s.step === cur;
        return `<li class="flex gap-2.5">
            <div class="w-5 h-5 mt-0.5 rounded-full shrink-0 flex items-center justify-center text-[10px] ${ok ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}"><i class="fa-solid ${ok ? 'fa-check' : 'fa-circle'}"></i></div>
            <div class="min-w-0 flex-1">
                <p class="text-xs ${ok ? 'font-bold text-slate-800' : 'text-slate-400'}">${esc(s.label)}${now ? ' <span class="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">Saat ini</span>' : ''}</p>
                ${t ? `<p class="text-[10px] text-slate-400 font-mono">${fmtDate(t.created_at)}</p>` : ''}
                ${t && t.catatan ? `<p class="text-[11px] text-slate-600 italic">"${esc(t.catatan)}"</p>` : ''}
                ${t && t.id_photo ? `<div class="mt-1">${photoThumb(t.id_photo, 'w-24 h-24')}</div>` : ''}
            </div></li>`;
    }).join('')}</ol>`;
}
function detailActions(o) {
    const id = esc(o.id_Orders);
    if (o._role === 'preview') {
        return Number(o.sudah_menawar) > 0
            ? `<p class="text-xs text-slate-500 text-center bg-slate-50 rounded-xl p-3">Tawaran Anda sudah terkirim. Menunggu respon pemesan.</p>`
            : `<button onclick="closeOrderDetail(); openOfferModal('${id}', ${Number(o.Harga_diajukan)})" class="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow"><i class="fa-solid fa-hand-holding-dollar mr-1"></i>Ajukan Tawaran</button>`;
    }
    if (o._role === 'mitra') {
        if (o.status_offer === 'Accepted' && o.status_order === 'Diproses') {
            const idx = Number(o.progress || 0), final = idx === 3;
            return `<div class="space-y-2">
                ${trackingBanner()}
                <button onclick="openProgressModal('${id}')" class="w-full py-3 ${final ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-bold text-sm rounded-xl shadow"><i class="fa-solid ${final ? 'fa-key' : 'fa-flag-checkered'} mr-1"></i>${final ? 'Selesaikan dengan Kode dari Pemesan' : 'Tandai: ' + esc(flowOf(o.alur)[idx])}</button>
                ${chatBtn(o, true)}
                ${sosBtn(o)}
                ${Number(o.progress || 0) === 0 ? `<button onclick="withdrawTask(this,'${id}')" class="w-full py-2.5 bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 font-bold text-xs rounded-xl">Mundur dari Tugas (belum dimulai)</button>` : ''}</div>`;
        }
        const rateBtn = (o.status_offer === 'Accepted' && o.status_order === 'Selesai' && !Number(o.has_review_pemesan)) ? `<button onclick="closeOrderDetail(); openReviewModal('${id}','pemesan')" class="w-full py-3 bg-amber-400 hover:bg-amber-500 text-unesa-navy font-bold text-sm rounded-xl shadow">⭐ Nilai Pemesan</button>` : '';
        const c = chatBtn(o, true) + rateBtn;
        return o.status_offer === 'Pending' ? `<p class="text-xs text-slate-500 text-center bg-slate-50 rounded-xl p-3">Menunggu respon pemesan.</p>` : c;
    }
    // pemesan
    if (o.status_order === 'Menunggu Tawaran') return `<button onclick="closeOrderDetail(); switchTab('pemesan-offers')" class="w-full py-3 bg-amber-400 hover:bg-amber-500 text-unesa-navy font-bold text-sm rounded-xl shadow"><i class="fa-solid fa-comments-dollar mr-1"></i>Lihat Tawaran Masuk</button>`;
    let html = '';
    if (o.status_order === 'Diproses' && o.kode_selesai) {
        html += `<div class="bg-amber-50 border border-amber-300 rounded-xl p-3 text-center space-y-1">
            <p class="text-[11px] font-bold text-amber-900 uppercase">Kode Serah Terima</p>
            <p class="text-3xl font-black tracking-[0.35em] text-amber-700 select-all">${esc(o.kode_selesai)}</p>
            <p class="text-[11px] text-amber-800">Berikan kode ini ke Mitra <strong>hanya setelah</strong> barang atau layanan benar-benar Anda terima. Jangan dibagikan sebelum itu.</p></div>`;
        if (Number(o.progress) >= 3) html += `<button onclick="confirmReceived(this,'${id}')" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow"><i class="fa-solid fa-circle-check mr-1"></i>Konfirmasi Sudah Diterima</button>`;
    }
    if (o.status_order === 'Diproses' && Number(o.progress || 0) === 0) html += `<button onclick="cancelPaidOrder(this,'${id}')" class="w-full py-2.5 bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 font-bold text-xs rounded-xl">Batalkan & Refund (Mitra belum berangkat)</button>`;
    if (o.status_order === 'Dibatalkan') html += `<p class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3"><strong>Dibatalkan (${esc(o.Dibatalkan_oleh || 'sistem')}):</strong> ${esc(o.Alasan_batal || '-')}</p>`;
    html += chatBtn(o, true);
    if (o.status_order === 'Diproses') html += sosBtn(o);
    if (o.status_order === 'Selesai' && !Number(o.has_review)) html += `<button onclick="closeOrderDetail(); openReviewModal('${id}')" class="w-full py-3 bg-amber-400 hover:bg-amber-500 text-unesa-navy font-bold text-sm rounded-xl shadow">⭐ Beri Ulasan</button>`;
    return `<div class="space-y-2">${html}</div>`;
}
function renderOrderDetail(force) {
    if (!detailId) return;
    const body = el('orderDetailBody');
    const o = findOrder(detailId);
    if (!o) {
        if (detailMap) { detailMap.remove(); detailMap = null; }
        body.innerHTML = '<p class="text-xs text-slate-500 text-center py-8">Pesanan ini sudah tidak tersedia.</p>';
        return;
    }
    const sig = JSON.stringify([o.status_order, o.progress, o.mitra_lat, o.mitra_lng, o.status_offer, o.sudah_menawar, o.has_review,
        dbTracking.filter(t => t.id_Orders === o.id_Orders).length, dbPhotos.filter(p => p.id_Orders === o.id_Orders).length, isSharing(), shareDenied, shareLastOk > 0, o.kode_selesai, dbChatUnread[o.id_Orders] || 0, chatGraceHours]);
    if (!force && sig === detailSig) return;
    detailSig = sig;

    const scroll = body.scrollTop;
    if (detailMap) { const c = detailMap.getCenter(); detailView = { c: [c.lat, c.lng], z: detailMap.getZoom() }; detailMap.remove(); detailMap = null; }

    const satu = o.Mode_lokasi === 'satu';
    const A = ptOf(o, 'awal'), T = satu ? { lat: null, lng: null, url: '' } : ptOf(o, 'tujuan');
    const anyGeo = A.lat !== null || T.lat !== null;
    const live = o.status_order === 'Diproses' && hasGeo(o.mitra_lat, o.mitra_lng);
    const lampiran = dbPhotos.filter(p => p.id_Orders === o.id_Orders && p.kind === 'lampiran');
    const showTrack = ['Diproses', 'Selesai'].includes(o.status_order);
    const mitraName = o._role === 'pemesan' ? o.mitra_nama : null;

    body.innerHTML = `
        <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
                <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full"><i class="fa-solid ${esc(o.ikon || 'fa-tag')} mr-1"></i>${esc(o.nama_kategori || 'Reguler')}</span>
                ${statusBadge(o.status_order)}
            </div>
            <h4 class="font-extrabold text-slate-800 text-base leading-snug">${esc(o.Judul)}</h4>
            <p class="font-mono text-[10px] text-slate-400">${esc(o.id_Orders)} · Tarif ${rp(o.Harga_final || o.Harga_diajukan)}</p>
            <p class="text-xs text-slate-600 whitespace-pre-line">${esc(o.Deskripsi_Permintaan || '')}</p>
        </div>

        <div class="space-y-2">
            <h5 class="text-xs font-bold text-slate-700"><i class="fa-solid fa-map text-unesa-navy mr-1"></i>Peta Lokasi</h5>
            ${anyGeo ? `<div id="detailMapCanvas" class="w-full h-56 rounded-xl border border-slate-200 bg-slate-100"></div>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                    <span><i class="fa-solid fa-location-dot text-amber-500"></i> ${satu ? 'Lokasi pengerjaan' : 'Jemput'}</span>
                    ${satu ? '' : '<span><i class="fa-solid fa-location-dot text-emerald-600"></i> Tujuan</span>'}
                    ${live ? '<span><i class="fa-solid fa-motorcycle text-blue-600"></i> Posisi Mitra</span>' : ''}
                </div>` : `<p class="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">Titik lokasi diberikan lewat link Google Maps. Gunakan tombol di bawah untuk membukanya.</p>`}
            ${live ? `<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-2.5"><i class="fa-solid fa-satellite-dish mr-1"></i>Posisi Mitra diperbarui ${esc(fmtAgo(o.mitra_loc_at))}. <a class="underline font-bold" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${Number(o.mitra_lat)},${Number(o.mitra_lng)}">Buka di Google Maps</a></p>` : ''}
            <div class="grid grid-cols-2 gap-2">
                ${mapBtn(gmapsOpenUrl(A), 'fa-location-dot', satu ? 'Titik lokasi' : 'Titik jemput', 'bg-amber-50 text-amber-800 border border-amber-300')}
                ${satu ? '' : mapBtn(gmapsOpenUrl(T), 'fa-location-dot', 'Titik tujuan', 'bg-emerald-50 text-emerald-800 border border-emerald-300')}
                ${mapBtn(gmapsNavUrl(A), 'fa-diamond-turn-right', satu ? 'Navigasi ke lokasi' : 'Navigasi ke jemput', 'bg-white border border-slate-300 text-slate-700')}
                ${satu ? '' : mapBtn(gmapsNavUrl(T), 'fa-diamond-turn-right', 'Navigasi ke tujuan', 'bg-white border border-slate-300 text-slate-700')}
                ${mapBtn(gmapsRouteUrl(A, T), 'fa-route', 'Lihat rute jemput ke tujuan', 'col-span-2 bg-unesa-navy text-unesa-gold')}
            </div>
            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs space-y-1">
                <p><span class="${satu ? 'bg-blue-600' : 'bg-amber-500'} text-white text-[9px] font-black px-1.5 py-0.5 rounded mr-1.5">${satu ? 'LOKASI' : 'JEMPUT'}</span><strong>${esc(o.Area_awal)}</strong> - ${esc(o.Lokasi_awal)}</p>
                ${satu ? '' : `<p><span class="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded mr-1.5">TUJUAN</span><strong>${esc(o.Area_tujuan)}</strong> - ${esc(o.Lokasi_tujuan)}</p>`}
            </div>
        </div>

        ${showTrack ? `<div class="space-y-2.5">
            <h5 class="text-xs font-bold text-slate-700"><i class="fa-solid fa-list-check text-unesa-navy mr-1"></i>Status Pengerjaan</h5>
            ${progressBar(o)}${renderTimeline(o)}</div>` : ''}

        ${lampiran.length ? `<div class="space-y-2"><h5 class="text-xs font-bold text-slate-700"><i class="fa-solid fa-image text-unesa-navy mr-1"></i>Foto Lampiran</h5>
            <div class="flex flex-wrap gap-2">${lampiran.map(p => photoThumb(p.id_photo, 'w-24 h-24')).join('')}</div></div>` : ''}

        ${(mitraName || o.pemesan_nama) ? `<div class="text-xs text-slate-600 bg-slate-50 rounded-xl p-3 border border-slate-100">
            ${mitraName ? `Dikerjakan oleh <strong>${esc(mitraName)}</strong>` : `Pemesan: <strong>${esc(o.pemesan_nama)}</strong> ${ratingChip(o.pemesan_rating, o.pemesan_dinilai)}`}</div>` : ''}

        ${detailActions(o)}`;
    body.scrollTop = scroll;
    drawDetailMap(o, A, T, live);
}
function drawDetailMap(o, A, T, live) {
    const c = el('detailMapCanvas');
    if (!c) return;
    if (!leafletOk()) { c.outerHTML = '<p class="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">Peta tidak dapat dimuat. Gunakan tombol Google Maps di bawah.</p>'; return; }
    detailMap = L.map(c);
    addTiles(detailMap);
    const pts = [];
    if (A.lat !== null) { L.marker([A.lat, A.lng], { icon: pinIcon('#f59e0b') }).addTo(detailMap).bindPopup('Titik jemput'); pts.push([A.lat, A.lng]); }
    if (T.lat !== null) { L.marker([T.lat, T.lng], { icon: pinIcon('#059669') }).addTo(detailMap).bindPopup('Titik tujuan'); pts.push([T.lat, T.lng]); }
    if (live) { const p = [Number(o.mitra_lat), Number(o.mitra_lng)]; L.marker(p, { icon: pinIcon('#2563eb', 'fa-motorcycle') }).addTo(detailMap).bindPopup('Posisi Mitra'); pts.push(p); }
    if (A.lat !== null && T.lat !== null) L.polyline([[A.lat, A.lng], [T.lat, T.lng]], { color: '#64748b', weight: 3, dashArray: '6 6' }).addTo(detailMap);
    if (detailView) detailMap.setView(detailView.c, detailView.z);
    else if (pts.length > 1) detailMap.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
    else detailMap.setView(pts[0], 17);
    setTimeout(() => { if (detailMap) detailMap.invalidateSize(); }, 80);
}

// ---------- Mitra: perbarui tahap tugas ----------
function openProgressModal(orderId) {
    const b = dbMyBids.find(x => x.id_Orders === orderId);
    if (!b) return;
    const idx = Number(b.progress || 0);
    el('progOrderId').value = orderId;
    setText('progStepLabel', flowOf(b.alur)[idx]);
    el('progCatatan').value = '';
    el('progKode').value = '';
    el('progKodeBox').classList.toggle('hidden', idx !== 3);
    resetPhotoBox('progress');
    el('modalProgress').classList.remove('hidden');
    syncBodyLock();
}
function closeProgressModal() { el('modalProgress')?.classList.add('hidden'); syncBodyLock(); }
async function handleProgressSubmit(event) {
    event.preventDefault();
    if (!photosReady('progress')) return showToast('Tunggu foto selesai diunggah.', 'info');
    if (!isSharing() || !shareLastOk) { retryTracking(); return showToast('Pelacakan lokasi belum aktif. Izinkan akses lokasi (GPS), tunggu beberapa detik, lalu coba lagi.', 'warning'); }
    await lockRun(submitBtn(event), async () => {
        const r = await api('update_progress.php', {
            id_orders: el('progOrderId')?.value,
            catatan: el('progCatatan')?.value || '',
            kode: el('progKode')?.value || '',
            id_photo: photoIds('progress')[0] || 0
        });
        if (!r.ok) { showToast(r.message || 'Gagal memperbarui status.', 'error'); await syncAll(); return; }
        closeProgressModal();
        showToast(r.data.selesai ? 'Kode benar. Tugas selesai dan imbalan masuk ke saldo Anda.' : `Status diperbarui: ${r.data.label}`, 'success');
        await syncAll();
    });
}
async function confirmReceived(btn, orderId) {
    if (!confirm('Konfirmasi bahwa barang atau layanan sudah Anda terima dengan baik? Tugas akan ditutup.')) return;
    await lockRun(btn, async () => {
        const r = await api('confirm_received.php', { id_orders: orderId });
        if (!r.ok) return showToast(r.message || 'Gagal mengonfirmasi.', 'error');
        showToast('Terima kasih! Tugas ditutup. Jangan lupa beri ulasan untuk Mitra.', 'success');
        await syncAll();
    });
}

// ---------- Mitra: bagikan lokasi langsung ----------
let shareWatchId = null, shareTimer = null, shareLast = null, shareLastSent = 0, shareLastOk = 0, shareDenied = false;
function isSharing() { return shareWatchId !== null; }
/** Pelacakan Mitra WAJIB selama ada tugas berjalan: dimulai otomatis, tanpa opsi mematikan. */
function ensureTracking() {
    const need = !!currentProvider && runningTasks().length > 0;
    if (need && !isSharing() && !shareDenied) startShare();
    if (!need && isSharing()) stopShare();
}
function sendPos() {
    if (!shareLast) return;
    shareLastSent = Date.now();
    api('update_location.php', { lat: shareLast.lat, lng: shareLast.lng }, { retry: true });
}
function startShare() {
    if (!navigator.geolocation) { shareDenied = true; return; }
    shareWatchId = navigator.geolocation.watchPosition(pos => {
        shareLast = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const first = !shareLastOk;
        shareLastOk = Date.now(); shareDenied = false;
        if (Date.now() - shareLastSent >= 20000) sendPos();
        if (first) { renderMitraTasks(); renderOrderDetail(true); }
    }, err => {
        if (err && err.code === 1) {
            shareDenied = true; stopShare();
            showToast('Izin lokasi ditolak. Pelacakan wajib aktif selama tugas berjalan. Izinkan lokasi lalu tekan "Coba Lagi".', 'error');
            renderMitraTasks(); renderOrderDetail(true);
        }
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    shareTimer = setInterval(() => { if (shareLast) sendPos(); }, 25000);   // kirim ulang walau diam di tempat
}
function stopShare() {
    if (shareWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(shareWatchId);
    shareWatchId = null;
    if (shareTimer) clearInterval(shareTimer);
    shareTimer = null; shareLast = null; shareLastOk = 0;
}
function retryTracking() {
    shareDenied = false;
    ensureTracking();
    renderMitraTasks(); renderOrderDetail(true);
}
function trackingBanner() {
    if (!runningTasks().length) return '';
    if (shareDenied) return `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="font-bold text-sm text-rose-900"><i class="fa-solid fa-location-crosshairs mr-1"></i>Pelacakan lokasi dimatikan</p>
        <p class="text-[11px] text-rose-700">Pelacakan wajib aktif selama tugas berjalan. Izinkan lokasi di browser, lalu coba lagi. Tahap tugas tidak bisa diperbarui sebelum itu.</p></div>
        <button onclick="retryTracking()" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600">Coba Lagi</button></div>`;
    const live = isSharing() && shareLastOk && (Date.now() - shareLastOk) < 90000;
    return `<div class="${live ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'} border rounded-2xl p-4">
        <p class="font-bold text-sm ${live ? 'text-emerald-900' : 'text-amber-900'}"><i class="fa-solid fa-satellite-dish mr-1"></i>${live ? 'Pelacakan aktif (otomatis)' : 'Menunggu sinyal GPS...'}</p>
        <p class="text-[11px] ${live ? 'text-emerald-700' : 'text-amber-700'}">Pemesan melihat posisi Anda di peta selama tugas berjalan. Biarkan halaman ini tetap terbuka dan GPS menyala.</p></div>`;
}
// =====================================================================
// v3: ON/OFF Mitra, jangkauan, chat dalam website
// =====================================================================
let dbChatUnread = {};
let providerBusy = false;
let chatGraceHours = 24;

// ---------- Pembagian suruhan ke Mitra: kampus + radius (termasuk luar kampus) ----------
function distKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function orderPoints(o) {
    const pts = [{ p: ptOf(o, 'awal'), area: o.Area_awal }];
    if (o.Mode_lokasi !== 'satu') pts.push({ p: ptOf(o, 'tujuan'), area: o.Area_tujuan });
    return pts;
}
/** Jarak titik terdekat pesanan dari pusat kampus yang sedang dipilih Mitra (km), atau null bila tanpa koordinat. */
function nearestKm(o) {
    const center = AREA_CENTER[currentMitraArea];
    const d = orderPoints(o).filter(x => x.p.lat !== null).map(x => distKm(center, [x.p.lat, x.p.lng]));
    return d.length ? Math.min(...d) : null;
}
/** Suruhan tampil bila salah satu titiknya di kampus Mitra, ATAU berada dalam radius Mitra dari pusat kampusnya. */
function orderMatchesMitra(o) {
    const center = AREA_CENTER[currentMitraArea];
    const radius = Number(currentProvider?.Radius_km || 5);
    return orderPoints(o).some(({ p, area }) => {
        if (area === currentMitraArea) return true;
        if (p.lat !== null) return distKm(center, [p.lat, p.lng]) <= radius;
        return area === 'Luar Kampus';   // di luar kampus tanpa koordinat: tampil agar tidak terlewat
    });
}

// ---------- Status ON/OFF Mitra (default OFF) ----------
function renderMitraStatusBar() {
    const c = el('mitraStatusBar');
    if (!c) return;
    if (!currentProvider) { c.innerHTML = ''; return; }
    const on = Number(currentProvider.is_online) === 1;
    c.innerHTML = `<button type="button" onclick="toggleOnline(this)" role="switch" aria-checked="${on}" class="flex items-center gap-2 px-3 py-1.5 rounded-xl border font-bold text-xs whitespace-nowrap transition ${on ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : 'bg-slate-700/60 text-slate-300 border-slate-500/50'}">
        <span class="relative inline-block w-9 h-5 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-slate-500'}"><span class="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all" style="left:${on ? '18px' : '2px'}"></span></span>
        ${on ? 'Siap Menerima Suruhan' : 'Sedang OFF'}</button>`;
}
async function toggleOnline(btn) {
    if (!currentProvider) return;
    const want = Number(currentProvider.is_online) !== 1;
    await lockRun(btn, async () => {
        const r = await api('set_online.php', { online: want }, { retry: true });
        if (!r.ok) return showToast(r.message || 'Gagal mengubah status.', 'error');
        showToast(want ? 'Status ON. Suruhan sesuai jangkauan Anda akan tampil.' : 'Status OFF. Anda tidak akan menerima suruhan baru.', 'success');
        await syncAll();
    });
}
async function updateProfileRadius(v) {
    if (!currentProvider) return;
    const r = await api('update_area.php', { radius_km: Number(v) });
    if (!r.ok) { showToast(r.message || 'Gagal menyimpan jangkauan.', 'error'); renderMitraProfile(); return; }
    currentProvider.Radius_km = Number(v);
    renderMitraFeed();
    showToast(`Jangkauan diatur ${v} km dari pusat kampus.`, 'success');
}

// ---------- Chat dalam website ----------
let chatId = null, chatLastId = 0, chatTimer = null, chatBusy = false, chatSeen = new Set(), chatFails = 0;
function chatSchedule() {
    clearTimeout(chatTimer);
    if (!chatId) return;
    const delay = Math.min(20000, 6000 + chatFails * 4000);   // 6 dtk normal, melambat bila server sibuk
    chatTimer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await chatPoll(false, false);
        chatSchedule();
    }, delay);
}
const QUICK_PEMESAN = ['Terima kasih 🙏', 'Baik, saya tunggu ya', 'Tolong kabari kalau sudah sampai', 'Saya sudah di lokasi', 'Boleh minta foto barangnya?', 'Tolong antar ke depan gerbang ya', 'Sudah sesuai pesanan, terima kasih!'];
const QUICK_MITRA = ['Saya sudah menuju lokasi 🏍️', 'Saya sudah sampai di lokasi', 'Mohon ditunggu sebentar ya', 'Antrean agak panjang, estimasi 10 menit', 'Barang sudah dibeli, segera saya antar', 'Saya sudah di titik tujuan, mohon keluar ya', 'Boleh kirim foto atau ciri-ciri lokasinya?'];

function chatState(o) {
    if (o.status_order === 'Diproses') return 'open';
    if (o.status_order === 'Selesai') {
        if (!o.completed_at) return 'closed';
        const t = new Date(String(o.completed_at).replace(' ', 'T') + '+07:00').getTime();
        return t + chatGraceHours * 3600 * 1000 > Date.now() ? 'open' : 'closed';
    }
    return 'none';
}
function chatBtn(o, big = false) {
    const st = chatState(o);
    if (st === 'none') return '';
    const n = Number(dbChatUnread[o.id_Orders] || 0);
    return `<button onclick="openChat('${esc(o.id_Orders)}')" class="relative ${big ? 'w-full py-3 text-sm' : 'px-2.5 py-1.5 text-xs'} bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm">
        <i class="fa-solid fa-comments mr-1"></i>${st === 'open' ? 'Chat' : 'Riwayat Chat'}
        ${n ? `<span class="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">${n}</span>` : ''}</button>`;
}
function openChat(id) {
    const o = findOrder(id);
    if (!o) return;
    chatId = id; chatLastId = 0; chatSeen = new Set();
    el('chatMessages').innerHTML = '<p id="chatEmptyNote" class="text-center text-xs text-slate-400 py-6">Memuat chat...</p>';
    setText('chatTitle', o.Judul);
    setText('chatSub', '');
    el('chatNotice').classList.add('hidden');
    el('chatAttachMenu').classList.add('hidden');
    renderChatQuick(o);
    el('modalChat').classList.remove('hidden');
    syncBodyLock();
    chatPoll(true, false);
    chatFails = 0;
    chatSchedule();
}
function closeChat(noSync) {
    chatId = null;
    clearTimeout(chatTimer); chatTimer = null;
    el('modalChat')?.classList.add('hidden');
    syncBodyLock();
    if (!noSync && currentLoggedInUser) syncAll();   // perbarui penanda belum dibaca
}
function renderChatQuick(o) {
    const list = o._role === 'mitra' ? QUICK_MITRA : QUICK_PEMESAN;
    el('chatQuick').innerHTML = list.map(t => `<button type="button" data-t="${esc(t)}" onclick="sendChatText(this.dataset.t)" class="shrink-0 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-full text-[11px] font-bold whitespace-nowrap">${esc(t)}</button>`).join('');
}
async function chatPoll(initial, force) {
    if (!chatId || (chatBusy && !force)) return;
    chatBusy = true;
    const id = chatId;
    try {
        const r = await api('pesan_ambil.php', { id_orders: id, after: chatLastId });
        if (id !== chatId) return;
        if (!r.ok) {
            chatFails++;
            if (initial) el('chatMessages').innerHTML = `<p class="text-center text-xs text-rose-600 py-6 px-4">${esc(r.message || 'Gagal memuat chat.')}</p>`;
            else { const n = el('chatNotice'); if (n) { n.textContent = 'Koneksi terputus sesaat. Mencoba lagi otomatis...'; n.classList.remove('hidden'); } }
            return;
        }
        chatFails = 0;
        const d = r.data;
        setText('chatSub', d.partner ? `Dengan ${d.partner}` : 'Menunggu Mitra ditugaskan');
        applyChatState(d);
        if (d.messages.length) appendChatMessages(d.messages, initial);
        else if (initial) el('chatMessages').innerHTML = '<p id="chatEmptyNote" class="text-center text-xs text-slate-400 py-6">Belum ada pesan. Sapa dulu atau pakai balasan cepat di bawah.</p>';
    } finally { chatBusy = false; }
}
function applyChatState(r) {
    el('chatComposerWrap')?.classList.toggle('hidden', !r.open);
    const n = el('chatNotice');
    if (!r.open) { n.textContent = 'Chat ditutup. Riwayat tetap bisa dibaca.'; n.classList.remove('hidden'); }
    else if (r.closes_at) { n.textContent = `Tugas sudah selesai. Chat tetap terbuka sampai ${fmtDate(r.closes_at)}.`; n.classList.remove('hidden'); }
    else n.classList.add('hidden');
}
function appendChatMessages(msgs, initial) {
    const box = el('chatMessages');
    const stick = initial || (box.scrollHeight - box.scrollTop - box.clientHeight < 140);
    el('chatEmptyNote')?.remove();
    let html = '';
    for (const m of msgs) {
        if (chatSeen.has(m.id_msg)) continue;
        chatSeen.add(m.id_msg);
        chatLastId = Math.max(chatLastId, Number(m.id_msg));
        html += chatBubble(m);
    }
    if (!html) return;
    box.insertAdjacentHTML('beforeend', html);
    if (stick) box.scrollTop = box.scrollHeight;
}
function chatBubble(m) {
    const time = String(m.created_at || '').slice(11, 16);
    if (m.Tipe === 'sistem') return `<div class="text-center"><span class="inline-block bg-slate-200 text-slate-600 text-[10px] font-bold px-2.5 py-1 rounded-full">${esc(m.Isi)} · ${time}</span></div>`;
    let media = '';
    if (m.Tipe === 'foto' && m.id_photo) media = `<a href="photo.php?id=${Number(m.id_photo)}" target="_blank" rel="noopener"><img src="photo.php?id=${Number(m.id_photo)}" loading="lazy" alt="Foto" class="rounded-xl max-h-56 w-full object-cover mb-1"></a>`;
    if (m.Tipe === 'video' && m.id_video) media = `<video controls preload="metadata" playsinline src="video.php?id=${Number(m.id_video)}" class="rounded-xl max-h-56 w-full mb-1 bg-black"></video>`;
    const mine = !!m.mine;
    return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}"><div class="max-w-[82%] px-3 py-2 text-sm ${mine ? 'bg-unesa-navy text-white rounded-2xl rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm'}">
        ${mine ? '' : `<p class="text-[10px] font-bold text-unesa-navy mb-0.5">${esc(m.nama || '')}</p>`}
        ${media}
        ${m.Isi ? `<p class="whitespace-pre-line break-words">${esc(m.Isi)}</p>` : ''}
        <p class="text-[9px] mt-0.5 text-right ${mine ? 'text-slate-300' : 'text-slate-400'}">${time}</p></div></div>`;
}
async function chatSend(extra) {
    const r = await api('pesan_kirim.php', Object.assign({ id_orders: chatId }, extra), { retry: true });
    if (!r.ok) { showToast(r.message || 'Pesan gagal dikirim.', 'error'); return false; }
    await chatPoll(false, true);
    return true;
}
async function sendChatText(text) {
    if (!chatId) return;
    const input = el('chatInput'), quick = typeof text === 'string';
    const t = (quick ? text : (input?.value || '')).trim();
    if (!t) return;
    const btn = el('chatSendBtn');
    if (btn) btn.disabled = true;
    const ok = await chatSend({ teks: t });
    if (btn) btn.disabled = false;
    if (ok && !quick && input) input.value = '';
}
function toggleChatAttach() { el('chatAttachMenu')?.classList.toggle('hidden'); }
async function uploadVideo(file) {
    const fd = new FormData();
    fd.append('video', file, file.name || 'video.mp4');
    let res, text;
    try {
        res = await fetch('upload_video.php', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'UNESA-Suruh' }, body: fd });
        text = await res.text();
    } catch (e) { return { ok: false, message: 'Tidak dapat terhubung ke server.' }; }
    try { const d = JSON.parse(text); return { ok: d.status === 'success', message: d.message || '', data: d }; }
    catch (e) { return { ok: false, message: 'Server menolak video (kemungkinan melebihi batas upload hosting). Rekam video yang lebih singkat.' }; }
}
async function chatPickMedia(input, type) {
    const f = input.files[0];
    input.value = '';
    if (!f || !chatId) return;
    el('chatAttachMenu').classList.add('hidden');
    const btn = el('chatSendBtn');
    if (btn) btn.disabled = true;
    showToast(type === 'foto' ? 'Mengunggah foto...' : 'Mengunggah video...', 'info');
    try {
        const caption = (el('chatInput')?.value || '').trim();
        if (type === 'foto') {
            const blob = await compressImage(f);
            const r = await uploadPhoto(blob, 'chat');
            if (!r.ok) throw new Error(r.message || 'Foto gagal diunggah.');
            if (!(await chatSend({ id_photo: r.data.id_photo, teks: caption }))) return;
        } else {
            if (f.size > 10 * 1024 * 1024) throw new Error('Video terlalu besar (maks. 10 MB, sekitar 10-15 detik). Rekam video yang lebih singkat.');
            const r = await uploadVideo(f);
            if (!r.ok) throw new Error(r.message || 'Video gagal diunggah.');
            if (!(await chatSend({ id_video: r.data.id_video, teks: caption }))) return;
        }
        if (el('chatInput')) el('chatInput').value = '';
    } catch (e) {
        showToast(e.message || 'Gagal mengirim lampiran.', 'error');
    } finally { if (btn) btn.disabled = false; }
}

// =====================================================================
// v4: batal / mundur / kedaluwarsa, verifikasi KTM, tanggapan admin
// =====================================================================
let expireHours = 6;
const KEPUTUSAN_LABEL = { tolak: 'Laporan ditolak', peringatan: 'Tanggapan admin', refund: 'Pembayaran dikembalikan', selesaikan: 'Tugas diselesaikan admin' };

/** Pemesan membatalkan pesanan yang sudah dibayar selama Mitra belum berangkat (refund simulasi). */
async function cancelPaidOrder(btn, orderId) {
    if (!confirm('Batalkan pesanan ini? Pembayaran dikembalikan (simulasi) dan Mitra dibatalkan. Hanya bisa selama Mitra belum mulai.')) return;
    const alasan = prompt('Alasan pembatalan (opsional):', '');
    if (alasan === null) return;
    await lockRun(btn, async () => {
        const r = await api('cancel_order.php', { id_orders: orderId, alasan });
        if (!r.ok) return showToast(r.message || 'Gagal membatalkan pesanan.', 'error');
        closeOrderDetail();
        showToast('Pesanan dibatalkan dan pembayaran dikembalikan.', 'success');
        await syncAll();
    });
}
/** Mitra mundur dari tugas yang belum dimulai. */
async function withdrawTask(btn, orderId) {
    if (!confirm('Mundur dari tugas ini? Pesanan dibatalkan dan pembayaran pemesan dikembalikan. Terlalu sering mundur dapat ditinjau admin.')) return;
    const alasan = prompt('Alasan mundur (opsional):', '');
    if (alasan === null) return;
    await lockRun(btn, async () => {
        const r = await api('mundur_tugas.php', { id_orders: orderId, alasan });
        if (!r.ok) return showToast(r.message || 'Gagal mundur dari tugas.', 'error');
        closeOrderDetail();
        showToast('Anda mundur dari tugas. Pesanan dibatalkan.', 'info');
        await syncAll();
    });
}

// ---------- Verifikasi KTM ----------
function renderKtmBox() {
    const note = el('ktmNote'), cur = el('ktmCurrent');
    if (!note || !currentProvider) return;
    const p = currentProvider;
    if (p.Status_verifikasi === 'Terverifikasi') { note.className = 'text-[11px] text-emerald-700 font-bold'; note.textContent = '✓ Akun Mitra Anda sudah terverifikasi admin.'; }
    else if (p.Status_verifikasi === 'Ditolak') { note.className = 'text-[11px] text-rose-700 font-bold'; note.textContent = 'Verifikasi ditolak' + (p.Catatan_verifikasi ? ': ' + p.Catatan_verifikasi : '') + '. Kirim ulang foto KTM yang jelas.'; }
    else { note.className = 'text-[11px] text-amber-700 font-bold'; note.textContent = p.id_photo_ktm ? 'Menunggu admin memeriksa KTM Anda.' : 'Unggah foto KTM agar admin dapat memverifikasi akun Anda.'; }
    if (cur) cur.innerHTML = p.id_photo_ktm ? `<p class="text-[10px] text-slate-400 mb-1">KTM terkirim:</p>${photoThumb(p.id_photo_ktm, 'w-28 h-20')}` : '';
    renderPhotoBox('ktm');
}
async function submitKtm(btn) {
    if (!photosReady('ktm')) return showToast('Tunggu foto selesai diunggah.', 'info');
    const id = photoIds('ktm')[0];
    if (!id) return showToast('Pilih foto KTM dulu (kamera atau galeri).', 'warning');
    await lockRun(btn, async () => {
        const r = await api('set_ktm.php', { id_photo: id });
        if (!r.ok) return showToast(r.message || 'Gagal mengirim KTM.', 'error');
        resetPhotoBox('ktm');
        showToast('KTM terkirim. Admin akan memeriksa verifikasi akun Anda.', 'success');
        await syncAll();
    });
}

// =====================================================================
// v5: SOS, penilaian pemesan, Pesan Lagi, badge judul tab & bunyi
// =====================================================================
let toastCounter = 0;
const BASE_TITLE = (typeof document !== 'undefined' && document.title) || 'UNESA Suruh';

function ratingChip(r, n) {
    return Number(n) > 0 ? `<span class="text-amber-600 font-bold">⭐ ${Number(r).toFixed(1)} (${Number(n)})</span>` : '<span class="text-slate-400">pemesan baru</span>';
}
function sosBtn(o) {
    const strong = o.alur === 'orang';
    return `<button onclick="sendSOS(this,'${esc(o.id_Orders)}')" class="w-full py-2.5 ${strong ? 'bg-rose-600 text-white' : 'bg-white border border-rose-300 text-rose-600'} hover:opacity-90 font-bold text-xs rounded-xl"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Darurat (SOS) ke Admin</button>`;
}
/** SOS: kirim laporan prioritas ke admin, lengkap dengan posisi bila GPS tersedia. */
async function sendSOS(btn, orderId) {
    if (!confirm('Kirim SOS ke admin? Gunakan hanya untuk keadaan darurat atau pelanggaran serius. Posisi Anda ikut dikirim bila GPS aktif.')) return;
    const pesan = prompt('Jelaskan singkat keadaannya (opsional):', '');
    if (pesan === null) return;
    await lockRun(btn, async () => {
        let pos = null;
        if (navigator.geolocation) {
            pos = await new Promise(res => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000 }));
        }
        const r = await api('sos.php', Object.assign({ id_orders: orderId, pesan }, pos || {}), { retry: true });
        if (!r.ok) return showToast(r.message || 'SOS gagal dikirim. Hubungi layanan darurat setempat bila perlu.', 'error');
        showToast('SOS terkirim ke admin. Tetap di tempat aman dan hubungi pihak berwenang bila perlu.', 'success');
        await syncAll();
    });
}

// ---------- Penilaian dua arah ----------
let reviewTarget = 'mitra';   // 'mitra' (pemesan menilai Mitra) | 'pemesan' (Mitra menilai pemesan)
function openReviewModal(orderId, target = 'mitra') {
    reviewTarget = target;
    const o = target === 'pemesan' ? dbMyBids.find(x => x.id_Orders === orderId) : dbMyOrders.find(x => x.id_Orders === orderId);
    if (!o) return;
    el('reviewOrderId').value = orderId;
    setText('reviewMitraName', target === 'pemesan' ? `${o.pemesan_nama || 'Pemesan'} - ${o.Judul}` : `${o.mitra_nama || 'Mitra'} - ${o.Judul}`);
    el('reviewRating').value = '5';
    el('reviewKomentar').value = '';
    el('modalReview')?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}
async function handleSubmitReview(event) {
    event.preventDefault();
    await lockRun(submitBtn(event), async () => {
        const r = await api(reviewTarget === 'pemesan' ? 'submit_review_pemesan.php' : 'submit_review.php', {
            id_orders: el('reviewOrderId')?.value,
            rating: parseInt(el('reviewRating')?.value || 5, 10),
            komentar: el('reviewKomentar')?.value || ''
        });
        if (!r.ok) return showToast(r.message || 'Gagal mengirim ulasan.', 'error');
        closeReviewModal();
        showToast(reviewTarget === 'pemesan' ? 'Terima kasih! Penilaian pemesan tersimpan.' : 'Terima kasih! Ulasan Anda tersimpan dan memperbarui rating Mitra.', 'success');
        await syncAll();
    });
}

// ---------- Pesan Lagi ----------
function reorder(id) {
    const o = dbMyOrders.find(x => x.id_Orders === id);
    if (!o) return;
    switchTab('pemesan-create');
    const set = (eid, v) => { const e = el(eid); if (e) e.value = v ?? ''; };
    set('orderCategory', o.id_category);
    set('orderJudul', o.Judul); set('orderDeskripsi', o.Deskripsi_Permintaan); set('orderHargaDiajukan', o.Harga_diajukan);
    set('orderAreaAwal', o.Area_awal); set('orderLokasiAwalDetail', o.Lokasi_awal);
    set('orderAreaTujuan', o.Area_tujuan); set('orderLokasiTujuanDetail', o.Lokasi_tujuan);
    const radio = document.querySelector(`input[name="orderModeCustom"][value="${o.Mode_lokasi === 'satu' ? 'satu' : 'rute'}"]`);
    if (radio) radio.checked = true;
    const g = (lat, lng, url) => ({ lat: hasGeo(lat, lng) ? Number(lat) : null, lng: hasGeo(lat, lng) ? Number(lng) : null, url: url || '' });
    orderGeo.awal = g(o.Lat_awal, o.Lng_awal, o.Peta_awal_url);
    orderGeo.tujuan = g(o.Lat_tujuan, o.Lng_tujuan, o.Peta_tujuan_url);
    set('orderGmapsAwal', orderGeo.awal.url); set('orderGmapsTujuan', orderGeo.tujuan.url);
    renderPointChip('awal'); renderPointChip('tujuan');
    resetPhotoBox('order');
    if (el('orderSetuju')) el('orderSetuju').checked = false;
    applyOrderMode();
    showToast('Data pesanan disalin. Periksa, centang persetujuan aturan, lalu publikasikan.', 'info');
}

// ---------- Badge judul tab & bunyi notifikasi ----------
function updateTabBadge() {
    let n = 0;
    if (currentLoggedInUser) {
        n += Object.values(dbChatUnread).reduce((a, b) => a + Number(b || 0), 0);
        n += dbOffersReceived.filter(o => o.status_offer === 'Pending').length;
    }
    document.title = (n ? `(${n}) ` : '') + BASE_TITLE;
}
let audioCtx = null;
function notifyBeep() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = audioCtx || new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;
        [880, 1175].forEach((f, i) => {
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t + i * 0.16);
            g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16);
        });
    } catch (e) { /* browser memblokir audio: abaikan */ }
}

// ---------- TOAST ----------
function showToast(message, type = 'info') {
    const container = el('toastContainer');
    if (!container) return;
    toastCounter++;
    if (container.parentNode !== document.body) document.body.appendChild(container);   // pastikan di luar pop-up manapun
    const styles = {
        info: ["bg-slate-900 text-white border-slate-500", "fa-circle-info text-sky-300"],
        success: ["bg-emerald-700 text-white border-emerald-300", "fa-circle-check text-white"],
        error: ["bg-rose-700 text-white border-rose-300", "fa-circle-exclamation text-white"],
        warning: ["bg-amber-400 text-slate-900 border-amber-600", "fa-triangle-exclamation text-slate-900"]
    };
    const [bg, icon] = styles[type] || styles.info;
    const toast = document.createElement('div');
    toast.className = `p-3.5 rounded-xl border-2 shadow-2xl flex items-center space-x-3 text-xs font-bold pointer-events-auto transition-all transform translate-y-2 opacity-0 ${bg}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const i = document.createElement('i'); i.className = `fa-solid ${icon} text-base shrink-0`;
    const span = document.createElement('span'); span.textContent = message;   // textContent: aman dari XSS
    toast.append(i, span);
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => { toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => toast.remove(), 300); }, type === 'error' ? 7000 : 4500);
}
