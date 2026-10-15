FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY 設定 ./設定
RUN mkdir /app/data && chown node:node /app/data
USER node
CMD ["node", "src/index.js"]

