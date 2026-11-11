<?php
require __DIR__ . '/config.php';
$in   = require_post();
$user = require_login();          // id pemesan SELALU diambil dari sesi, bukan dari browser
$pdo  = db();

$judul  = clean($in['judul'] ?? '');
$desk   = clean($in['deskripsi'] ?? '');
$catId  = (int)($in['id_category'] ?? 0);
$harga  = (int)($in['harga'] ?? 0);
$mode   = clean($in['mode_lokasi'] ?? 'rute');
$aAwal  = clean($in['area_awal'] ?? '');
$lAwal  = clean($in['lokasi_awal'] ?? '');
$aTuj   = clean($in['area_tujuan'] ?? '');
$lTuj   = clean($in['lokasi_tujuan'] ?? '');
$urlAw  = clean($in['peta_awal_url'] ?? '');
$urlTj  = clean($in['peta_tujuan_url'] ?? '');
$setuju = !empty($in['setuju']);
$photos = array_values(array_unique(array_map('intval', is_array($in['photo_ids'] ?? null) ? $in['photo_ids'] : [])));

if (len($judul) < 3 || len($judul) > 150) fail('Judul pesanan harus 3-150 karakter.');
if (len($desk) < 3 || len($desk) > 1000)  fail('Deskripsi harus 3-1000 karakter.');
if ($harga < MIN_PRICE || $harga > MAX_PRICE) fail('Tarif harus antara Rp ' . number_format(MIN_PRICE, 0, ',', '.') . ' dan Rp ' . number_format(MAX_PRICE, 0, ',', '.') . '.');
if (!$setuju) fail('Anda harus menyetujui aturan barang dan permintaan terlarang.');
if (count($photos) > PHOTO_MAX_PER_ORDER) fail('Maksimal ' . PHOTO_MAX_PER_ORDER . ' foto per pesanan.');

$st = $pdo->prepare('SELECT alur, mode_lokasi FROM categories WHERE id_category = ?');
$st->execute([$catId]);
$cat = $st->fetch();
if (!$cat) fail('Kategori tidak ditemukan.');
// Kategori biasa: jenis lokasi ditentukan kategori. Kategori custom: pemesan boleh memilih.
if ($cat['alur'] === 'custom') {
    if (!in_array($mode, ['rute', 'satu'], true)) fail('Jenis lokasi tidak valid.');
} else {
    $mode = $cat['mode_lokasi'];
}
$custom = ($cat['alur'] === 'custom') ? 1 : 0;

[$latA, $lngA] = geo_pair($in['lat_awal'] ?? null, $in['lng_awal'] ?? null);
if (!in_array($aAwal, LOC_AREAS, true)) fail('Area lokasi tidak valid.');
if ($lAwal === '' || len($lAwal) > 150) fail('Detail tempat wajib diisi (maks. 150 karakter).');
if ($urlAw !== '' && !valid_gmaps_url($urlAw)) fail('Link Google Maps tidak valid.');
if ($latA === null && $urlAw === '') fail('Tentukan titik di peta atau tempel link Google Maps.');

if ($mode === 'satu') {
    // Satu lokasi pengerjaan: titik tujuan = titik awal
    $aTuj = $aAwal; $lTuj = $lAwal; $latT = $latA; $lngT = $lngA; $urlTj = $urlAw;
} else {
    [$latT, $lngT] = geo_pair($in['lat_tujuan'] ?? null, $in['lng_tujuan'] ?? null);
    if (!in_array($aTuj, LOC_AREAS, true)) fail('Area tujuan tidak valid.');
    if ($lTuj === '' || len($lTuj) > 150) fail('Detail tempat tujuan wajib diisi (maks. 150 karakter).');
    if ($urlTj !== '' && !valid_gmaps_url($urlTj)) fail('Link Google Maps tujuan tidak valid.');
    if ($latT === null && $urlTj === '') fail('Tentukan titik tujuan di peta atau tempel link Google Maps.');
}

$st = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE id_user = ? AND status_order = 'Menunggu Tawaran'");
$st->execute([(int)$user['id_user']]);
if ((int)$st->fetchColumn() >= MAX_OPEN_ORDERS) fail('Anda sudah punya ' . MAX_OPEN_ORDERS . ' pesanan yang menunggu tawaran. Selesaikan atau batalkan dulu.');

$sql = 'INSERT INTO orders (id_Orders, id_user, id_category, Judul, Deskripsi_Permintaan,
            Area_awal, Lokasi_awal, Lat_awal, Lng_awal, Peta_awal_url,
            Area_tujuan, Lokasi_tujuan, Lat_tujuan, Lng_tujuan, Peta_tujuan_url,
            Harga_diajukan, is_custom, Mode_lokasi, Setuju_aturan)
        VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)';
$id = null;
$pdo->beginTransaction();
for ($i = 0; $i < 5 && !$id; $i++) {
    $try = gen_id('ORD');
    try {
        $pdo->prepare($sql)->execute([$try, (int)$user['id_user'], $catId, $judul, $desk,
            $aAwal, $lAwal, $latA, $lngA, $urlAw ?: null,
            $aTuj, $lTuj, $latT, $lngT, $urlTj ?: null,
            $harga, $custom, $mode, 1]);
        $id = $try;
    } catch (PDOException $e) {
        if ($e->getCode() !== '23000') { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    }
}
if (!$id) fail_tx($pdo, 'Gagal membuat ID pesanan. Coba lagi.', 500);
if ($photos) attach_photos($pdo, $photos, (int)$user['id_user'], $id);
$pdo->commit();
ok(['id_Orders' => $id]);
