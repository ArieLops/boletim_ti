-- Imagem opcional nos blocos: tabela imagens (conteúdo no banco, por edição).
-- Aditiva e re-executável (CREATE TABLE IF NOT EXISTS), portável entre MariaDB 10.5+ e MySQL 8.
CREATE TABLE IF NOT EXISTS imagens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  edicao_id INT UNSIGNED NOT NULL,
  mime VARCHAR(40) NOT NULL,
  conteudo LONGBLOB NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_imagens_edicao (edicao_id),
  CONSTRAINT fk_imagens_edicao FOREIGN KEY (edicao_id) REFERENCES edicoes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
