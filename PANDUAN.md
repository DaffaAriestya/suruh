# Panduan Pasang UNESA Suruh di InfinityFree

## 1. Siapkan database (phpMyAdmin)
1. Buka phpMyAdmin dari panel InfinityFree, pilih database kamu.
2. **Belum pernah import?** Tab **Import** → pilih `schema.sql` (versi 2) → Go.
   **Sudah import versi 1?** Jangan import ulang. Jalankan `migrasi_v2.sql`, `migrasi_v3.sql`, lalu `migrasi_v4.sql`.
   **Sudah import versi 2?** Jalankan `migrasi_v3.sql` lalu `migrasi_v4.sql`.
   **Sudah import versi 3?** Jalankan `migrasi_v4.sql` lalu `migrasi_v5.sql`.
   **Sudah import versi 4?** Jalankan `migrasi_v5.sql` saja.
   Cara menjalankan migrasi: phpMyAdmin → pilih database → tab **SQL** → tempel isi file → Go. Masing-masing **sekali saja**; data lama aman.
   - Kalau kamu sudah punya tabel lama dengan nama sama (users, orders, dst.) dan strukturnya beda, perintah ini akan melewatinya.
     Hapus tabel lama dulu (tab Operations → Drop), atau jalankan langkah 4 dan kirim hasilnya agar kode disesuaikan.
3. Jangan upload `schema.sql` ke hosting.

## 2. Isi `config.php`
| Isi | Dari mana |
|---|---|
| `DB_HOST` | "MySQL Host Name" di panel (mis. `sql123.infinityfree.com`), **bukan** `localhost` |
| `DB_NAME`, `DB_USER` | "MySQL DB Name" dan "MySQL User Name" |
| `DB_PASS` | password akun hosting (vPanel) |
| `DB_CHECK_KEY` | kata acak panjang buatanmu sendiri |

Saat uji coba dengan email biasa (Gmail), ubah `REQUIRE_UNESA_EMAIL` menjadi `false`.

## 3. Upload
Upload semua file **kecuali `schema.sql`** ke folder `htdocs/` (File Manager atau FTP):
`index.html, index.js, style.css, config.php` dan semua file `.php` (termasuk `photo.php`, `upload_photo.php`, `update_progress.php`, `update_location.php`, `confirm_received.php`, `set_online.php`, `pesan_ambil.php`, `pesan_kirim.php`, `upload_video.php`, `video.php`).
File `complete_task.php` dari versi 1 sudah tidak dipakai; hapus jika masih ada di hosting.

## 4. Cek koneksi
Buka `https://domainmu/db_check.php?key=ISI_DB_CHECK_KEY`.
Harus muncul `"koneksi": "OK"` dan `tabel_belum_ada` kosong. **Setelah itu hapus `db_check.php`.**

## 5. Fitur baru v2
- **Peta & Google Maps**: pemesan memilih titik jemput/tujuan di peta (OpenStreetMap, tanpa API key) atau menempel link Google Maps. Mitra membuka titik, navigasi, dan rute lewat Google Maps dari tombol di "Detail".
- **Pelacakan tugas**: setelah dibayar, Mitra menandai tahapan yang menyesuaikan jenis suruhan (beli: *Barang sudah dibeli*; antar jemput orang: *Penumpang sudah naik*; dst.). Pemesan melihat lini masa + foto bukti. Tahap terakhir otomatis menyelesaikan tugas.
- **Posisi Mitra langsung**: Mitra menekan "Bagikan lokasi" di tab Tugas. Posisi muncul di peta pemesan dan diperbarui tiap ±25 detik, **hanya selama halaman Mitra tetap terbuka** (batas web biasa, bukan aplikasi). Butuh HTTPS dan izin lokasi.
- **Foto langsung**: dipilih dari kamera/galeri, dikecilkan di browser, disimpan di tabel `photos` (database), dan hanya bisa dibuka pihak yang berkepentingan lewat `photo.php`. Tidak ada URL publik.
- Permintaan Custom tidak lagi memiliki tarif dasar. Kategori baru: Antar Jemput Orang.

