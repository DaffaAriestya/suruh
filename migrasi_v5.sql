-- =====================================================================
-- MIGRASI v4 -> v5 (SOS, persetujuan aturan, penilaian pemesan).
-- Jalankan SEKALI SAJA di phpMyAdmin (tab SQL), setelah migrasi_v4.sql.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE orders  ADD COLUMN Setuju_aturan TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE reports
  ADD COLUMN Darurat TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN Lat     DECIMAL(9,6) NULL,
  ADD COLUMN Lng     DECIMAL(9,6) NULL;

ALTER TABLE users
  ADD COLUMN Rating_pemesan DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN Total_dinilai  INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reviews_pemesan (
  id_review    INT AUTO_INCREMENT PRIMARY KEY,
  id_Orders    VARCHAR(24) NOT NULL UNIQUE,
  id_provider  INT NOT NULL,
  id_user      INT NOT NULL,          -- pemesan yang dinilai
  Rating       TINYINT NOT NULL,
  Komentar     VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_revp_user (id_user),
  CONSTRAINT fk_revp_ord FOREIGN KEY (id_Orders) REFERENCES orders(id_Orders)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
