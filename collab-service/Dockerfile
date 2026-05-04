FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV PORT=1234

EXPOSE 1234
CMD ["node", "src/server.js"]
