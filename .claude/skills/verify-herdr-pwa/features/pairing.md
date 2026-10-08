# Pairing and home-network trust

The bridge accepts a `/ws` client only after a `hello` message (`src/server/main.ts`). There are two
ways in:

- **Trusted network** (`src/server/trust.ts`). A direct request from a private address (127.x, 10.x,
  172.16-31.x, 192.168.x, Tailscale 100.64/10, IPv6 ULA or link-local) with no proxy header
  (`forwarded`, `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`) needs no token.
  `HERDR_BRIDGE_TRUST_LAN=0` turns this off.
- **Token** (`src/server/auth.ts`). The PWA reads the token from `#token=...`, saves it in
  `localStorage` (`herdr-bridge-token`), and sends it (`src/client/connection.ts`). This is the path
  for a phone that comes through a tunnel.

Without trust and without a good token, the PWA shows the pair screen (`PairScreen` in
`src/app.tsx`).

## Sub-features

- Trusted: a fresh phone on the home network opens `/` and gets `Live` with no pair screen.
- Bridge log: a QR code and the LAN URL. With trust, the URL has no token
  (`On your home network (no pairing needed):`). Without trust, it has `#token=`. With
  `HERDR_BRIDGE_PUBLIC_URL`, also a QR code for `<public url>/#token=<token>` (`Away from home`).
- Pair screen (`.pair`, heading `Pair this phone`, `.pair-steps`). The token input is in a closed
  `details.pair-manual` (`Have a token?`): `input[aria-label="Pairing token"]` and
  `.pair-form button` `Pair`.
- The token stays in `localStorage`, so a reload of `/` without the hash stays paired.
- A wrong or absent token: the bridge closes `/ws` with code `4001` ("not paired"), also after 5 s
  with no `hello`. The PWA stays on the pair screen.
- Navigation keeps the hash (`src/client/router.ts`).

## How to get to it (user POV)

On the home network: open the LAN URL (or scan its QR code). Away from home: scan the
`Away from home` QR code, or open the bare URL and paste the token. Later, open the home-screen icon
(no hash).

## Driving it with cdp.ts

Trusted path, on a normal run (`up.sh demo`):

```sh
S=.claude/skills/verify-herdr-pwa/scripts
$S/cdp.ts demo open "/"                              # no token
$S/cdp.ts demo wait ".pill" "Live"
```

Token path. Start a separate run that does not trust 127.0.0.1:

```sh
TRUST_LAN=0 $S/up.sh pair
$S/cdp.ts pair open "/"
$S/cdp.ts pair wait ".pair" "Pair this phone" 8000
$S/cdp.ts pair shot 01-pair-screen
$S/cdp.ts pair click ".pair-manual summary"
$S/cdp.ts pair click 'input[aria-label="Pairing token"]'
$S/cdp.ts pair type "wrong-token"
$S/cdp.ts pair click ".pair-form button" "Pair"
$S/cdp.ts pair wait ".pair" "Pair this phone"        # still unpaired, no .pill
$S/cdp.ts pair eval "!!document.querySelector('.pill')"   # false
$S/cdp.ts pair click ".pair-manual summary"          # the form closes after a refusal
$S/cdp.ts pair click 'input[aria-label="Pairing token"]'
$S/cdp.ts pair type "verify-pair-token"
$S/cdp.ts pair click ".pair-form button" "Pair"
$S/cdp.ts pair wait ".pill" "Live" 8000
$S/cdp.ts pair eval "localStorage.getItem('herdr-bridge-token')"   # "verify-pair-token"
$S/cdp.ts pair open "/"                              # reload, no hash: must stay paired
$S/cdp.ts pair wait ".pill" "Live" 8000
$S/cdp.ts pair shot 02-paired-without-hash
$S/down.sh pair
```

## Gotchas

- On a normal run (`TRUST_LAN=1`), every token is accepted, also a wrong one, because 127.0.0.1 is
  trusted. A wrong-token test there passes falsely. Use `TRUST_LAN=0`.
- After a refused token, the pair screen renders again with `details.pair-manual` closed and the
  input empty. Click `summary` again before you type.
- The Chrome profile keeps `localStorage` for the whole run. To test a first visit, run `down.sh`
  and `up.sh` again (new profile).
- `up.sh` sets `HERDR_BRIDGE_TOKEN=verify-<run>-token`. The real default token is in
  `~/.config/herdr-bridge/token`. Do not read or change that file.
- The input is `type=password`, so `text` does not show the value. Check `localStorage` instead.
