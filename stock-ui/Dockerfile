FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Non-root nginx serving the static build on port 8080
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080
