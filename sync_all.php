<?php
/**
 * Satu endpoint yang mengirim semua data yang boleh dilihat pengguna yang sedang login.
 * Data selalu difilter di server berdasarkan sesi, bukan berdasarkan kiriman browser.
 */
require __DIR__ . '/config.php';
$pdo = db();
expire_stale_orders($pdo);   // hanguskan pesanan yang terlalu lama tanpa pembayaran

// Jenis tahapan efektif: pesanan "satu lokasi" selalu memakai alur 'kerja'
$ALUR = "CASE WHEN o.Mode_lokasi = 'satu' THEN 'kerja' ELSE c.alur END";

$out = [
    'config' => [
        'platform_fee' => PLATFORM_FEE, 'min_price' => MIN_PRICE, 'min_withdraw' => MIN_WITHDRAW,
        'flows' => FLOWS, 'max_photos' => PHOTO_MAX_PER_ORDER, 'chat_grace_hours' => CHAT_GRACE_HOURS,
        'radius_options' => RADIUS_OPTIONS, 'order_expire_hours' => ORDER_EXPIRE_HOURS,
    ],
    'user' => null, 'provider' => null, 'provider_busy' => false,
    'categories' => $pdo->query('SELECT id_category, nama_kategori, ikon, alur, mode_lokasi FROM categories ORDER BY (alur = \'custom\'), id_category')->fetchAll(),
    'my_orders' => [], 'open_orders' => [], 'offers_received' => [], 'my_bids' => [],
    'payments' => [], 'reports' => [], 'reviews' => [], 'wallet' => null, 'withdrawals' => [],
    'photos' => [], 'tracking' => [], 'chat_unread' => new stdClass(),
];

$user = current_user();
session_write_close();   // endpoint ini tidak menulis sesi: lepas kunci agar permintaan lain tidak antre
if (!$user) ok($out);

$uid  = (int)$user['id_user'];
$prov = current_provider($uid);
$out['user']     = user_payload($user, $prov);
$out['provider'] = $prov;

