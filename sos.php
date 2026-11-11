<?php
/** Tombol darurat (SOS): pemesan atau Mitra pada tugas yang sedang berjalan mengirim laporan prioritas ke admin (dengan posisi bila ada). */
require __DIR__ . '/config.php';
$in   = require_post();
$user = require_login();
$pdo  = db();
$uid  = (int)$user['id_user'];

$oid   = clean($in['id_orders'] ?? '');
$pesan = clean($in['pesan'] ?? '');
if (len($pesan) > 300) fail('Pesan maksimal 300 karakter.');
[$lat, $lng] = geo_pair($in['lat'] ?? null, $in['lng'] ?? null);

$st = $pdo->prepare('SELECT o.id_user, o.status_order, pr.id_user AS m_user FROM orders o LEFT JOIN providers pr ON pr.id_provider = o.id_provider WHERE o.id_Orders = ?');
$st->execute([$oid]);
$o = $st->fetch();
if (!$o || ((int)$o['id_user'] !== $uid && (int)($o['m_user'] ?? 0) !== $uid)) fail('Pesanan tidak ditemukan.', 404);
if ($o['status_order'] !== 'Diproses') fail('SOS hanya untuk tugas yang sedang berjalan.', 409);

$st = $pdo->prepare('SELECT COUNT(*) FROM reports WHERE id_user = ? AND id_Orders = ? AND Darurat = 1 AND created_at > NOW() - INTERVAL 2 MINUTE');
$st->execute([$uid, $oid]);
if ((int)$st->fetchColumn() > 0) fail('SOS sudah terkirim beberapa saat lalu. Admin sedang menindaklanjuti.', 429);

$alasan = 'DARURAT (SOS) dari ' . $user['Nama'] . ($pesan !== '' ? ': ' . $pesan : '');
$pdo->prepare('INSERT INTO reports (id_Orders, id_user, Alasan, Darurat, Lat, Lng) VALUES (?,?,?,1,?,?)')->execute([$oid, $uid, $alasan, $lat, $lng]);
chat_system($pdo, $oid, 'SOS dikirim ke admin oleh ' . $user['Nama'] . '. Admin akan menindaklanjuti.');
ok();
