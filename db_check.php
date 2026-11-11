<?php
/**
 * Alat diagnosa koneksi & struktur database.
 * Buka: https://domain-anda/db_check.php?key=ISI_DB_CHECK_KEY
 * HAPUS FILE INI dari hosting setelah selesai.
 */
require __DIR__ . '/config.php';
if (!hash_equals(DB_CHECK_KEY, (string)($_GET['key'] ?? ''))) { http_response_code(403); echo json_encode(['error' => 'Kunci salah.']); exit; }

try {
    $pdo = db();
    $expected = ['users','providers','categories','orders','offers','payments','reports','reviews','withdrawals','order_tracking','photos','videos','chat_messages','chat_reads','admin_log'];
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    $out = ['koneksi' => 'OK', 'database' => DB_NAME, 'tabel_ada' => $tables, 'tabel_belum_ada' => array_values(array_diff($expected, $tables)), 'struktur' => []];
    foreach ($tables as $t) {
        $cols = $pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '', $t) . '`')->fetchAll();
        $out['struktur'][$t] = array_map(fn($c) => $c['Field'] . ' ' . $c['Type'], $cols);
    }
    // Cek kolom yang dibutuhkan tiap versi, lalu sarankan migrasi yang perlu dijalankan
    $need = [
        'v2' => ['orders' => ['progress', 'Lat_awal', 'mitra_lat'], 'categories' => ['alur']],
        'v3' => ['categories' => ['mode_lokasi'], 'orders' => ['Mode_lokasi', 'kode_selesai'], 'providers' => ['Radius_km']],
        'v5' => ['orders' => ['Setuju_aturan'], 'reports' => ['Darurat', 'Lat'], 'users' => ['Rating_pemesan', 'Total_dinilai']],
        'v4' => ['users' => ['is_admin', 'Status_akun'], 'providers' => ['id_photo_ktm', 'Total_mundur', 'Catatan_verifikasi'],
                 'orders' => ['refunded', 'updated_at', 'Alasan_batal'], 'reports' => ['Catatan_admin'], 'withdrawals' => ['Catatan_admin']],
    ];
    $missing = []; $ver = [];
    foreach ($need as $v => $map) foreach ($map as $t => $cols) {
        $have = array_map(fn($c) => explode(' ', $c)[0], $out['struktur'][$t] ?? []);
        foreach ($cols as $c) if (!in_array($c, $have, true)) { $missing[] = "$t.$c"; $ver[$v] = true; }
    }
    $out['kolom_belum_ada'] = $missing;
    $out['saran'] = $ver ? 'Jalankan di phpMyAdmin (urut): ' . implode(', ', array_map(fn($v) => "migrasi_$v.sql", array_keys($ver))) . '. Jalankan masing-masing sekali saja.' : 'Struktur database sudah lengkap.';
} catch (Throwable $e) {
    $out = ['koneksi' => 'GAGAL', 'pesan' => $e->getMessage()];
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
