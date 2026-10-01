<div align="center">
  <a href="https://www.npmjs.com/package/@devlsh/iframe" target="_blank">
    <img src="https://img.shields.io/npm/v/@devlsh/iframe?style=flat-square" alt="NPM" />
  </a>
  <a href="https://discord.gg/3S6AKZ2GR9" target="_blank">
    <img src="https://img.shields.io/discord/1000565079789535324?color=7289DA&label=discord&logo=discord&logoColor=FFFFFF&style=flat-square" alt="Discord" />
  </a>
  <img src="https://img.shields.io/npm/l/@devlsh/iframe?style=flat-square" alt="GPL-3.0-only" />
  <h3>iFrame IPC for React</h3>
</div>

`@devlsh/iframe` provides a React hook which can be used to communicate between an iFrame and its parent via postMessage IPC.

- `sync`/`async` messaging/responses
- Configurable timeouts
- Bi-directional communication Cross-origin support
- Same usage/API for both Host & Client
- Support for enforcing origins for increased security-
- No limit to number of instances you can use/create at any given time-
- TypeScript
- React peer dependency: `^18.2.0`

## Installation

Requires React `^18.2.0` in the consuming application:

```bash
pnpm add @devlsh/iframe

# or

yarn add @devlsh/iframe

# or

npm install @devlsh/iframe
```

## Usage

TODO:

## Package verification

Run `pnpm dlx --package=pnpm@8.15.9 pnpm test:package`. Open the local URL printed by the script in a real browser. The script installs a
fresh local tarball in a temporary consumer, checks native CJS/ESM imports and declarations, then runs the mounted React IPC protocol. It
exits after the browser reports its results. Any failed contract exits nonzero; results remain in the printed temporary directory.
