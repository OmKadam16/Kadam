# Installing Kadam

Kadam is currently distributed as a Node.js CLI. It requires **Node.js 22.18 or
newer** and npm.

## From a checkout

```bash
bash install.sh
kadam --version
```

The installer:

1. checks the Node.js version;
2. installs the build dependencies in the checkout;
3. builds the compiler and CLI;
4. installs the global `kadam` command;
5. verifies the installed binary.

It never invokes `sudo`. If the default global prefix is not writable, install
into a user-owned prefix:

```bash
KADAM_PREFIX="$HOME/.local" bash install.sh
```

If that directory is not already on `PATH`, add it:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Direct npm installation

From the package directory:

```bash
npm install --global .
kadam --version
```

## Installing a published package

The package is currently marked private while the release name and registry
are decided. The installer accepts a published npm package or tarball through
`KADAM_PACKAGE`:

```bash
KADAM_PACKAGE="@your-scope/kadam@latest" bash install.sh
```

A public one-line `curl` command is intentionally not documented yet. It needs
a published package, a stable installer URL, and release checksums. The
installer itself is ready for that wrapper.

## Development without installing

```bash
npm install
npm run check
node dist/cli/main.js --version
```

The CLI exposes `build`, `check`, `dev`, and `parse`; run `kadam --help` for the
full command reference.
