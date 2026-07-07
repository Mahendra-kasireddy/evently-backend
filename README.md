# Evently Backend

NestJS modular monolith — REST API, BullMQ workers, Socket.IO chat, and email/SMS/push notifications in a single deployable app.

## Stack

| Concern     | Tech                                    |
| ----------- | --------------------------------------- |
| Framework   | NestJS 10                               |
| Database    | MongoDB (Mongoose)                      |
| Cache/Queue | Redis 7 + BullMQ                        |
| Auth        | JWT (access 1h / refresh 7d)            |
| Real-time   | Socket.IO (`/ws`, `/yjs` namespaces)    |
| Email       | Nodemailer                              |
| SMS         | Twilio                                  |
| Push        | Firebase                                |

## Prerequisites

- Node.js 22+
- A running Redis 7 instance (required — BullMQ depends on it)
- MongoDB (Atlas or local)

## Setup

```bash
npm install
cp .env .env.local   # or edit .env directly; fill in real secrets
```

Set strong JWT secrets before running:

```bash
# generate one per secret
openssl rand -hex 32
```

## Run

```bash
npm run start:dev     # watch mode
npm run build         # compile to dist/
npm run start:prod    # run compiled build
```

App boots at `http://localhost:3000/api`, health check at `http://localhost:3000/health`.

## Docker

```bash
docker compose up --build
```

Brings up the API, Redis, and a local MongoDB. To use Atlas instead, keep your
`MONGO_URI` in `.env` and comment out the `mongo` service + the `MONGO_URI`
override in `docker-compose.yml`.

## Structure

```
src/
  main.ts                 # bootstrap: helmet, CORS, validation, Socket.IO, shutdown hooks
  app.module.ts           # root module: config, Mongo, BullMQ, throttler, health
  config/                 # typed configuration + Joi env validation
  database/               # Mongoose connection module
  health/                 # /health (terminus: mongo + memory)
  common/                 # filters, guards, utils, dto, validation, pricing, delivery, templates
  modules/                # auth, user, plan-event, chat, notification  (stubs — implement here)
  queues/                 # BullMQ processors: order, payment, refund, notification
```

> Feature modules under `src/modules/` are scaffolded but empty. Implement each,
> then register it in `app.module.ts`'s `imports` array.
