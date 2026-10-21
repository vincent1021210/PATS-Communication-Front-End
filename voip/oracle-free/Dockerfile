FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV PORT=3001
ENV CORS_ORIGIN=https://vincent1021210.github.io
EXPOSE 3001
CMD ["node", "server.js"]