## 6. Aturan baru v3
- **Setelah login/daftar**, tombol Masuk/Daftar di header, Beranda, dan footer otomatis hilang.
- **Tanpa tarif minimum per kategori.** Pemesan menulis sendiri tarif yang ditawarkan (batas teknis terendah Rp 1.000, diatur `MIN_PRICE` di `config.php`).
- **Area "Di Luar Area Kampus"** tersedia untuk titik jemput dan tujuan. Pembagian ke Mitra: suruhan tampil bila salah satu titiknya di kampus Mitra **atau** berada dalam **radius** (1-20 km, atur di tab Profil) dari pusat kampus Mitra. Link Google Maps tanpa koordinat di luar kampus tetap tampil agar tidak terlewat.
- **Jenis lokasi menyesuaikan permintaan**: kategori "Bantuan Tugas / Bersih-Bersih" memakai satu lokasi pengerjaan. Pada "Permintaan Custom", pemesan memilih sendiri (jemput + antar atau satu lokasi). Tahapan pelacakan ikut menyesuaikan.
- **Mitra ON/OFF**: default OFF. Saat OFF, bursa disembunyikan dan Mitra tidak bisa menawar. Status tidak bisa dimatikan selama ada tugas berjalan.
- **Satu tugas dalam satu waktu**: Mitra yang sedang mengerjakan tugas tidak bisa menawar atau ditugaskan pesanan lain.
- **Pelacakan wajib**: dimulai otomatis begitu ada tugas berjalan, tanpa tombol mematikan. Server menolak pembaruan tahap bila posisi Mitra tidak masuk dalam 3 menit terakhir.
- **Kode serah terima**: setelah bayar, pemesan melihat kode 6 digit. Tahap terakhir hanya bisa diselesaikan Mitra dengan kode itu (5 kali salah = terkunci 10 menit), atau pemesan menekan "Konfirmasi Sudah Diterima" sendiri.
- **Chat dalam website** (teks, foto, video, balasan cepat, pesan status otomatis). Terbuka sejak tugas berjalan sampai 24 jam setelah selesai (`CHAT_GRACE_HOURS`), sesudah itu hanya bisa dibaca. Nomor HP tidak lagi ditampilkan; WhatsApp tidak dipakai.
- **Foto**: semua unggahan punya tombol **Kamera** (langsung jepret) dan **Galeri**. Chat juga mendukung video dari kamera atau galeri.
- Video disimpan sebagai file di folder `uploads_private/` (dibuat otomatis, diblokir dari akses langsung, ditonton lewat `video.php`). Batas 10 MB (`VIDEO_MAX_BYTES`); jika hosting menolak, turunkan atau minta pengguna merekam lebih singkat.

## 7. Panel admin & aturan batal (v4)
**Jadikan dirimu admin**: daftar akun biasa di website, lalu di phpMyAdmin (tab SQL) jalankan
`UPDATE users SET is_admin = 1 WHERE email = 'emailmu@mhs.unesa.ac.id';`
Setelah login, tombol **Admin** muncul di header. Atau buka langsung `https://domainmu/admin.html`.
File baru yang harus diupload: `admin.html`, `admin_api.php`, `mundur_tugas.php`, `set_ktm.php` (plus `index.html`, `index.js`, dan file PHP yang berubah).

Isi panel: ringkasan angka, verifikasi Mitra (lihat foto KTM), penanganan laporan kendala, penarikan saldo, pantauan pesanan (tugas macet bisa dibatalkan atau diselesaikan paksa), penangguhan akun, dan riwayat tindakan admin.

Aturan baru:
- **Pesanan hangus otomatis** bila tidak ada tawaran yang dibayar dalam `ORDER_EXPIRE_HOURS` (6 jam). Tanpa cron: dijalankan saat ada yang membuka situs.
- **Pemesan** bisa membatalkan pesanan berbayar dengan refund (simulasi) selama Mitra belum mulai (tahap 0). Setelah itu harus lewat Pusat Kendala.
- **Mitra** bisa mundur hanya sebelum tugas dimulai (tahap 0). Jumlah mundur tercatat dan terlihat admin.
- **Laporan kendala** ditangani admin dengan 4 keputusan: tolak, tanggapan saja, batalkan + kembalikan pembayaran, atau selesaikan paksa. Keputusan dan catatan terlihat oleh pelapor, dan masuk ke chat pesanan.
- **Tugas macet**: tugas berjalan tanpa kemajuan lebih dari `STALE_TASK_HOURS` (3 jam) ditandai MACET di panel admin.
- **Verifikasi KTM**: Mitra mengunggah foto KTM di tab Profil. Jika `AUTO_VERIFY_PROVIDER = false`, Mitra baru menunggu persetujuan admin; admin bisa menolak dengan alasan, lalu Mitra mengirim ulang.
- **Akun ditangguhkan** langsung keluar dan tidak bisa masuk lagi.
- Semua pengembalian dana dan pembayaran masih **simulasi** (hanya mengubah status di database).

