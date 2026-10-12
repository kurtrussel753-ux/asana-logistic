FROM node:22-alpine
ENV NODE_ENV=production RT_DATA=/data RT_PORT=8090
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
RUN addgroup -S rt && adduser -S rt -G rt && mkdir -p /data && chown rt:rt /data
USER rt
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8090/healthz >/dev/null || exit 1
CMD ["node","src/index.js"]
