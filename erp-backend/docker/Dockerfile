### Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

### Production stage
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# Fonts used by the PDF printing module (Amiri, SIL OFL - see assets/fonts/OFL.txt)
COPY --from=builder /app/assets ./assets

EXPOSE 3000

CMD ["node", "dist/main"]
