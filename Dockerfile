# Comunicado Semanal SENAR-RS. Imagem de producao: Node 22 + Chromium do Debian (exportacao PDF/PNG).
# Build (a partir da raiz do repositorio):  docker build -t boletim-senar:1.1 .
# Nenhum segredo entra na imagem: tudo vem de variaveis de ambiente (--env-file) em tempo de execucao.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji fonts-noto-core fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts/create-admin.js scripts/smoke-export.js ./scripts/

# HOST=0.0.0.0 e intencional DENTRO do contêiner: o isolamento vem de publicar a porta so em
# 127.0.0.1 no host (-p 127.0.0.1:3100:3000). Nunca publique sem o 127.0.0.1.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 CHROMIUM_PATH=/usr/bin/chromium

USER node
EXPOSE 3000

# /saude responde na raiz mesmo com BASE_PATH definido (e tambem sob o prefixo).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node","src/server.js"]
