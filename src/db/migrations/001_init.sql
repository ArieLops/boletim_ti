CREATE TABLE usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  login VARCHAR(80) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  perfil ENUM('editor','administrador') NOT NULL DEFAULT 'editor',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  trocar_senha TINYINT(1) NOT NULL DEFAULT 1,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE edicoes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero INT NOT NULL,
  mes_ano VARCHAR(40) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  subtitulo VARCHAR(255) NULL,
  status ENUM('rascunho','publicada') NOT NULL DEFAULT 'rascunho',
  versao INT NOT NULL DEFAULT 1,
  criado_por INT UNSIGNED NULL,
  atualizado_por INT UNSIGNED NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_edicoes_numero (numero),
  CONSTRAINT fk_edicoes_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id),
  CONSTRAINT fk_edicoes_atualizado_por FOREIGN KEY (atualizado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE blocos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  edicao_id INT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  dados JSON NOT NULL,
  KEY idx_blocos_edicao (edicao_id, ordem),
  CONSTRAINT fk_blocos_edicao FOREIGN KEY (edicao_id) REFERENCES edicoes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE historico (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  edicao_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NULL,
  acao VARCHAR(60) NOT NULL,
  detalhe JSON NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_historico_edicao (edicao_id, criado_em),
  CONSTRAINT fk_historico_edicao FOREIGN KEY (edicao_id) REFERENCES edicoes (id) ON DELETE CASCADE,
  CONSTRAINT fk_historico_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE arquivos_publicados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  edicao_id INT UNSIGNED NOT NULL,
  tipo ENUM('pdf','png_email','png_whatsapp') NOT NULL,
  conteudo LONGBLOB NOT NULL,
  gerado_por INT UNSIGNED NULL,
  gerado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_arquivos_edicao_tipo (edicao_id, tipo),
  CONSTRAINT fk_arquivos_edicao FOREIGN KEY (edicao_id) REFERENCES edicoes (id) ON DELETE CASCADE,
  CONSTRAINT fk_arquivos_gerado_por FOREIGN KEY (gerado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE configuracoes (
  chave VARCHAR(100) NOT NULL PRIMARY KEY,
  valor TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE logo (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  conteudo LONGBLOB NOT NULL,
  mime VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
