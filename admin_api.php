<?php
/**
 * API panel admin (dipakai admin.html). Semua aksi lewat POST JSON: {"aksi": "...", ...}.
 * Hanya akun dengan users.is_admin = 1. Setiap tindakan penting dicatat di tabel admin_log.
 */
require __DIR__ . '/config.php';
$in    = require_post();
// Gerbang admin: balasan JSON biasa (HTTP 200) agar tidak dialihkan hosting seperti respons 4xx
$admin = current_user();
if (!$admin) { json_out(['status' => 'error', 'kode' => 'belum_login', 'message' => 'Silakan masuk dulu di halaman utama.']); exit; }
if (!(int)$admin['is_admin']) { json_out(['status' => 'error', 'kode' => 'bukan_admin', 'message' => 'Akun ini bukan admin.']); exit; }
$pdo   = db();
$aid   = (int)$admin['id_user'];
$aksi  = clean($in['aksi'] ?? '');

function note_of(array $in, int $min = 0, int $max = 480): string {
    $n = clean($in['catatan'] ?? '');
    if (len($n) < $min) fail('Catatan wajib diisi (minimal ' . $min . ' karakter).');
    if (len($n) > $max) fail('Catatan maksimal ' . $max . ' karakter.');
    return $n;
}

switch ($aksi) {

case 'stats':
    $q = fn($sql) => (int)$pdo->query($sql)->fetchColumn();
    $byStatus = [];
    foreach ($pdo->query("SELECT status_order, COUNT(*) n FROM orders GROUP BY status_order")->fetchAll() as $r) $byStatus[$r['status_order']] = (int)$r['n'];
    ok(['stats' => [
        'pengguna'        => $q("SELECT COUNT(*) FROM users"),
        'mitra'           => $q("SELECT COUNT(*) FROM providers"),
        'mitra_menunggu'  => $q("SELECT COUNT(*) FROM providers WHERE Status_verifikasi = 'Menunggu Verifikasi'"),
        'sos_menunggu'    => $q("SELECT COUNT(*) FROM reports WHERE Darurat = 1 AND Status = 'Menunggu Review'"),
        'laporan_menunggu'=> $q("SELECT COUNT(*) FROM reports WHERE Status = 'Menunggu Review'"),
        'tarik_menunggu'  => $q("SELECT COUNT(*) FROM withdrawals WHERE Status = 'Diproses'"),
        'macet'           => $q("SELECT COUNT(*) FROM orders WHERE status_order = 'Diproses' AND updated_at < NOW() - INTERVAL " . (int)STALE_TASK_HOURS . " HOUR"),
        'nilai_transaksi' => $q("SELECT COALESCE(SUM(Total_bayar),0) FROM payments WHERE Status = 'Lunas'"),
        'dikembalikan'    => $q("SELECT COALESCE(SUM(Total_bayar),0) FROM payments WHERE Status = 'Dikembalikan'"),
        'pesanan'         => $byStatus,
        'stale_jam'       => STALE_TASK_HOURS,
    ]]);

case 'providers':
    $f = clean($in['filter'] ?? 'Menunggu Verifikasi');
    $where = in_array($f, ['Menunggu Verifikasi', 'Terverifikasi', 'Ditolak'], true) ? 'WHERE p.Status_verifikasi = ' . $pdo->quote($f) : '';
    $rows = $pdo->query("
        SELECT p.id_provider, p.NIM, p.Fakultas, p.Area_kerja, p.Status_verifikasi, p.Catatan_verifikasi, p.id_photo_ktm,
               p.Rating, p.Total_order_selesai, p.Total_mundur, p.is_online,
               u.id_user, u.Nama, u.email, u.NO_hp, u.Status_akun
        FROM providers p JOIN users u ON u.id_user = p.id_user $where
        ORDER BY (p.Status_verifikasi = 'Menunggu Verifikasi') DESC, p.created_at DESC LIMIT 200")->fetchAll();
    ok(['rows' => $rows]);

case 'provider_set':
    $id = (int)($in['id_provider'] ?? 0);
    $status = clean($in['status'] ?? '');
    if (!in_array($status, ['Terverifikasi', 'Ditolak', 'Menunggu Verifikasi'], true)) fail('Status tidak valid.');
    $note = note_of($in, $status === 'Ditolak' ? 3 : 0, 250);
    $st = $pdo->prepare('UPDATE providers SET Status_verifikasi = ?, Catatan_verifikasi = ?, is_online = IF(? = \'Terverifikasi\', is_online, 0) WHERE id_provider = ?');
    $st->execute([$status, $note ?: null, $status, $id]);
    admin_log($pdo, $aid, 'verifikasi_mitra', 'provider#' . $id, $status . ($note ? ': ' . $note : ''));
    ok();

case 'reports':
    $f = clean($in['filter'] ?? 'Menunggu Review');
    $where = $f === 'Selesai' ? "WHERE r.Status = 'Selesai'" : ($f === 'all' ? '' : "WHERE r.Status <> 'Selesai'");
    $rows = $pdo->query("
        SELECT r.id_report, r.id_Orders, r.Alasan, r.id_photo, r.Darurat, r.Lat, r.Lng, r.Status, r.Keputusan, r.Catatan_admin, r.created_at, r.Ditangani_pada,
               o.Judul, o.status_order, o.Harga_final, o.Harga_diajukan,
               ru.Nama AS pelapor_nama, ru.NO_hp AS pelapor_hp,
               ou.Nama AS pemesan_nama, ou.NO_hp AS pemesan_hp, mu.Nama AS mitra_nama, mu.NO_hp AS mitra_hp
        FROM reports r
        JOIN orders o ON o.id_Orders = r.id_Orders
        JOIN users ru ON ru.id_user = r.id_user
        JOIN users ou ON ou.id_user = o.id_user
        LEFT JOIN providers p ON p.id_provider = o.id_provider
        LEFT JOIN users mu ON mu.id_user = p.id_user
        $where ORDER BY (r.Status <> 'Selesai') DESC, r.Darurat DESC, r.created_at DESC LIMIT 200")->fetchAll();
    ok(['rows' => $rows]);

case 'report_resolve':
    $id  = (int)($in['id_report'] ?? 0);
    $dec = clean($in['keputusan'] ?? '');
    if (!in_array($dec, ['tolak', 'peringatan', 'refund', 'selesaikan'], true)) fail('Keputusan tidak valid.');
    $note = note_of($in, 3, 480);
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT r.id_Orders, r.Status FROM reports r WHERE r.id_report = ? FOR UPDATE');
    $st->execute([$id]);
    $rep = $st->fetch();
    if (!$rep) fail_tx($pdo, 'Laporan tidak ditemukan.', 404);
    if ($rep['Status'] === 'Selesai') fail_tx($pdo, 'Laporan ini sudah ditangani.', 409);
    $oid = $rep['id_Orders'];
    $st = $pdo->prepare('SELECT id_provider, id_category, Mode_lokasi, status_order FROM orders WHERE id_Orders = ? FOR UPDATE');
    $st->execute([$oid]);
    $o = $st->fetch();

    if ($dec === 'refund') {
        if ($o['status_order'] === 'Diproses') {
            cancel_order_core($pdo, $oid, 'admin', 'Keputusan admin atas laporan kendala: ' . $note, true);
        } elseif ($o['status_order'] === 'Selesai') {
            $pdo->prepare("UPDATE orders SET refunded = 1 WHERE id_Orders = ?")->execute([$oid]);
            $pdo->prepare("UPDATE payments SET Status = 'Dikembalikan' WHERE id_Orders = ? AND Status = 'Lunas'")->execute([$oid]);
            if ($o['id_provider']) $pdo->prepare('UPDATE providers SET Total_order_selesai = GREATEST(0, Total_order_selesai - 1) WHERE id_provider = ?')->execute([(int)$o['id_provider']]);
            chat_system($pdo, $oid, 'Admin mengembalikan pembayaran pemesan (simulasi): ' . $note);
        } else fail_tx($pdo, 'Pesanan ini tidak memiliki pembayaran yang bisa dikembalikan.', 409);
    } elseif ($dec === 'selesaikan') {
        if ($o['status_order'] !== 'Diproses' || !$o['id_provider']) fail_tx($pdo, 'Hanya tugas yang sedang berjalan yang bisa diselesaikan paksa.', 409);
        finish_order($pdo, $oid, (int)$o['id_provider'], flow_key_of($pdo, $o), 'Diselesaikan oleh admin: ' . $note, null);
    } else {
        chat_system($pdo, $oid, 'Admin menanggapi laporan: ' . $note);
    }
    $pdo->prepare("UPDATE reports SET Status = 'Selesai', Keputusan = ?, Catatan_admin = ?, Ditangani_pada = NOW() WHERE id_report = ?")->execute([$dec, $note, $id]);
    admin_log($pdo, $aid, 'tangani_laporan', 'laporan#' . $id . ' ' . $oid, $dec . ': ' . $note);
    $pdo->commit();
    ok();

case 'withdrawals':
    $f = clean($in['filter'] ?? 'Diproses');
    $where = in_array($f, ['Diproses', 'Selesai', 'Ditolak'], true) ? 'WHERE w.Status = ' . $pdo->quote($f) : '';
    $rows = $pdo->query("
        SELECT w.id_withdraw, w.Jumlah, w.Metode, w.Tujuan, w.Status, w.Catatan_admin, w.created_at, w.Diproses_pada,
               u.Nama, u.email, p.NIM
        FROM withdrawals w JOIN providers p ON p.id_provider = w.id_provider JOIN users u ON u.id_user = p.id_user
        $where ORDER BY (w.Status = 'Diproses') DESC, w.created_at DESC LIMIT 200")->fetchAll();
    ok(['rows' => $rows]);

case 'withdrawal_set':
    $id = (int)($in['id_withdraw'] ?? 0);
    $status = clean($in['status'] ?? '');
    if (!in_array($status, ['Selesai', 'Ditolak'], true)) fail('Status tidak valid.');
    $note = note_of($in, $status === 'Ditolak' ? 3 : 0, 250);
    $st = $pdo->prepare("UPDATE withdrawals SET Status = ?, Catatan_admin = ?, Diproses_pada = NOW() WHERE id_withdraw = ? AND Status = 'Diproses'");
    $st->execute([$status, $note ?: null, $id]);
    if ($st->rowCount() !== 1) fail('Permintaan penarikan ini sudah diproses atau tidak ada.', 409);
    admin_log($pdo, $aid, 'penarikan', 'wd#' . $id, $status . ($note ? ': ' . $note : ''));   // Ditolak => saldo otomatis kembali ke Mitra
    ok();

case 'orders':
    $f = clean($in['filter'] ?? 'Diproses');
    $q = clean($in['q'] ?? '');
    $conds = []; $args = [];
    if ($f === 'macet') $conds[] = "o.status_order = 'Diproses' AND o.updated_at < NOW() - INTERVAL " . (int)STALE_TASK_HOURS . " HOUR";
    elseif (in_array($f, ['Menunggu Tawaran', 'Diproses', 'Selesai', 'Dibatalkan'], true)) { $conds[] = 'o.status_order = ?'; $args[] = $f; }
    if ($q !== '') { $conds[] = '(o.id_Orders LIKE ? OR o.Judul LIKE ? OR ou.Nama LIKE ?)'; $args[] = "%$q%"; $args[] = "%$q%"; $args[] = "%$q%"; }
    $sql = "SELECT o.id_Orders, o.Judul, o.status_order, o.progress, o.Harga_diajukan, o.Harga_final, o.created_at, o.updated_at,
                   o.Alasan_batal, o.Dibatalkan_oleh, o.refunded,
                   (o.status_order = 'Diproses' AND o.updated_at < NOW() - INTERVAL " . (int)STALE_TASK_HOURS . " HOUR) AS macet,
                   ou.Nama AS pemesan_nama, ou.NO_hp AS pemesan_hp, mu.Nama AS mitra_nama, mu.NO_hp AS mitra_hp
            FROM orders o JOIN users ou ON ou.id_user = o.id_user
            LEFT JOIN providers p ON p.id_provider = o.id_provider LEFT JOIN users mu ON mu.id_user = p.id_user"
         . ($conds ? ' WHERE ' . implode(' AND ', $conds) : '') . ' ORDER BY o.updated_at DESC LIMIT 150';
    $st = $pdo->prepare($sql); $st->execute($args);
    ok(['rows' => $st->fetchAll()]);

case 'order_force':
    $oid = clean($in['id_orders'] ?? '');
    $tindakan = clean($in['tindakan'] ?? '');
    if (!in_array($tindakan, ['batal_refund', 'selesaikan'], true)) fail('Tindakan tidak valid.');
    $note = note_of($in, 3, 150);
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT id_provider, id_category, Mode_lokasi, status_order FROM orders WHERE id_Orders = ? FOR UPDATE');
    $st->execute([$oid]);
    $o = $st->fetch();
    if (!$o) fail_tx($pdo, 'Pesanan tidak ditemukan.', 404);
    if ($o['status_order'] !== 'Diproses') fail_tx($pdo, 'Tindakan paksa hanya untuk tugas yang sedang berjalan.', 409);
    if ($tindakan === 'batal_refund') cancel_order_core($pdo, $oid, 'admin', $note, true);
    else finish_order($pdo, $oid, (int)$o['id_provider'], flow_key_of($pdo, $o), 'Diselesaikan oleh admin: ' . $note, null);
    admin_log($pdo, $aid, 'paksa_' . $tindakan, $oid, $note);
    $pdo->commit();
    ok();

case 'users':
    $q = clean($in['q'] ?? '');
    $args = []; $where = '';
    if ($q !== '') { $where = 'WHERE u.Nama LIKE ? OR u.email LIKE ? OR u.NO_hp LIKE ?'; $args = ["%$q%", "%$q%", "%$q%"]; }
    $st = $pdo->prepare("SELECT u.id_user, u.Nama, u.email, u.NO_hp, u.is_admin, u.Status_akun, u.created_at,
                                (SELECT COUNT(*) FROM orders o WHERE o.id_user = u.id_user) AS jumlah_pesanan,
                                (SELECT COUNT(*) FROM providers p WHERE p.id_user = u.id_user) AS is_mitra
                         FROM users u $where ORDER BY u.created_at DESC LIMIT 100");
    $st->execute($args);
    ok(['rows' => $st->fetchAll()]);

case 'user_set':
    $id = (int)($in['id_user'] ?? 0);
    $status = clean($in['status'] ?? '');
    if (!in_array($status, ['aktif', 'ditangguhkan'], true)) fail('Status tidak valid.');
    if ($id === $aid) fail('Anda tidak bisa menangguhkan akun sendiri.');
    $st = $pdo->prepare('SELECT is_admin FROM users WHERE id_user = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) fail('Pengguna tidak ditemukan.', 404);
    if ((int)$row['is_admin'] === 1) fail('Akun admin tidak bisa ditangguhkan dari sini.');
    $note = note_of($in, 0, 200);
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE users SET Status_akun = ? WHERE id_user = ?')->execute([$status, $id]);
    if ($status === 'ditangguhkan') $pdo->prepare('UPDATE providers SET is_online = 0 WHERE id_user = ?')->execute([$id]);
    admin_log($pdo, $aid, 'akun_' . $status, 'user#' . $id, $note);
    $pdo->commit();
    ok();

case 'log':
    ok(['rows' => $pdo->query("SELECT l.id_log, l.Aksi, l.Target, l.Detail, l.created_at, u.Nama AS admin_nama FROM admin_log l LEFT JOIN users u ON u.id_user = l.id_admin ORDER BY l.id_log DESC LIMIT 100")->fetchAll()]);

default:
    fail('Aksi tidak dikenal.');
}
