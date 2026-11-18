# Build Stage
FROM node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Production Stage
FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752

COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
    && rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh \
    && mkdir -p /var/cache/nginx /run \
    && touch /run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d \
    && chown nginx:nginx /run/nginx.pid

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
