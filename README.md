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

If you use `adb` over USB, copy only the plugin files like this:

```sh
adb shell mkdir -p /sdcard/de1plus/plugins/DYE_Web
adb push plugin.tcl DYE_Web.tcl README.md web /sdcard/de1plus/plugins/DYE_Web/
```

If you are copying on the tablet with a file manager, create:

```text
/sdcard/de1plus/plugins/DYE_Web
```

and place `plugin.tcl`, `DYE_Web.tcl`, `README.md`, and the `web` folder inside it.

By default the plugin listens on:

```text
http://<tablet-ip>:8787/
```

This build does not expose a DE1app settings page. The server starts with the default port above.

## Notes

- Your phone must be on the same Wi-Fi network as the tablet.
- DYE Web edits saved historical shots by modifying the original `.shot` file, then updating SDB when description persistence is enabled.
- The static web UI has a preview-data fallback, so it can be opened outside DE1app during development.
