# DYE Web

`DYE_Web` is a Decent DE1app plugin that serves a local, phone-friendly web interface for the DYE/SDB shot history.

It uses the same SDB and DYE APIs that the tablet UI uses:

- Lists previous shots from `V_shot`
- Loads graph series from `.shot` files, falling back to SDB series when available
- Exposes DYE description metadata from the shared `metadata` dictionary
- Writes shot edits through `::plugins::SDB::modify_shot_file`
- Updates the SDB description row with `::plugins::SDB::update_shot_description`
- Edits DYE's Next Shot plan when DYE is loaded

## Install

Copy or symlink this folder into your DE1 app plugins folder as:

```text
de1plus/plugins/DYE_Web
```

Then enable `SDB`, `DYE`, and `DYE_Web` from `Settings > App > Extensions`.

By default the plugin listens on:

```text
http://<tablet-ip>:8787/
```

The settings page lets you change the port, restart the server, and optionally require an API token.

## Notes

- Your phone must be on the same Wi-Fi network as the tablet.
- DYE Web edits saved historical shots by modifying the original `.shot` file, then updating SDB when description persistence is enabled.
- The static web UI has a preview-data fallback, so it can be opened outside DE1app during development.
