# ---------- build stage ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# The local upload driver writes here (UPLOAD_LOCAL_DIR, default "uploads").
# /app is root-owned, so without this the non-root user below cannot create it
# and every upload fails with EACCES. Production should use UPLOAD_DRIVER=s3 —
# a container's disk does not survive a redeploy — but this keeps uploads
# working, rather than 500ing, until it does.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Run as non-root
USER node
EXPOSE 3000

# Container-level readiness: probes the Terminus /health endpoint (Mongo ping +
# heap). Uses Node's http so it needs no extra tools in the image. Orchestrators
# (compose/k8s) and load balancers can gate traffic on this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
