# My Little Apps

A lightweight macOS menu bar application for managing your personal development apps. Built with Tauri v2, React, and TypeScript.

## Overview

**My Little Apps** solves a common problem for developers who build small personal projects: managing multiple local development servers without manually starting them each time or worrying about port conflicts.

Instead of running `cd project && bun start` for each app every time you boot your machine, My Little Apps handles it all from your menu bar.

## Features

### Core Functionality

- **System Tray Integration** - Lives in your macOS menu bar, always accessible
- **One-Click Launch** - Click any app in the tray menu to open it in your browser
- **Process Management** - Start, stop, and monitor your development servers
- **Automatic Port Allocation** - Randomly assigns free ports (10000-60000) to avoid conflicts
- **Custom Port Support** - Override with a specific port if needed
- **Run on Startup** - Mark apps to auto-start when the manager launches
- **Start Manager on Login** - Option to launch the manager automatically on macOS login

### App Management

- **Add via Folder Picker** - Select any project folder to add it
- **Auto-Detect App Name** - Reads `name` from `package.json` automatically
- **Configurable Command** - Default is `bun start`, but supports any command (`npm run dev`, `yarn start`, etc.)
- **Edit Settings** - Change name, command, port, and startup behavior anytime
- **Remove Apps** - Clean removal with automatic process termination

### Developer Experience

- **Live Logs** - View stdout/stderr output in real-time
- **Auto-Scroll** - Logs automatically scroll to the latest output
- **Status Indicators** - Visual indicators show which apps are running
- **Port Display** - See assigned ports at a glance

## Screenshots

The app has two main interfaces:

1. **Tray Menu** - Quick access to all your apps with their status
2. **Settings Window** - Full management UI with logs and configuration

## Installation

### Prerequisites

- macOS 10.15 or later
- [Rust](https://www.rust-lang.org/tools/install) (for building)
- [Bun](https://bun.sh/) (runtime and package manager)

### Build from Source

```bash
# Clone or navigate to the project
cd my-little-apps

# Install dependencies
bun install

# Build the app (debug)
bun run tauri build --debug

# Or build for release
bun run tauri build
```

### Install the App

After building, you can find the app at:

- **App Bundle**: `src-tauri/target/release/bundle/macos/My Little Apps.app`
- **DMG Installer**: `src-tauri/target/release/bundle/dmg/My Little Apps_0.1.0_aarch64.dmg`

Drag the app to your Applications folder or run it directly.

## Usage

### Getting Started

1. **Launch the app** - It will appear in your menu bar
2. **Open Settings** - Click the tray icon and select "Settings..."
3. **Add your first app** - Click "+ Add App" and select a project folder
4. **Start the app** - Click "Start" next to your app in the list
5. **Open in browser** - Click "Open" or click the app name in the tray menu

### Managing Apps

#### Adding an App

1. Click "+ Add App" in the Settings window
2. Select the folder containing your project
3. The app name is auto-detected from `package.json` (or uses the folder name)
4. Default command is `bun start` - edit if needed

#### Configuring an App

Click "Edit" on any app to configure:

| Setting | Description |
|---------|-------------|
| **Name** | Display name in the menu and UI |
| **Command** | The command to run (e.g., `bun start`, `npm run dev`) |
| **Port** | Leave empty for auto-assignment, or specify a fixed port |
| **Run on startup** | Automatically start this app when the manager launches |

#### Starting/Stopping Apps

- **From Settings**: Use the Start/Stop buttons in the app list
- **From Tray**: Apps marked as running can be opened; use Settings to stop them

### Auto-Start Behavior

There are two levels of auto-start:

1. **Manager on Login** - Toggle "Start manager on login" in the header to launch My Little Apps when you log into macOS
2. **Apps on Manager Start** - Toggle "Run on startup" per app to start specific apps when the manager launches

Combined, this means your selected apps start automatically when you turn on your Mac.

## Architecture

### Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | [Tauri v2](https://tauri.app/) |
| Backend | Rust |
| Frontend | React 19 + TypeScript |
| Bundler | Vite |
| Runtime | Bun |
| Database | SQLite |
| Styling | CSS (custom) |

### Project Structure

```
my-little-apps/
├── src/                          # React frontend
│   ├── App.tsx                   # Main application component
│   ├── App.css                   # Styles
│   └── main.tsx                  # Entry point
├── src-tauri/                    # Tauri/Rust backend
│   ├── src/
│   │   ├── lib.rs                # Main Rust code (commands, tray, state)
│   │   └── main.rs               # Entry point
│   ├── capabilities/
│   │   └── default.json          # Permission configuration
│   ├── icons/                    # App icons
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── package.json                  # Node dependencies
└── vite.config.ts                # Vite configuration
```

### Data Storage

App data is stored in a SQLite database at:
```
~/Library/Application Support/com.artsiomshaitar.my-little-apps/my-little-apps.db
```

#### Database Schema

```sql
CREATE TABLE apps (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL DEFAULT 'bun start',
    port INTEGER,
    run_on_startup INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Tauri Plugins Used

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-shell` | Spawn and manage child processes |
| `tauri-plugin-sql` | SQLite database access |
| `tauri-plugin-dialog` | Native folder picker dialog |
| `tauri-plugin-autostart` | Register app to start on login |
| `tauri-plugin-opener` | Open URLs in default browser |

## Development

### Running in Dev Mode

```bash
bun run tauri dev
```

This starts both the Vite dev server and the Tauri app with hot reload.

### Building

```bash
# Debug build (faster, larger)
bun run tauri build --debug

# Release build (optimized, smaller)
bun run tauri build
```

### Environment Variables

Apps are started with the `PORT` environment variable set to the assigned port. Most frameworks (Vite, Next.js, etc.) respect this automatically.

## Troubleshooting

### App won't start

1. Check if the command is correct (try running it manually in terminal)
2. Check the logs in the Settings window for error messages
3. Ensure the project path still exists

### Port conflicts

- If you specify a custom port that's in use, the app will fail to start
- Use "Auto" (leave port empty) to let the manager find a free port

### Manager doesn't start on login

1. Open Settings
2. Ensure "Start manager on login" is checked
3. Check System Preferences > Login Items for "My Little Apps"

### App fails with Node/native module version error

If the app uses native Node modules (e.g. `better-sqlite3`), the Node version used when the manager starts the app must match the one used to build those modules. The manager runs each app in a login + interactive shell so it should get the same Node (e.g. from nvm/fnm) as your terminal. If the error persists, run `npm rebuild` or `bun install` in the app directory using the same Node version that the manager will use.

### Database issues

To reset all data, delete the database file:
```bash
rm ~/Library/Application\ Support/com.artsiomshaitar.my-little-apps/my-little-apps.db
```

## Roadmap / Future Ideas

- [ ] App grouping/categories
- [ ] Health checks (auto-restart on crash)
- [ ] Environment variable management per app
- [ ] Import/export app configurations
- [ ] Clean URLs with reverse proxy (e.g., `my-app.localhost`)
- [ ] Notifications on app start/stop/crash
- [ ] Global keyboard shortcuts

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

Built with Tauri, React, and TypeScript.