## 8. Keamanan & kepercayaan (v5)
Jalankan `migrasi_v5.sql` sekali, lalu upload file baru `sos.php` dan `submit_review_pemesan.php` (plus `index.html`, `index.js`, `admin.html`, dan PHP yang berubah: `create_order.php`, `sync_all.php`, `admin_api.php`, `db_check.php`).
- **Persetujuan aturan**: pemesan wajib mencentang daftar barang dan permintaan terlarang sebelum memesan (dicek juga di server dan tercatat di kolom `Setuju_aturan`).
- **Tombol SOS** di detail tugas yang sedang berjalan, untuk pemesan maupun Mitra (lebih menonjol pada Antar Jemput Orang). Mengirim laporan prioritas ke admin beserta posisi GPS bila ada. Di panel admin muncul badge DARURAT, tautan "Lihat posisi", dan hitungan "SOS terbuka". Satu SOS per 2 menit per pesanan.
- **Penilaian dua arah**: setelah tugas selesai, Mitra bisa menilai pemesan. Rating pemesan terlihat di bursa suruhan, tab Tugas, dan detail pesanan.
- **Pesan Lagi**: pada pesanan Selesai atau Dibatalkan, satu ketukan menyalin data pesanan ke formulir (foto tidak ikut disalin).
- **Judul tab** menampilkan jumlah pesan dan tawaran belum dibaca, mis. `(3) UNESA Suruh`, dan ada bunyi singkat saat ada kabar baru dari pihak lain.

## 9. Uji alur lengkap (pakai 2 browser / 1 browser + jendela incognito)
1. Browser A: daftar sebagai **Pemesan** → Buat Pesanan.
2. Browser B: daftar sebagai **Mitra** (centang "Daftar sekaligus sebagai Mitra") → Bursa Suruhan → Ajukan Tawaran.
3. Browser A: muncul notifikasi tawaran baru (maks. ±20 detik) → Terima & Bayar.
4. Browser B: tombol WhatsApp pemesan terbuka → Tandai Tugas Selesai → saldo bertambah.
5. Browser A: Beri Ulasan → rating Mitra ikut berubah.

## Catatan penting
- **Pembayaran hanya dicatat di database.** Belum ada payment gateway (Midtrans/Xendit); itu butuh akun merchant dan bukan hosting gratis.
- Penarikan saldo juga hanya tercatat (status "Diproses"); pencairan nyata dilakukan manual olehmu/admin.
- `AUTO_VERIFY_PROVIDER = true` membuat semua mitra langsung "Terverifikasi". Karena belum ada halaman admin/upload KTM, ubah ke `false` hanya jika kamu siap memverifikasi lewat phpMyAdmin (kolom `Status_verifikasi` → `Terverifikasi`).
- Jika upload foto gagal dengan pesan paket terlalu besar, hosting membatasi `max_allowed_packet`. Turunkan `PHOTO_MAX_STORED` di `config.php` (mis. 800 * 1024).
- Peta memakai server gratis OpenStreetMap/Nominatim (cocok untuk trafik kecil). Titik awal peta tiap kampus adalah perkiraan; pengguna tinggal menggeser pin.
- Data refresh otomatis tiap 20 detik dan hanya saat tab terbuka, untuk menghemat batas hit hosting gratis.
- Akun lama dengan password teks biasa (mis. `secret123`) tidak bisa login; daftar ulang agar password tersimpan ter-hash.
- Kalau muncul "respons tidak valid", biasanya file `.php` belum terupload, `config.php` belum benar, atau halaman tantangan keamanan InfinityFree sedang tampil: buka situsmu sekali di browser lalu muat ulang.

## Jika muncul "Tidak dapat terhubung ke server" / "Koneksi terputus sesaat"
Pesan ini berarti permintaan dari browser putus di tengah jalan (bukan error PHP). Penyebab umum di hosting gratis: server sibuk atau batas koneksi tercapai. Yang sudah ditangani di kode: aksi chat, lokasi, dan ON/OFF mencoba ulang otomatis 3 kali; polling chat melambat sendiri saat server sibuk; endpoint baca-saja melepas kunci sesi supaya permintaan paralel tidak saling antre; pesan ganda ditolak server.

Jika masih terjadi terus, cek satu per satu (buka di browser, ganti `domainmu`):
1. `https://domainmu/pesan_kirim.php` → harus tampil JSON `"Metode tidak diizinkan."`. Kalau tampil halaman "403 Forbidden" dari InfinityFree, buka File Manager → klik kanan file → Permissions → set **644** (folder **755**). Kalau 404/kosong, file belum terupload atau ada error PHP.
2. `https://domainmu/db_check.php?key=KUNCIMU` → `tabel_belum_ada` harus kosong (tabel `chat_messages`, `chat_reads`, `videos` ada). Kalau tidak, jalankan `migrasi_v3.sql`.
3. Pastikan situs dibuka lewat `https://` (bukan `http://`), karena pengalihan http ke https dapat memutus permintaan POST.

**Catatan 403 dari InfinityFree**: jika di DevTools > Network sebuah file `.php` dijawab `302` lalu `errors.infinityfree.net/errors/403`, itu hosting yang menolak (bukan error kodenya). Penyebab umum: izin file salah, atau filter keamanan hosting. File chat sudah diganti namanya menjadi `pesan_ambil.php` dan `pesan_kirim.php` (POST, tanpa query string). **Hapus `chat_fetch.php` dan `chat_send.php` lama dari hosting.**
