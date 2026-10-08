# Feature map: herdr PWA

One file for each user-facing feature. Each file says how a phone user gets to it, how to drive it
with `scripts/cdp.ts` and `scripts/agent.sh`, and what end state proves it.

| Feature                                | File                               | Status (2026-10-08)                                 |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Agent list with live status            | [agent-list.md](agent-list.md)     | Proved.                                             |
| Pairing and home-network trust         | [pairing.md](pairing.md)           | Proved (token path needs `TRUST_LAN=0`).            |
| Connection pill and Herdr-down banner  | [connection.md](connection.md)     | Proved.                                             |
| Agent screen: transcript, prompt, keys | [agent-screen.md](agent-screen.md) | Proved, except prompt and keys (need a real agent). |

When you add a feature to the app, add a file here with the four sections: `Sub-features`,
`How to get to it (user POV)`, `Driving it with cdp.ts`, `Gotchas`.
