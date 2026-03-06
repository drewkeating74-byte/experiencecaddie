# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --include=dev

COPY apps/api/ ./
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

ENV PORT=4000
EXPOSE 4000

CMD ["node", "dist/index.js"]
