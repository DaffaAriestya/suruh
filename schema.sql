-- =====================================================================
-- UNESA SURUH - skema database v5 (MySQL / MariaDB, phpMyAdmin)
-- BELUM pernah import  -> import file ini.
-- SUDAH import versi 1 -> jalankan migrasi_v2.sql lalu migrasi_v3.sql (jangan import ini).
-- SUDAH import versi 2 -> jalankan migrasi_v3.sql lalu migrasi_v4.sql.
-- SUDAH import versi 3 -> jalankan migrasi_v4.sql lalu migrasi_v5.sql.
-- SUDAH import versi 4 -> jalankan migrasi_v5.sql saja.
-- JANGAN upload file .sql ke hosting.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id_user        INT AUTO_INCREMENT PRIMARY KEY,
  Nama           VARCHAR(100) NOT NULL,
  email          VARCHAR(120) NOT NULL UNIQUE,
  Password_hash  VARCHAR(255) NOT NULL,
  Gender         ENUM('L','P') NOT NULL DEFAULT 'L',
  Foto_profil    VARCHAR(255) NULL,
  NO_hp          VARCHAR(20)  NOT NULL,
  is_admin       TINYINT(1) NOT NULL DEFAULT 0,       -- jadikan admin lewat phpMyAdmin (lihat PANDUAN)
  Status_akun    VARCHAR(12) NOT NULL DEFAULT 'aktif', -- 'aktif' | 'ditangguhkan'
  Rating_pemesan DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  Total_dinilai  INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS providers (
  id_provider         INT AUTO_INCREMENT PRIMARY KEY,
  id_user             INT NOT NULL UNIQUE,
  NIM                 VARCHAR(20) NOT NULL UNIQUE,
  Fakultas            VARCHAR(60) NOT NULL,
  Area_kerja          VARCHAR(30) NOT NULL DEFAULT 'Ketintang',
  foto_KTM            VARCHAR(255) NULL,
  Status_verifikasi   VARCHAR(30) NOT NULL DEFAULT 'Menunggu Verifikasi',
  is_online           TINYINT(1) NOT NULL DEFAULT 0,   -- Mitra mulai dalam keadaan OFF
  Radius_km           TINYINT NOT NULL DEFAULT 5,
  Rating              DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  Total_order_selesai INT NOT NULL DEFAULT 0,
  Total_mundur        INT NOT NULL DEFAULT 0,
  id_photo_ktm        INT NULL,
  Catatan_verifikasi  VARCHAR(255) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prov_user FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=101 DEFAULT CHARSET=utf8mb4;

-- tarif_dasar NULL = tarif sesuai negosiasi (tidak ditampilkan). alur = jenis tahapan pelacakan.
CREATE TABLE IF NOT EXISTS categories (
  id_category    INT PRIMARY KEY,
  nama_kategori  VARCHAR(80) NOT NULL,
  tarif_dasar    INT NULL,                          -- tidak dipakai/ditampilkan (tanpa tarif minimum)
  ikon           VARCHAR(50) NOT NULL,
  alur           VARCHAR(10) NOT NULL DEFAULT 'custom',
  mode_lokasi    VARCHAR(5)  NOT NULL DEFAULT 'rute'  -- 'rute' = jemput + antar, 'satu' = satu lokasi pengerjaan
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO categories (id_category, nama_kategori, tarif_dasar, ikon, alur, mode_lokasi) VALUES
 (1, 'Titip Makanan / Kantin',        NULL, 'fa-utensils',            'beli',   'rute'),
 (2, 'Print & Jilid Skripsi',         NULL, 'fa-print',               'print',  'rute'),
 (3, 'Ambil Paket Kos / Lobby',       NULL, 'fa-box-open',            'ambil',  'rute'),
 (4, 'Antar Dokumen / Berkas',        NULL, 'fa-file-signature',      'antar',  'rute'),
 (5, 'Beli Alat Tulis / Fotokopi',    NULL, 'fa-pen-ruler',           'beli',   'rute'),
 (6, 'Permintaan Custom',             NULL, 'fa-wand-magic-sparkles', 'custom', 'rute'),
 (7, 'Antar Jemput Orang',            NULL, 'fa-motorcycle',          'orang',  'rute'),
 (8, 'Bantuan Tugas / Bersih-Bersih', NULL, 'fa-broom',               'kerja',  'satu');

CREATE TABLE IF NOT EXISTS orders (
  id_Orders            VARCHAR(24) PRIMARY KEY,
  id_user              INT NOT NULL,
  id_category          INT NOT NULL,
  id_provider          INT NULL,
  Judul                VARCHAR(150) NOT NULL,
  Deskripsi_Permintaan TEXT NOT NULL,
  Area_awal            VARCHAR(30) NOT NULL,
  Lokasi_awal          VARCHAR(150) NOT NULL,
  Lat_awal             DECIMAL(9,6) NULL,
  Lng_awal             DECIMAL(9,6) NULL,
  Peta_awal_url        VARCHAR(500) NULL,
  Area_tujuan          VARCHAR(30) NOT NULL,
  Lokasi_tujuan        VARCHAR(150) NOT NULL,
  Lat_tujuan           DECIMAL(9,6) NULL,
  Lng_tujuan           DECIMAL(9,6) NULL,
  Peta_tujuan_url      VARCHAR(500) NULL,
  Harga_diajukan       INT NOT NULL,
  Harga_final          INT NULL,
  is_custom            TINYINT(1) NOT NULL DEFAULT 0,
  Mode_lokasi          VARCHAR(5) NOT NULL DEFAULT 'rute',
  kode_selesai         CHAR(6) NULL,            -- kode serah terima (dilihat pemesan, dimasukkan Mitra)
  kode_gagal           TINYINT NOT NULL DEFAULT 0,
  kode_lock_until      DATETIME NULL,
  status_order         ENUM('Menunggu Tawaran','Diproses','Selesai','Dibatalkan') NOT NULL DEFAULT 'Menunggu Tawaran',
  progress             TINYINT NOT NULL DEFAULT 0,
  mitra_lat            DECIMAL(9,6) NULL,
  mitra_lng            DECIMAL(9,6) NULL,
  mitra_loc_at         DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at          DATETIME NULL,
  completed_at         DATETIME NULL,
  Alasan_batal         VARCHAR(160) NULL,
  Dibatalkan_oleh      VARCHAR(10) NULL,
  Setuju_aturan        TINYINT(1) NOT NULL DEFAULT 0,
  refunded             TINYINT(1) NOT NULL DEFAULT 0,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_user (id_user),
  INDEX idx_orders_provider (id_provider),
  INDEX idx_orders_status (status_order, created_at),
  CONSTRAINT fk_ord_user FOREIGN KEY (id_user)     REFERENCES users(id_user),
  CONSTRAINT fk_ord_cat  FOREIGN KEY (id_category) REFERENCES categories(id_category),
  CONSTRAINT fk_ord_prov FOREIGN KEY (id_provider) REFERENCES providers(id_provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Foto disimpan langsung di database. id_Orders NULL = baru diunggah, belum dipasang ke pesanan.
CREATE TABLE IF NOT EXISTS photos (
  id_photo    INT AUTO_INCREMENT PRIMARY KEY,
  id_user     INT NOT NULL,
  id_Orders   VARCHAR(24) NULL,
  kind        ENUM('lampiran','progres','laporan','chat','ktm') NOT NULL DEFAULT 'lampiran',
  Mime        VARCHAR(30) NOT NULL,
  Ukuran      INT NOT NULL,
  Data        MEDIUMBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_photo_order (id_Orders),
  INDEX idx_photo_user (id_user, id_Orders),
  CONSTRAINT fk_photo_user  FOREIGN KEY (id_user)   REFERENCES users(id_user) ON DELETE CASCADE,
  CONSTRAINT fk_photo_order FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_tracking (
  id_track    INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders   VARCHAR(24) NOT NULL,
  step        TINYINT NOT NULL,
  label       VARCHAR(80) NOT NULL,
  catatan     VARCHAR(255) NULL,
  id_photo    INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_track_order (id_Orders, step),
  CONSTRAINT fk_track_order FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS offers (
  id_offer       INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders      VARCHAR(24) NOT NULL,
  id_provider    INT NOT NULL,
  Harga_tawaran  INT NOT NULL,
  Pesan          VARCHAR(255) NOT NULL,
  status_offer   ENUM('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_offer (id_Orders, id_provider),
  CONSTRAINT fk_off_ord  FOREIGN KEY (id_Orders)   REFERENCES orders(id_Orders) ON DELETE CASCADE,
  CONSTRAINT fk_off_prov FOREIGN KEY (id_provider) REFERENCES providers(id_provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id_Payment     VARCHAR(24) PRIMARY KEY,
  id_Orders      VARCHAR(24) NOT NULL UNIQUE,
  id_offer       INT NOT NULL,
  id_user        INT NOT NULL,
  Metode         VARCHAR(40) NOT NULL,
  Jumlah         INT NOT NULL,
  Biaya_platform INT NOT NULL,
  Total_bayar    INT NOT NULL,
  Status         VARCHAR(20) NOT NULL DEFAULT 'Lunas',
  paid_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_ord  FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders),
  CONSTRAINT fk_pay_user FOREIGN KEY (id_user)   REFERENCES users(id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reports (
  id_report   INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders   VARCHAR(24) NOT NULL,
  id_user     INT NOT NULL,
  Alasan      TEXT NOT NULL,
  Bukti       VARCHAR(255) NULL,
  id_photo    INT NULL,
  Status      VARCHAR(30) NOT NULL DEFAULT 'Menunggu Review',
  Darurat     TINYINT(1) NOT NULL DEFAULT 0,   -- 1 = SOS
  Lat         DECIMAL(9,6) NULL,
  Lng         DECIMAL(9,6) NULL,
  Keputusan   VARCHAR(20) NULL,
  Catatan_admin VARCHAR(500) NULL,
  Ditangani_pada DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rep_user (id_user),
  CONSTRAINT fk_rep_ord  FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders),
  CONSTRAINT fk_rep_user FOREIGN KEY (id_user)   REFERENCES users(id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews (
  id_review    INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders    VARCHAR(24) NOT NULL UNIQUE,
  id_user      INT NOT NULL,
  id_provider  INT NOT NULL,
  Rating       TINYINT NOT NULL,
  Komentar     VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rev_prov (id_provider),
  CONSTRAINT fk_rev_ord  FOREIGN KEY (id_Orders)   REFERENCES orders(id_Orders),
  CONSTRAINT fk_rev_user FOREIGN KEY (id_user)     REFERENCES users(id_user),
  CONSTRAINT fk_rev_prov FOREIGN KEY (id_provider) REFERENCES providers(id_provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS withdrawals (
  id_withdraw  INT AUTO_INCREMENT PRIMARY KEY,
  id_provider  INT NOT NULL,
  Jumlah       INT NOT NULL,
  Metode       VARCHAR(20) NOT NULL,
  Tujuan       VARCHAR(30) NOT NULL,
  Status       VARCHAR(20) NOT NULL DEFAULT 'Diproses',
  Catatan_admin VARCHAR(255) NULL,
  Diproses_pada DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wd_prov (id_provider),
  CONSTRAINT fk_wd_prov FOREIGN KEY (id_provider) REFERENCES providers(id_provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Chat dalam website (teks, foto, video, pesan sistem). id_user 0 = sistem.
CREATE TABLE IF NOT EXISTS videos (
  id_video    INT AUTO_INCREMENT PRIMARY KEY,
  id_user     INT NOT NULL,
  id_Orders   VARCHAR(24) NULL,
  Mime        VARCHAR(30) NOT NULL,
  Ukuran      INT NOT NULL,
  Path        VARCHAR(80) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vid_order (id_Orders),
  INDEX idx_vid_user (id_user, id_Orders)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id_msg      BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_Orders   VARCHAR(24) NOT NULL,
  id_user     INT NOT NULL,
  Tipe        ENUM('teks','foto','video','sistem') NOT NULL DEFAULT 'teks',
  Isi         VARCHAR(1000) NULL,
  id_photo    INT NULL,
  id_video    INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_order (id_Orders, id_msg),
  CONSTRAINT fk_chat_order FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_reads (
  id_Orders   VARCHAR(24) NOT NULL,
  id_user     INT NOT NULL,
  last_read   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id_Orders, id_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews_pemesan (
  id_review    INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders    VARCHAR(24) NOT NULL UNIQUE,
  id_provider  INT NOT NULL,
  id_user      INT NOT NULL,
  Rating       TINYINT NOT NULL,
  Komentar     VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_revp_user (id_user),
  CONSTRAINT fk_revp_ord FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_log (
  id_log      INT AUTO_INCREMENT PRIMARY KEY,
  id_admin    INT NOT NULL,
  Aksi        VARCHAR(40) NOT NULL,
  Target      VARCHAR(60) NOT NULL,
  Detail      VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
