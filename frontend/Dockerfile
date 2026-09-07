# ---- deps: shared node_modules install ----
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps && npm cache clean --force

# ---- dev: Vite dev server, used by docker-compose.dev.yml ----
FROM deps AS dev

# Chromium for Playwright screenshots (used to verify UI changes actually
# render - see `run` skill usage). Alpine is musl, so Playwright's own
# bundled Chromium download won't execute here; apk's build is musl-native.
# Point Playwright at it with executablePath rather than downloading browsers.
RUN apk add --no-cache chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]

# ---- build: compiles the static bundle, not shipped itself ----
FROM deps AS build

COPY . .
RUN npm run build

# ---- prod: nginx serving the static bundle, used by docker-compose.prod.yml ----
FROM nginx:alpine AS prod

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
