<?php
/** Mitra menilai pemesan setelah tugas selesai. Rating pemesan terlihat oleh Mitra lain saat memilih suruhan. */
require __DIR__ . '/config.php';
$in = require_post();
[$user, $prov] = require_provider();
$pdo = db();

$oid    = clean($in['id_orders'] ?? '');
$rating = (int)($in['rating'] ?? 0);
$kom    = clean($in['komentar'] ?? '');
if ($rating < 1 || $rating > 5) fail('Rating harus 1-5.');
if (len($kom) > 255)            fail('Komentar maksimal 255 karakter.');

$pdo->beginTransaction();
$st = $pdo->prepare('SELECT id_user, id_provider, status_order FROM orders WHERE id_Orders = ? FOR UPDATE');
$st->execute([$oid]);
$o = $st->fetch();
if (!$o || (int)$o['id_provider'] !== (int)$prov['id_provider']) fail_tx($pdo, 'Tugas ini bukan milik Anda.', 403);
if ($o['status_order'] !== 'Selesai') fail_tx($pdo, 'Penilaian hanya bisa diberikan setelah tugas selesai.', 409);

try {
    $pdo->prepare('INSERT INTO reviews_pemesan (id_Orders, id_provider, id_user, Rating, Komentar) VALUES (?,?,?,?,?)')
        ->execute([$oid, (int)$prov['id_provider'], (int)$o['id_user'], $rating, $kom ?: null]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') fail_tx($pdo, 'Anda sudah menilai pemesan ini.', 409);
    throw $e;
}
$pdo->prepare('UPDATE users SET Rating_pemesan = (SELECT ROUND(AVG(Rating), 2) FROM reviews_pemesan WHERE id_user = ?),
               Total_dinilai = (SELECT COUNT(*) FROM reviews_pemesan WHERE id_user = ?) WHERE id_user = ?')
    ->execute([(int)$o['id_user'], (int)$o['id_user'], (int)$o['id_user']]);
$pdo->commit();
ok();
