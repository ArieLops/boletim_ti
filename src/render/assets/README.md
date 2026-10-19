# Assets de renderização

- `inter-latin-{400,500,600,700,800}-normal.woff2`: fonte **Inter** (subconjunto latino), licença **SIL Open Font License 1.1**
  (https://openfontlicense.org), copiada do pacote `@fontsource/inter` (v5.3.x). O pacote foi removido das dependências porque
  os arquivos são lidos daqui em tempo de execução (`src/render/styles.js`, embutidos em base64). Para atualizar, instale o
  pacote temporariamente, copie os `.woff2` de `files/` e remova-o de novo.
- `logo-padrao.png`: logo "conecta TI" (PNG com fundo transparente e letras brancas, feito para o cabeçalho verde-escuro); é o padrão do comunicado, substituível nas Configurações.
