
# tox-app

Full-stack TypeScript recreation of [tox.gr](https://tox.gr/).

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



Notes
All API endpoints are under /api/*.

Data is stored in memory; restart resets everything.

Uses node-fetch@2 (CommonJS) so it runs on any Node version.

---

## Run it

```bash
cd tox-app
npm install
npm run build
npm start
```



Open http://localhost:3000.

Changes from the previous version
reputationLog type: Map<string, number> → Map<string, string>

Added import fetch from 'node-fetch'; at top of src/server.ts

node-fetch pinned to ^2.7.0 (CommonJS-compatible) + @types/node-fetch added

build:server now includes --lib es2020 and build:client includes --lib es2020,dom