// ---- Pesanan milik saya (sebagai pemesan) ----
$st = $pdo->prepare("
    SELECT o.*, c.nama_kategori, c.ikon, {$ALUR} AS alur,
           mu.Nama AS mitra_nama, p.Rating AS mitra_rating, p.Total_order_selesai AS mitra_total,
           (SELECT COUNT(*) FROM reviews rv WHERE rv.id_Orders = o.id_Orders) AS has_review
    FROM orders o
    JOIN categories c      ON c.id_category = o.id_category
    LEFT JOIN providers p  ON p.id_provider = o.id_provider
    LEFT JOIN users mu     ON mu.id_user = p.id_user
    WHERE o.id_user = ?
    ORDER BY o.created_at DESC");
$st->execute([$uid]);
$rows = $st->fetchAll();
foreach ($rows as &$r) {
    // Posisi Mitra & kode serah terima hanya untuk pesanan yang sedang berjalan
    if ($r['status_order'] !== 'Diproses') { $r['mitra_lat'] = null; $r['mitra_lng'] = null; $r['mitra_loc_at'] = null; $r['kode_selesai'] = null; }
    unset($r['kode_gagal'], $r['kode_lock_until']);
}
unset($r);
$out['my_orders'] = $rows;

// ---- Tawaran masuk ke pesanan saya ----
$st = $pdo->prepare("
    SELECT f.*, mu.Nama AS mitra_nama, mu.Foto_profil AS mitra_foto,
           p.Rating AS mitra_rating, p.Total_order_selesai AS mitra_total,
           p.Fakultas AS mitra_fakultas, p.Area_kerja AS mitra_area
    FROM offers f
    JOIN orders o     ON o.id_Orders = f.id_Orders
    JOIN providers p  ON p.id_provider = f.id_provider
    JOIN users mu     ON mu.id_user = p.id_user
    WHERE o.id_user = ?
    ORDER BY f.created_at DESC");
$st->execute([$uid]);
$out['offers_received'] = $st->fetchAll();

// ---- Pembayaran & laporan saya ----
$st = $pdo->prepare("SELECT pay.*, o.Judul FROM payments pay JOIN orders o ON o.id_Orders = pay.id_Orders WHERE pay.id_user = ? ORDER BY pay.paid_at DESC");
$st->execute([$uid]);
$out['payments'] = $st->fetchAll();

$st = $pdo->prepare("SELECT r.*, o.Judul FROM reports r JOIN orders o ON o.id_Orders = r.id_Orders WHERE r.id_user = ? ORDER BY r.created_at DESC");
$st->execute([$uid]);
$out['reports'] = $st->fetchAll();

// ---- Data khusus Mitra ----
$pidAll = 0; $isVer = 0;
if ($prov) {
    $pid = $pidAll = (int)$prov['id_provider'];
    $busy = provider_busy($pdo, $pid);
    $out['provider_busy'] = $busy;
    $isVer = ($prov['Status_verifikasi'] === 'Terverifikasi') ? 1 : 0;

    // Bursa suruhan: hanya untuk Mitra terverifikasi, status ON, dan tidak sedang mengerjakan tugas
    if ($isVer && (int)$prov['is_online'] === 1 && !$busy) {
        $st = $pdo->prepare("
            SELECT o.id_Orders, o.Judul, o.Deskripsi_Permintaan, o.Mode_lokasi,
                   o.Area_awal, o.Lokasi_awal, o.Lat_awal, o.Lng_awal, o.Peta_awal_url,
                   o.Area_tujuan, o.Lokasi_tujuan, o.Lat_tujuan, o.Lng_tujuan, o.Peta_tujuan_url,
                   o.Harga_diajukan, o.is_custom, o.status_order, o.progress, o.created_at,
                   c.nama_kategori, c.ikon, {$ALUR} AS alur, u.Nama AS pemesan_nama,
                   u.Rating_pemesan AS pemesan_rating, u.Total_dinilai AS pemesan_dinilai,
                   (SELECT COUNT(*) FROM offers f WHERE f.id_Orders = o.id_Orders) AS jumlah_tawaran,
                   (SELECT COUNT(*) FROM offers f2 WHERE f2.id_Orders = o.id_Orders AND f2.id_provider = :pid) AS sudah_menawar
            FROM orders o
            JOIN categories c ON c.id_category = o.id_category
            JOIN users u      ON u.id_user = o.id_user
            WHERE o.status_order = 'Menunggu Tawaran' AND o.id_user <> :uid
            ORDER BY o.created_at DESC LIMIT 200");
        $st->execute([':pid' => $pid, ':uid' => $uid]);
        $out['open_orders'] = $st->fetchAll();
    }

    // Tawaran yang saya kirim
    $st = $pdo->prepare("
        SELECT f.*, o.Judul, o.Deskripsi_Permintaan, o.Mode_lokasi,
               o.Area_awal, o.Lokasi_awal, o.Lat_awal, o.Lng_awal, o.Peta_awal_url,
               o.Area_tujuan, o.Lokasi_tujuan, o.Lat_tujuan, o.Lng_tujuan, o.Peta_tujuan_url, o.Harga_diajukan,
               o.status_order, o.progress, o.completed_at, o.Alasan_batal, c.nama_kategori, c.ikon, {$ALUR} AS alur,
               u.Nama AS pemesan_nama, u.Rating_pemesan AS pemesan_rating, u.Total_dinilai AS pemesan_dinilai,
               (SELECT COUNT(*) FROM reviews_pemesan rp WHERE rp.id_Orders = o.id_Orders) AS has_review_pemesan
        FROM offers f
        JOIN orders o ON o.id_Orders = f.id_Orders
        JOIN categories c ON c.id_category = o.id_category
        JOIN users u  ON u.id_user = o.id_user
        WHERE f.id_provider = ?
        ORDER BY f.created_at DESC");
    $st->execute([$pid]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        if ($r['status_offer'] === 'Rejected') {   // tawaran ditolak: titik lokasi tidak perlu dibuka lagi
            foreach (['Lat_awal','Lng_awal','Peta_awal_url','Lat_tujuan','Lng_tujuan','Peta_tujuan_url'] as $k) $r[$k] = null;
        }
    }
    unset($r);
    $out['my_bids'] = $rows;

    $st = $pdo->prepare("
        SELECT rv.id_review, rv.id_Orders, rv.Rating, rv.Komentar, rv.created_at, u.Nama AS pemesan_nama
        FROM reviews rv JOIN users u ON u.id_user = rv.id_user
        WHERE rv.id_provider = ? ORDER BY rv.created_at DESC LIMIT 30");
    $st->execute([$pid]);
    $out['reviews'] = $st->fetchAll();

    $out['wallet'] = wallet_for($pdo, $pid);

    $st = $pdo->prepare('SELECT id_withdraw, Jumlah, Metode, Tujuan, Status, created_at FROM withdrawals WHERE id_provider = ? ORDER BY created_at DESC LIMIT 20');
    $st->execute([$pid]);
    $out['withdrawals'] = $st->fetchAll();
}

// ---- Foto lampiran / bukti tahap & riwayat tahapan yang boleh saya lihat (foto chat diambil lewat pesan_ambil) ----
$st = $pdo->prepare("
    SELECT ph.id_photo, ph.id_Orders, ph.kind, ph.created_at
    FROM photos ph JOIN orders o ON o.id_Orders = ph.id_Orders
    WHERE ph.kind <> 'chat' AND (o.id_user = :u OR o.id_provider = :p
       OR (ph.kind = 'lampiran' AND o.status_order = 'Menunggu Tawaran' AND :v = 1))
    ORDER BY ph.id_photo LIMIT 800");
$st->execute([':u' => $uid, ':p' => $pidAll, ':v' => $isVer]);
$out['photos'] = $st->fetchAll();

$st = $pdo->prepare("
    SELECT t.id_track, t.id_Orders, t.step, t.label, t.catatan, t.id_photo, t.created_at
    FROM order_tracking t JOIN orders o ON o.id_Orders = t.id_Orders
    WHERE o.id_user = :u OR o.id_provider = :p
    ORDER BY t.id_Orders, t.step LIMIT 1500");
$st->execute([':u' => $uid, ':p' => $pidAll]);
$out['tracking'] = $st->fetchAll();

// ---- Jumlah pesan chat belum dibaca per pesanan ----
$st = $pdo->prepare("
    SELECT m.id_Orders, COUNT(*) AS n
    FROM chat_messages m
    JOIN orders o ON o.id_Orders = m.id_Orders
    LEFT JOIN chat_reads r ON r.id_Orders = m.id_Orders AND r.id_user = :u1
    WHERE (o.id_user = :u2 OR o.id_provider = :p)
      AND m.id_user <> :u3 AND m.Tipe <> 'sistem'
      AND m.id_msg > COALESCE(r.last_read, 0)
    GROUP BY m.id_Orders");
$st->execute([':u1' => $uid, ':u2' => $uid, ':u3' => $uid, ':p' => $pidAll]);
$unread = [];
foreach ($st->fetchAll() as $r) $unread[$r['id_Orders']] = (int)$r['n'];
$out['chat_unread'] = $unread ?: new stdClass();

ok($out);
