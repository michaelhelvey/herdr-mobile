<div align="center">

<img src="docs/logo.png" alt="A chinchilla with a phone and a herd of small chinchilla agents" width="240" />

# herdr for your phone

**Herd your coding agents from the couch.**

Read what each agent in [Herdr](https://herdr.dev) does, send prompts and images, answer questions,
and stop runaway agents, from your iPhone or Android phone.

![iPhone](https://img.shields.io/badge/iPhone-Safari-000?logo=apple&logoColor=white)
![Android](https://img.shields.io/badge/Android-Chrome-3ddc84?logo=android&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-no_app_store-5a0fc8?logo=pwa&logoColor=white)
![Bun](https://img.shields.io/badge/runs_on-Bun-f9f1e1?logo=bun&logoColor=black)

</div>

---

This is a web app (a PWA), not a native app. You do not need the App Store or Google Play. You add
it to your home screen from the browser, and it opens full screen like a real app.

```
phone (this app) ──wifi or tailscale──▶ bridge (on your computer) ──▶ herdr ──▶ your agents
```

Herdr runs on your computer. The **bridge** in this repo also runs on your computer. It serves the
app to your phone and connects the app to Herdr. Your phone only opens a web page.

## 1. Install Herdr and Bun on your computer

Do these steps on the Mac or Linux computer where your agents run.

1. Install Herdr:

   ```sh
   curl -fsSL https://herdr.dev/install.sh | sh
   ```

   For other install methods (Homebrew, Nix, Windows), see https://herdr.dev/docs/install/.

2. Install [Bun](https://bun.sh):

   ```sh
   curl -fsSL https://bun.sh/install | bash
   ```

3. Open a new terminal, then make sure that both work:

   ```sh
   herdr --version
   bun --version
   ```

## 2. Start Herdr and some agents

1. Go to a project and start Herdr:

   ```sh
   cd ~/code/my-project
   herdr
   ```

2. In a Herdr pane, start an agent, for example `claude` or `opencode`. Herdr finds the agent
   automatically.
3. You can detach with `ctrl+b q`. Herdr and the agents continue to run in the background. Run
   `herdr` again to attach.

Claude Code and opencode get the best view in the app. Other agents show as terminal text.

## 3. Start the bridge

In a different terminal (not in Herdr), get this repo and start the bridge:

```sh
git clone <this repo's URL> herdr-mobile
cd herdr-mobile
bun install
bun run build
bun run start
```

The bridge prints an address such as `http://192.168.1.20:5173/` and a QR code.

- Keep this terminal open. When the bridge stops, the app on the phone stops working.
- If macOS asks "Do you want the application to accept incoming network connections?", click
  **Allow**.
- If the computer goes to sleep, the phone cannot connect. On a Mac, you can use
  `caffeinate -i bun run start` to keep the computer awake while the bridge runs.

## 4. Open the app on your phone

Connect the phone to the **same Wi-Fi network** as the computer. Then point the phone camera at the
QR code in the terminal and tap the link. You can also type the address into the browser.

On your home network, you do not need a password or a pairing step.

## 5. Install the app on your home screen

When you install the app, it gets an icon and opens full screen, like a real app.

### iPhone or iPad (Safari)

1. Open the address in **Safari**.
2. Tap the **Share** button (a square with an arrow that points up). If you do not see it, tap
   **•••** at the bottom first, then tap **Share**.
3. Scroll down and tap **Add to Home Screen**.
4. Make sure that **Open as Web App** is on, if you see it.
5. Tap **Add**.

The **herdr** icon is now on your home screen. Always open the app from this icon.

### Android (Chrome)

1. Open the address in **Chrome**.
2. Tap the **⋮** menu at the top right.
3. Tap **Add to home screen**, then tap **Install** (or **Add**).

On a plain `http://` address, Chrome can make a shortcut that opens in a browser tab, not a full
screen app. To get a full screen app, use an `https://` address. See the Tailscale steps below.

## Use the app away from home (optional)

The easiest way is [Tailscale](https://tailscale.com). It is free for personal use.

1. Install Tailscale on the computer and on the phone. Log in to the same account on both.
2. On the phone, turn Tailscale on.

Now you have two choices:

- **Simple:** open `http://<computer's Tailscale IP>:5173/` on the phone. Find the IP with
  `tailscale ip -4` on the computer. You do not need a pairing step.
- **HTTPS (better on Android):** on the computer, run `tailscale serve --bg 5173`. It prints an
  address such as `https://my-mac.tail1234.ts.net`. Then start the bridge with that address:

  ```sh
  HERDR_BRIDGE_PUBLIC_URL=https://my-mac.tail1234.ts.net bun run start
  ```

  The bridge prints a second QR code, "Away from home". Scan it **one time** to pair the phone. Then
  install the app on your home screen from that page (see step 5).

A different tunnel (for example Cloudflare Tunnel or ngrok) also works in the same way: set
`HERDR_BRIDGE_PUBLIC_URL` to the address of the tunnel and scan the pairing QR code.

## Problems

| Problem                                  | What to do                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The page does not load on the phone.     | Make sure that the phone and the computer are on the same Wi-Fi, the bridge runs, and the computer is not asleep.         |
| The app says "not paired".               | You used a tunnel. Scan the "Away from home" QR code again. The token is in `~/.config/herdr-bridge/token`.               |
| The app shows no agents.                 | Make sure that Herdr runs (`herdr status`) and that it has agents in its panes.                                           |
| The bridge cannot find the Herdr socket. | Start `herdr` first. If you use a different socket, set `HERDR_SOCKET_PATH`. The default is `~/.config/herdr/herdr.sock`. |

## Settings

Set these environment variables before `bun run start`:

| Variable                  | Default                      | What it does                                                    |
| ------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `PORT`                    | `5173`                       | The port of the bridge.                                         |
| `HOST`                    | `0.0.0.0`                    | The address that the bridge listens on.                         |
| `HERDR_SOCKET_PATH`       | `~/.config/herdr/herdr.sock` | The Herdr socket.                                               |
| `HERDR_BRIDGE_PUBLIC_URL` | (none)                       | The `https://` address of your tunnel. Shows a pairing QR code. |
| `HERDR_BRIDGE_TOKEN`      | (a saved random token)       | Use this pairing token instead of the saved one.                |
| `HERDR_BRIDGE_TRUST_LAN`  | `1`                          | Set to `0` to ask for the token also on the home network.       |

## Development

```sh
bun install
bun run dev        # bridge + app at http://localhost:5173, reloads when you change a file
bun run build      # compile the bridge and the app into one binary: dist/herdr-bridge
bun run start      # run dist/herdr-bridge
bun run validate   # format, lint, type check, and test
```

To show a new agent kind well, add an adapter in `src/client/agents/` (see `types.ts`). See
`docs/protocol.md` for the Herdr socket API.
