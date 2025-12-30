# Deployment Guide

## Prerequisites
- Docker
- Docker Compose

## Steps to Run locally or on server
1. Navigate to the `platform` directory:
   ```bash
   cd platform
   ```

2. Build and start the containers:
   ```bash
   docker compose up --build -d
   ```

3. Access the application:
   - Frontend: `http://localhost` (or your server IP)
   - Backend API: `http://localhost/api` (proxied via Nginx)

## Notes
- The database is persisted in `./server/db/platform.db`.
- Environment variables are loaded from `./server/.env`.
- To stop the application: `docker compose down`.
