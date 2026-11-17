FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_WA_CLIENT_RELEASE
ENV VITE_WA_CLIENT_RELEASE=${VITE_WA_CLIENT_RELEASE}
RUN node -e 'if(!/^[0-9a-f]{64}$/.test(process.env.VITE_WA_CLIENT_RELEASE||""))process.exit(1)' \
    && npm run build

FROM nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
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
