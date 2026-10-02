PLUGIN := group-cover
DIST := dist

PACKAGE_FILES := group-cover.yml group-cover.js group-cover.css LICENSE README.md
TARGETS := darwin-amd64 darwin-arm64 linux-amd64 linux-arm64 windows-amd64 freebsd-amd64
VERSION ?= 0.2.0
SOURCE_REPOSITORY ?= https://github.com/gcrosemond/GroupCover
PUBLISH_DATE ?= $(shell date -u '+%Y-%m-%d %H:%M:%S')
SITE := site

.PHONY: all build build-all package site test validate clean

all: build

build:
	go build -trimpath -ldflags "-s -w" -o $(PLUGIN) .

build-all:
	@set -e; \
	mkdir -p $(DIST); \
	for target in $(TARGETS); do \
		os=$${target%%-*}; \
		arch=$${target#*-}; \
		package_dir="$(DIST)/$(PLUGIN)-$$target"; \
		mkdir -p "$$package_dir"; \
		echo "Building $$target"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "-s -w" -o "$$package_dir/$(PLUGIN)" .; \
		cp $(PACKAGE_FILES) "$$package_dir/"; \
		sed "s/^version: .*/version: $(VERSION)/" group-cover.yml > "$$package_dir/group-cover.yml"; \
	done

package: build-all
	@set -e; \
	for target in $(TARGETS); do \
		archive="$(DIST)/$(PLUGIN)-$$target.zip"; \
		echo "Packaging $$archive"; \
		(cd "$(DIST)/$(PLUGIN)-$$target" && rm -f "../$$(basename "$$archive")" && zip -qr "../$$(basename "$$archive")" .); \
	done

site: package
	@set -e; \
	rm -rf $(SITE); \
	mkdir -p $(SITE); \
	: > "$(SITE)/index.yml"; \
	for target in $(TARGETS); do \
		archive="$(PLUGIN)-$$target.zip"; \
		sha256=$$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$(DIST)/$$archive"; else sha256sum "$(DIST)/$$archive"; fi | awk '{print $$1}'); \
		cp "$(DIST)/$$archive" "$(SITE)/"; \
		printf '%s\n' \
			"- id: group-cover-$$target" \
			"  name: Group Cover ($$target)" \
			'  version: $(VERSION)' \
			'  date: "$(PUBLISH_DATE)"' \
			"  path: $$archive" \
			"  sha256: $$sha256" \
			'  metadata:' \
			'    description: Generate group cover images from child group front images.' \
			"    source_repository: $(SOURCE_REPOSITORY)" \
			"    platform: $$target" >> "$(SITE)/index.yml"; \
	done

test:
	go test ./...

validate:
	node --check group-cover.js
	go test ./...
	go vet ./...

clean:
	rm -rf $(DIST)
	rm -f $(PLUGIN)
