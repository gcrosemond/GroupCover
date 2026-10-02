# Group Cover

Group Cover is a Stash plugin that generates a group's front image from the
front images of its child groups.

The plugin adds a camera button to the group page. Clicking it opens a modal
where the composition can be previewed and adjusted before the cover is saved.

## Screenshots

The camera button is available next to the group cover:

![Group page with the Group Cover button](screenshots/01.png)

Clicking the button opens the layout and generation modal:

![Group Cover generation modal](screenshots/02.png)

## Features

- Uses child group front images as the source material.
- Supports portrait, landscape, square, and widescreen output aspects.
- Provides configurable gutters, borders, colors, opacity, and corner styles.
- Shows browser previews before generation and uses the same composition logic
  for the final image.
- Supports these layouts:
  - **Grid**: dynamically generated row and column arrangements based on the
    number of child images, including main- and reverse-diagonal arrangements
    with one, two, or three larger images in regular or compact sizes.
  - **Hero**: choose a child image visually and place it left, right, top,
    bottom, or centered when enough images are available.
  - **Diagonal**: sliced diagonal composition with adjustable direction and
    angle.
  - **Filmstrip**: horizontal strip.
  - **Vertical strip**: vertical stack of images.
  - **Fan**: rotated overlapping cards with adjustable spread and spacing.

## Installation

### Stash plugin source (recommended)

1. Open **Settings > Plugins** in Stash.
2. Under **Available Plugins**, add this package source:

   ```text
   https://gcrosemond.github.io/GroupCover/index.yml
   ```

3. Reload the available plugins if necessary.
4. Install **Group Cover** for the platform running your Stash instance.

Updates published by the source will appear in Stash's plugin manager.

### Release ZIP

1. Download the archive for your platform from the [latest GitHub release](https://github.com/gcrosemond/GroupCover/releases/latest).

   Available archives use this naming scheme:

   ```text
   group-cover-darwin-arm64.zip
   group-cover-darwin-amd64.zip
   group-cover-linux-arm64.zip
   group-cover-linux-amd64.zip
   group-cover-windows-amd64.zip
   group-cover-freebsd-amd64.zip
   ```

2. Create a `group-cover` directory inside your Stash plugins directory.
3. Extract the downloaded archive into that directory. The resulting layout
   should contain:

   ```text
   plugins/
   └── group-cover/
       ├── group-cover
       ├── group-cover.yml
       ├── group-cover.js
       └── group-cover.css
   ```

4. On macOS or Linux, make the executable runnable:

   ```sh
   chmod +x group-cover
   ```

5. In Stash, open **Settings > Plugins** and select **Reload Plugins**.

The default plugin directory is the `plugins` directory beside the Stash
configuration file. Your configured plugin path may be different.

## Building From Source

The backend is written in Go and requires Go 1.25 or newer. From this
directory:

```sh
go mod download
go build -o group-cover .
chmod +x group-cover
```

The backend uses `github.com/disintegration/imaging` for high-quality resizing
and rotation.

The frontend consists of `group-cover.js` and `group-cover.css`, which are
loaded by the plugin manifest.

## Distribution Builds

Build packages for the supported Stash platforms with:

```sh
make package
```

This creates a plugin directory and ZIP archive for each target under `dist/`:

- `darwin-amd64`
- `darwin-arm64`
- `linux-amd64`
- `linux-arm64`
- `windows-amd64`
- `freebsd-amd64`

Each package contains the platform-specific `group-cover` executable and the
manifest, frontend assets, license, and README. The executable is built with
`CGO_ENABLED=0`, so no target-platform C compiler is required.

## Publishing A Package Source

Stash package sources are YAML indexes hosted at a public URL. This repository
includes a GitHub Actions workflow at `.github/workflows/publish-pages.yml`
that publishes one index containing a separate package entry for each platform.

To enable publishing:

1. In GitHub, open **Settings > Pages** for the repository.
2. Set the Pages source to **GitHub Actions**.
3. Push a version tag such as `v0.1.0`.
4. Add this source URL in Stash:

```text
https://gcrosemond.github.io/GroupCover/index.yml
```

The source lists one package per platform. Install the entry matching the host
platform; Stash does not automatically filter entries by operating system. The
package manager verifies the ZIP using the SHA-256 value in the index. The same
site can be generated locally with:

```sh
make site VERSION=0.1.0
```

The generated `site/` directory is ready to publish as a static site.

## Usage

1. Open a group that has child groups with front images.
2. Click the camera button near the group image.
3. Choose how many child images to include; enter `0` to include all images.
4. Select an aspect ratio and gutter settings.
5. Select a layout from the visual layout strip.
6. For Grid, choose one of the dynamically generated schematic arrangements.
7. For Hero, choose a placement and click the child image to use as the hero.
8. Review the main preview and click **Generate**.

Child groups without usable front images are omitted. Generation fails when no
child images can be loaded. The image-count selection applies consistently to
the previews and the generated cover.

## Development Checks

Run the frontend syntax check and Go tests before installing a rebuilt version:

```sh
node --check group-cover.js
GOCACHE=/tmp/group-cover-gocache go test ./...
GOCACHE=/tmp/group-cover-gocache go build -o group-cover .
```

Use `make validate` for the equivalent JavaScript syntax check, Go tests, and
`go vet` check. Use `make clean` to remove local and distribution builds.

There are currently no Go unit tests in this plugin, so `go test ./...`
primarily verifies that the backend compiles and its package is valid.
