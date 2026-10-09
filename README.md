# tox-app

Full-stack TypeScript recreation of [tox.gr](https://tox.gr/).

An Express + TypeScript backend with an in-memory store, serving a vanilla
TypeScript single-page client. No database, no bundler — the server compiles
`src/client.ts` straight into `public/client.js` and serves it alongside
`index.html` and `style.css`.

## Setup

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000.

Development

```bash
npm run dev
```

Compile the client separately:

```bash
npm run build:client
```

## Project layout

```
tox-clone/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── src/
│   ├── server.ts        Express app + REST API + in-memory store
│   └── client.ts        SPA logic (auth, tabs, feed, chat, theme)
└── public/
    ├── index.html       App shell + auth modal
    └── style.css        Token-based theming (light / dark)
```

## Scripts

| Script               | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `npm run build`      | `build:server` + `build:client`                                         |
| `npm run build:server` | `tsc src/server.ts` → `dist/server.js` (CommonJS, `--lib es2020`)     |
| `npm run build:client` | `tsc src/client.ts` → `public/client.js` (ES2020 module, `--lib es2020,dom`) |
| `npm start`          | Runs `node dist/server.js`                                              |
| `npm run dev`        | Runs the server directly with `ts-node`                                 |

## Notes

- All API endpoints are under `/api/*`.
- Data is stored in memory; **restarting the server resets everything**.
- Uses `node-fetch@2` (CommonJS) so it runs on any Node version.
- Auth is JWT (`Authorization: Bearer <token>`), 7-day expiry, passwords
  hashed with `bcryptjs`.

## API reference

### Auth

| Method | Path                  | Body                       | Returns              |
| ------ | --------------------- | -------------------------- | -------------------- |
| POST   | `/api/auth/register`  | `{ username, password }`   | `{ token, username }`|
| POST   | `/api/auth/login`     | `{ username, password }`   | `{ token, username }`|

### Users

| Method | Path                            | Auth | Notes                                 |
| ------ | ------------------------------- | ---- | ------------------------------------- |
| GET    | `/api/users/me`                 | yes  | `{ user: { username, reputation } }`  |
| DELETE | `/api/users/me`                 | yes  | Deletes the account                   |
| GET    | `/api/users/:username/profile`  | yes  | Includes that user's posts            |
| POST   | `/api/users/:username/block`    | yes  | Appends to the caller's `blocked[]`   |

### Reputation

| Method | Path                              | Auth | Notes                             |
| ------ | --------------------------------- | ---- | --------------------------------- |
| POST   | `/api/reputation/gift/:username`  | yes  | One gift per pair per calendar day |

### Friends

| Method | Path                   | Auth | Notes                          |
| ------ | ---------------------- | ---- | ------------------------------ |
| GET    | `/api/friends`         | yes  | Accepted friends only          |
| POST   | `/api/friends/request` | yes  | `{ username }`                 |
| DELETE | `/api/friends/:id`     | yes  | Removes the request            |

### Posts / Feed

| Method | Path          | Auth | Query / Body              |
| ------ | ------------- | ---- | ------------------------- |
| GET    | `/api/posts`  | no   | `?limit=20&offset=0`      |
| POST   | `/api/posts`  | yes  | `{ content, media?, gif? }` |

### AI sessions & chat

| Method | Path                       | Auth | Body / Notes                     |
| ------ | -------------------------- | ---- | -------------------------------- |
| GET    | `/api/sessions`            | yes  | Lists the caller's sessions      |
| DELETE | `/api/sessions/:id`        | yes  | Removes a session                |
| GET    | `/api/history/:sessionId`  | yes  | Full message history             |
| POST   | `/api/chat`                | yes  | `{ message, sessionId? }`        |

`POST /api/chat` creates a session on first call and returns
`{ reply, sessionId }`. The current reply is a canned echo (`Η Ήρα λέει: …`).

### Threads

| Method | Path            | Auth | Query / Body                       |
| ------ | --------------- | ---- | ---------------------------------- |
| GET    | `/api/threads`  | no   | `?category=`                       |
| POST   | `/api/threads`  | yes  | `{ category, title, content }`     |

### GIPHY proxy

| Method | Path                  | Auth | Notes                          |
| ------ | --------------------- | ---- | ------------------------------ |
| GET    | `/api/gifs/search`    | no   | `?q=` (defaults to `trending`) |

## Client

- Theme is applied before paint (inline `<script>` in `index.html`) from
  `localStorage.theme`; the sidebar toggle flips between light and dark.
- Auth state lives in `localStorage.tox_token` / `localStorage.tox_user`.
- Tabs are driven by `body[data-tab]`; the search row and category chips
  are only visible on the **Threads** tab.
- Mobile (≤768px) hides the sidebar and shows a fixed bottom nav.

## Run it

```bash
cd tox-app
npm install
npm run build
npm start
```

Open http://localhost:3000.
