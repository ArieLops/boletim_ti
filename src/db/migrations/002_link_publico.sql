-- Link público (parte 1): coluna edicoes.token_publico + índice único.
--
-- Esta migração precisa ser re-executável (DDL faz commit implícito; ver migrate.js) e portável
-- entre MariaDB 10.5+ e MySQL 8. O MySQL 8 não tem "ADD COLUMN IF NOT EXISTS" nem
-- "CREATE INDEX IF NOT EXISTS", então cada alteração é condicionada por consulta ao
-- information_schema (esquema atual = DATABASE()): o ALTER TABLE é montado numa variável de
-- usuário (ou vira um SELECT inócuo quando o objeto já existe) e executado com PREPARE/EXECUTE.
-- O token (base64url) distingue maiúsculas de minúsculas, por isso a coluna é ascii_bin: com a collation
-- padrão da tabela (case-insensitive), tokens que diferem só na caixa colidiriam no índice único e a busca
-- "token_publico = ?" aceitaria um token com a caixa errada. Um terceiro passo corrige bancos que já
-- aplicaram a versão anterior desta migração (coluna existente com outra collation), sem tocar no índice.
-- Cada comando termina com ";" no fim da linha e nenhum literal contém ";" seguido de quebra de linha
-- (o divisor de comandos de migrate.js não entende literais).

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edicoes' AND COLUMN_NAME = 'token_publico'),
  'SELECT 1',
  'ALTER TABLE edicoes ADD COLUMN token_publico VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER versao'
));
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edicoes' AND INDEX_NAME = 'uq_edicoes_token_publico'),
  'SELECT 1',
  'ALTER TABLE edicoes ADD UNIQUE INDEX uq_edicoes_token_publico (token_publico)'
));
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edicoes' AND COLUMN_NAME = 'token_publico' AND (COLLATION_NAME IS NULL OR COLLATION_NAME <> 'ascii_bin')),
  'ALTER TABLE edicoes MODIFY COLUMN token_publico VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL',
  'SELECT 1'
));
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
