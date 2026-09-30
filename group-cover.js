(function () {
  "use strict";

  const BUTTON_ID = "group-cover-generate-button";
  const MODAL_ID = "group-cover-modal";
  const PREVIEW_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 10'%3E%3Cdefs%3E%3ClinearGradient id='g'%3E%3Cstop stop-color='%23313d48'/%3E%3Cstop offset='.5' stop-color='%23445462'/%3E%3Cstop offset='1' stop-color='%23313d48'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='16' height='10' fill='url(%23g)'/%3E%3C/svg%3E";
  let checkedPath = "";
  let checking = false;

  async function gql(query, variables = {}) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/graphql");
      request.setRequestHeader("Content-Type", "application/json");
      request.onload = () => {
        let result;
        try {
          result = JSON.parse(request.responseText);
        } catch (error) {
          reject(new Error(`Invalid GraphQL response: ${error.message}`));
          return;
        }
        if (request.status < 200 || request.status >= 300) {
          const details = result.errors?.map((error) => error.message).join(", ");
          reject(new Error(details || `GraphQL HTTP ${request.status}`));
          return;
        }
        if (result.errors?.length) {
          reject(new Error(result.errors.map((error) => error.message).join(", ")));
          return;
        }
        resolve(result.data);
      };
      request.onerror = () => reject(new Error("GraphQL request failed"));
      request.send(JSON.stringify({ query, variables }));
    });
  }

  function currentGroupId() {
    const match = window.location.pathname.match(/^\/groups\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function currentButton() {
    return document.getElementById(BUTTON_ID);
  }

  function removeButton() {
    currentButton()?.remove();
    document.getElementById(MODAL_ID)?.remove();
  }

  function logError(message) {
    console.error(`[Group Cover] ${message}`);
  }

  function layoutPreview(design) {
    return `<img class="group-cover-layout-preview is-loading" data-preview-image="${design}" src="${PREVIEW_PLACEHOLDER}" alt="${design} layout preview">`;
  }

  function drawPreviewCover(context, image, x, y, width, height) {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function previewRatio(aspect) {
    const parts = aspect.split(":").map(Number);
    return parts[0] / parts[1];
  }

  function outputSize(aspect) {
    const sizes = { "1:1": [800, 800], "3:4": [600, 800], "4:3": [800, 600], "9:16": [450, 800], "16:9": [800, 450] };
    return sizes[aspect] || sizes["3:4"];
  }

  function angleLabel(angle) {
    return `${Math.round(angle)}°`;
  }

  function diagonalDefaultAngle(aspect) {
    const parts = aspect.split(":").map(Number);
    return Math.atan2(parts[1], parts[0]) * 180 / Math.PI;
  }

  function fanDefaultAngle(count) {
    if (count <= 1) return 0;
    return Math.min(35, 18 + count * 1.5);
  }

  function fanDefaultSpacing(count) {
    if (count <= 1) return 0;
    const total = count === 2 ? 0.22 : Math.min(0.68, 0.18 + 0.045 * count);
    return total * 100 / (count - 1);
  }

  function gridLayoutOptions(count) {
    if (count <= 1) return [{ value: "grid-1x1", label: "1 column x 1 row" }];
    return Array.from({ length: Math.min(count, 4) }, (_, index) => index + 1)
      .map((columns) => ({ columns, rows: Math.ceil(count / columns) }))
      .sort((left, right) => Math.abs(left.columns - left.rows) - Math.abs(right.columns - right.rows))
      .map(({ columns, rows }) => ({ value: `grid-${columns}x${rows}`, label: `${columns} column${columns === 1 ? "" : "s"} x ${rows} row${rows === 1 ? "" : "s"}` }));
  }

  function heroLayoutOptions(count) {
    const options = [
      { value: "hero-left", label: "Hero left + mosaic right" },
      { value: "hero-right", label: "Mosaic left + hero right" },
      { value: "hero-top", label: "Hero top + mosaic below" },
      { value: "hero-bottom", label: "Mosaic above + hero bottom" },
    ];
    if (count >= 5) options.push({ value: "hero-center", label: "Hero centered + mosaic around" });
    return options;
  }

  function arrangementScheme(layout, count) {
    if (layout === "hero-left") {
      return `<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="3" y="3" width="53" height="64"/><rect x="60" y="3" width="37" height="30"/><rect x="60" y="37" width="37" height="30"/></svg>`;
    }
    if (layout === "hero-right") {
      return `<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="3" y="3" width="37" height="30"/><rect x="3" y="37" width="37" height="30"/><rect x="44" y="3" width="53" height="64"/></svg>`;
    }
    if (layout === "hero-top") {
      return `<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="3" y="3" width="94" height="36"/><rect x="3" y="43" width="45" height="24"/><rect x="52" y="43" width="45" height="24"/></svg>`;
    }
    if (layout === "hero-bottom") {
      return `<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="3" y="3" width="45" height="24"/><rect x="52" y="3" width="45" height="24"/><rect x="3" y="33" width="94" height="34"/></svg>`;
    }
    if (layout === "hero-center") {
      return `<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="3" y="3" width="29" height="19"/><rect x="35" y="3" width="30" height="19"/><rect x="68" y="3" width="29" height="19"/><rect x="3" y="26" width="29" height="41"/><rect x="35" y="26" width="30" height="41"/><rect x="68" y="26" width="29" height="41"/><rect x="29" y="20" width="42" height="30"/></svg>`;
    }
    const match = String(layout).match(/^grid-(\d+)x(\d+)$/);
    const columns = match ? Number(match[1]) : 2;
    const rows = match ? Number(match[2]) : 2;
    const cells = [];
    const cellHeight = 70 / rows;
    for (let row = 0; row < rows; row += 1) {
      const rowCount = Math.min(columns, Math.max(0, (count ?? columns * rows) - row * columns));
      if (!rowCount) continue;
      const cellWidth = 100 / rowCount;
      for (let column = 0; column < rowCount; column += 1) {
        cells.push(`<rect x="${(column * cellWidth + 1).toFixed(2)}" y="${(row * cellHeight + 1).toFixed(2)}" width="${(cellWidth - 2).toFixed(2)}" height="${(cellHeight - 2).toFixed(2)}"/>`);
      }
    }
    return `<svg viewBox="0 0 100 70" aria-hidden="true">${cells.join("")}</svg>`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  }

  function previewFrame(canvas, aspect) {
    const ratio = previewRatio(aspect);
    const padding = 5;
    let width = canvas.width - padding * 2;
    let height = width / ratio;
    if (height > canvas.height - padding * 2) {
      height = canvas.height - padding * 2;
      width = height * ratio;
    }
    return {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
    };
  }

  function roundedClip(context, x, y, width, height, corner, radius) {
    context.beginPath();
    if (corner === "square") {
      context.rect(x, y, width, height);
    } else if (corner === "cut") {
      context.moveTo(x + radius, y);
      context.lineTo(x + width - radius, y);
      context.lineTo(x + width, y + radius);
      context.lineTo(x + width, y + height - radius);
      context.lineTo(x + width - radius, y + height);
      context.lineTo(x + radius, y + height);
      context.lineTo(x, y + height - radius);
      context.lineTo(x, y + radius);
      context.closePath();
    } else {
      context.roundRect(x, y, width, height, radius);
    }
    context.clip();
  }

  function drawPreviewCell(context, image, x, y, width, height, settings) {
    const radius = Math.min(width, height) * (Math.max(0, Number(settings.radius) || 0) / 100);
    context.save();
    roundedClip(context, x, y, width, height, settings.corner, radius);
    drawPreviewCover(context, image, x, y, width, height);
    context.restore();
  }

  function drawMosaicPreview(context, images, content, between, settings, heroIndex, largeRight) {
    if (!images.length) return;
    const index = Math.max(0, Math.min(images.length - 1, Number(heroIndex) || 0));
    const largeWidth = (content.width - between) * 0.58;
    const smallWidth = content.width - between - largeWidth;
    const largeX = largeRight ? content.x + smallWidth + between : content.x;
    const remainingX = largeRight ? content.x : content.x + largeWidth + between;
    drawPreviewCell(context, images[index], largeX, content.y, largeWidth, content.height, settings);
    const remaining = images.filter((image, imageIndex) => imageIndex !== index);
    if (!remaining.length) return;
    const rows = Math.ceil(remaining.length / 2);
    const cellWidth = (smallWidth - between) / 2;
    const cellHeight = (content.height - (rows - 1) * between) / rows;
    remaining.forEach((image, imageIndex) => {
      const column = Math.floor(imageIndex / rows);
      const row = imageIndex % rows;
      const width = imageIndex === remaining.length - 1 && remaining.length % 2 === 1 ? cellWidth * 2 + between : cellWidth;
      drawPreviewCell(context, image, remainingX + column * (cellWidth + between), content.y + row * (cellHeight + between), width, cellHeight, settings);
    });
  }

  function drawHeroVerticalPreview(context, images, content, between, settings, heroIndex, heroBottom) {
    const index = Math.max(0, Math.min(images.length - 1, Number(heroIndex) || 0));
    const heroHeight = (content.height - between) * 0.58;
    const remainingHeight = content.height - between - heroHeight;
    const heroY = heroBottom ? content.y + remainingHeight + between : content.y;
    const remainingY = heroBottom ? content.y : content.y + heroHeight + between;
    drawPreviewCell(context, images[index], content.x, heroY, content.width, heroHeight, settings);
    const remaining = images.filter((image, imageIndex) => imageIndex !== index);
    if (!remaining.length) return;
    const rows = Math.ceil(remaining.length / 2);
    const cellWidth = (content.width - between) / 2;
    const cellHeight = (remainingHeight - (rows - 1) * between) / rows;
    remaining.forEach((image, imageIndex) => {
      const column = Math.floor(imageIndex / rows);
      const row = imageIndex % rows;
      const width = imageIndex === remaining.length - 1 && remaining.length % 2 === 1 ? cellWidth * 2 + between : cellWidth;
      drawPreviewCell(context, image, content.x + column * (cellWidth + between), remainingY + row * (cellHeight + between), width, cellHeight, settings);
    });
  }

  function drawHeroCenterPreview(context, images, content, between, settings, heroIndex) {
    const index = Math.max(0, Math.min(images.length - 1, Number(heroIndex) || 0));
    const remaining = images.filter((image, imageIndex) => imageIndex !== index);
    const match = String(settings.gridLayout || "").match(/^grid-(\d+)x(\d+)$/);
    const columns = match ? Math.max(1, Math.min(remaining.length, Number(match[1]))) : Math.min(remaining.length, 3);
    if (remaining.length) {
      const rows = Math.ceil(remaining.length / columns);
      const cellWidth = (content.width - (columns - 1) * between) / columns;
      const cellHeight = (content.height - (rows - 1) * between) / rows;
      remaining.forEach((image, imageIndex) => {
        const row = Math.floor(imageIndex / columns);
        const rowStart = row * columns;
        const rowCount = Math.min(columns, remaining.length - rowStart);
        const rowCellWidth = (content.width - (rowCount - 1) * between) / rowCount;
        drawPreviewCell(context, image, content.x + (imageIndex - rowStart) * (rowCellWidth + between), content.y + row * (cellHeight + between), rowCellWidth, cellHeight, settings);
      });
    }
    const heroWidth = content.width * 0.58;
    const heroHeight = content.height * 0.58;
    drawPreviewCell(context, images[index], content.x + (content.width - heroWidth) / 2, content.y + (content.height - heroHeight) / 2, heroWidth, heroHeight, settings);
  }

  function diagonalScore(x, y, frame, angle, reverse) {
    let u = (x - frame.x) / frame.width - 0.5;
    let v = (y - frame.y) / frame.height - 0.5;
    const baseAngle = Math.atan2(frame.height, frame.width) * 180 / Math.PI;
    const effectiveAngle = reverse ? 2 * baseAngle - angle : angle;
    const delta = (effectiveAngle - baseAngle) * Math.PI / 180;
    const rotatedU = u * Math.cos(delta) - v * Math.sin(delta) + 0.5;
    const rotatedV = u * Math.sin(delta) + v * Math.cos(delta) + 0.5;
    return reverse ? (rotatedU - rotatedV + 1) / 2 : (rotatedU + rotatedV) / 2;
  }

  function diagonalScoreGradient(width, height, angle, reverse) {
    const baseAngle = Math.atan2(height, width) * 180 / Math.PI;
    if (reverse) angle = 2 * baseAngle - angle;
    const delta = (angle - baseAngle) * Math.PI / 180;
    const cosine = Math.cos(delta);
    const sine = Math.sin(delta);
    const du = reverse ? (cosine - sine) / 2 : (cosine + sine) / 2;
    const dv = reverse ? (-sine - cosine) / 2 : (-sine + cosine) / 2;
    return Math.sqrt((du / Math.max(width, 1)) ** 2 + (dv / Math.max(height, 1)) ** 2);
  }

  function clipPolygon(polygon, boundary, keepGreater) {
    const result = [];
    polygon.forEach((point, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length];
      const currentInside = keepGreater ? boundary(point) >= 0 : boundary(point) <= 0;
      const previousInside = keepGreater ? boundary(previous) >= 0 : boundary(previous) <= 0;
      if (currentInside !== previousInside) {
        const currentValue = boundary(point);
        const previousValue = boundary(previous);
        const ratio = previousValue / (previousValue - currentValue);
        result.push({ x: previous.x + (point.x - previous.x) * ratio, y: previous.y + (point.y - previous.y) * ratio });
      }
      if (currentInside) result.push(point);
    });
    return result;
  }

  function drawDiagonalPreview(context, images, content, settings, reverse) {
    const corners = [
      { x: content.x, y: content.y },
      { x: content.x + content.width, y: content.y },
      { x: content.x + content.width, y: content.y + content.height },
      { x: content.x, y: content.y + content.height },
    ];
    images.forEach((image, index, visibleImages) => {
      const gap = Math.max(0, Number(settings.between) || 0) * diagonalScoreGradient(content.width, content.height, settings.angle, reverse);
      const low = index / visibleImages.length + (index === 0 ? 0 : gap / 2);
      const high = (index + 1) / visibleImages.length - (index === visibleImages.length - 1 ? 0 : gap / 2);
      if (low >= high) return;
      let polygon = clipPolygon(corners, (point) => diagonalScore(point.x, point.y, content, settings.angle, reverse) - low, true);
      polygon = clipPolygon(polygon, (point) => diagonalScore(point.x, point.y, content, settings.angle, reverse) - high, false);
      if (polygon.length < 3) return;
      context.save();
      context.beginPath();
      context.moveTo(polygon[0].x, polygon[0].y);
      polygon.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.clip();
      drawPreviewCover(context, image, content.x, content.y, content.width, content.height);
      context.restore();
    });
  }

  function drawLayoutPreview(canvas, images, design, settings) {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = "#172029";
    context.fillRect(0, 0, width, height);
    if (!images.length) return;

    const frame = previewFrame(canvas, settings.aspect);
    const [outputWidth] = outputSize(settings.aspect);
    const previewScale = frame.width / outputWidth;
    const between = Math.max(0, Number(settings.between) || 0) * previewScale;
    const border = Math.max(0, Number(settings.border) || 0) * previewScale;
    context.fillStyle = settings.color;
    context.globalAlpha = settings.alpha / 100;
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
    context.globalAlpha = 1;
    const content = {
      x: frame.x + border,
      y: frame.y + border,
      width: Math.max(1, frame.width - border * 2),
      height: Math.max(1, frame.height - border * 2),
    };

    context.save();
    context.strokeStyle = "rgba(255,255,255,.9)";
    context.lineWidth = 1;
    if (design === "grid") {
      {
        const match = String(settings.gridLayout || "").match(/^grid-(\d+)x(\d+)$/);
        const columns = match ? Math.max(1, Math.min(images.length, Number(match[1]))) : Math.min(images.length, 2);
        const rows = Math.ceil(images.length / columns);
        const cellHeight = (content.height - (rows - 1) * between) / rows;
        images.forEach((image, index) => {
          const row = Math.floor(index / columns);
          const rowStart = row * columns;
          const rowCount = Math.min(columns, images.length - rowStart);
          const cellWidth = (content.width - (rowCount - 1) * between) / rowCount;
          const column = index - rowStart;
          drawPreviewCell(context, image, content.x + column * (cellWidth + between), content.y + row * (cellHeight + between), cellWidth, cellHeight, settings);
        });
      }
    } else if (design === "filmstrip") {
      const cellWidth = (content.width - (images.length - 1) * between) / images.length;
      images.forEach((image, index) => {
        const x = content.x + index * (cellWidth + between);
        drawPreviewCell(context, image, x, content.y, cellWidth, content.height, settings);
      });
    } else if (design === "stack") {
      const cellWidth = Math.min(content.width * 0.72, content.height * 0.72 * 0.75);
      const cellHeight = cellWidth / 0.75;
      const spread = content.width * settings.fanSpacing / 100 * Math.max(images.length - 1, 1);
      for (let index = images.length - 1; index >= 0; index--) {
        const image = images[index];
        context.save();
        const count = images.length;
        const position = index / Math.max(count - 1, 1);
        context.translate(content.x + content.width / 2 + (position - 0.5) * spread, content.y + content.height / 2 + (position - 0.5) * content.height * settings.fanDistance / 100);
        context.rotate((position - 0.5) * (settings.angle * Math.PI / 180));
        drawPreviewCell(context, image, -cellWidth / 2, -cellHeight / 2, cellWidth, cellHeight, settings);
        context.restore();
      }
    } else if (design === "vertical_strip") {
      const cellHeight = (content.height - (images.length - 1) * between) / images.length;
      images.forEach((image, index) => {
        drawPreviewCell(context, image, content.x, content.y + index * (cellHeight + between), content.width, cellHeight, settings);
      });
    } else if (design === "diagonal") {
      drawDiagonalPreview(context, images, content, settings, settings.reverse);
    } else if (design === "hero") {
      if (settings.heroLayout === "hero-top" || settings.heroLayout === "hero-bottom") drawHeroVerticalPreview(context, images, content, between, settings, settings.heroIndex, settings.heroLayout === "hero-bottom");
      else if (settings.heroLayout === "hero-center") drawHeroCenterPreview(context, images, content, between, settings, settings.heroIndex);
      else drawMosaicPreview(context, images, content, between, settings, settings.heroIndex, settings.heroLayout === "hero-right");
    }
    context.restore();
  }

  async function loadPreviewImages(groupID, overlay, onLoaded) {
    const status = overlay.querySelector("[data-status]");
    try {
      const data = await gql(`query GroupCoverPreview($id: ID!) {
        findGroup(id: $id) { sub_groups { group { name front_image_path } } }
      }`, { id: groupID });
      const entries = (data.findGroup?.sub_groups ?? []).map((item) => item.group).filter((group) => group?.front_image_path);
      const images = await Promise.all(entries.map((entry, index) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          image.groupName = entry.name || `Image ${index + 1}`;
          resolve(image);
        };
        image.onerror = () => resolve(null);
        image.src = entry.front_image_path;
      })));
      const usableImages = images.filter(Boolean);
      onLoaded(usableImages);
      status.textContent = usableImages.length ? `${usableImages.length} child images loaded` : "No child images available for preview";
    } catch (error) {
      status.textContent = "Could not load image previews";
      logError(`Could not load previews for group ${groupID}: ${error.message}`);
    }
  }

  function createModal(groupID) {
    const state = {
      design: "grid",
      aspect: "3:4",
      gutterPreset: "small",
      between: 10,
      border: 10,
      corner: "square",
      radius: 12,
      color: "#ffffff",
      alpha: 100,
      angle: 22,
      fanDistance: 6,
      fanSpacing: 8,
      fanSpacingAuto: true,
      gridLayout: "grid-2x2",
      heroIndex: 0,
      heroLayout: "hero-left",
      reverse: false,
      fanReverse: false,
      angleAuto: true,
    };
    let previewImages = [];

    function renderPreviews() {
      const hero = overlay.querySelector("[data-hero-preview]");
      if (!hero || !previewImages.length) return;
      const ratio = previewRatio(state.aspect);
      hero.width = 520;
      hero.height = Math.max(1, Math.round(hero.width / ratio));
      hero.style.aspectRatio = `${ratio}`;
      drawLayoutPreview(hero, previewImages, state.design, state);
    }

    let previewRequest = 0;
    let previewTimer = null;
    let thumbnailRequest = 0;
    let thumbnailTimer = null;

    function scheduleHeroPreview() {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(refreshHeroPreview, 180);
    }

    function scheduleThumbnailPreviews() {
      window.clearTimeout(thumbnailTimer);
      thumbnailTimer = window.setTimeout(refreshThumbnailPreviews, 700);
    }

    async function refreshHeroPreview() {
      const requestID = ++previewRequest;
      const hero = overlay.querySelector("[data-hero-preview]");
      const status = overlay.querySelector("[data-status]");
      status.textContent = "Rendering preview...";
      try {
        const result = await gql(`mutation PreviewGroupCover($pluginId: ID!, $args: Map) {
          runPluginOperation(plugin_id: $pluginId, args: $args)
        }`, {
          pluginId: "group-cover",
          args: {
            mode: "preview",
            group_id: groupID,
            design: state.design,
            aspect: state.aspect,
            gutter: state.between,
            border: state.border,
            corner: state.corner,
            corner_radius: state.radius,
            angle: state.angle,
            fan_distance: state.fanDistance,
            fan_spacing: state.fanSpacing,
            grid_layout: state.gridLayout,
            hero_index: state.heroIndex,
            hero_layout: state.heroLayout,
            reverse: state.reverse,
            fan_reverse: state.fanReverse,
            gutter_color: `${state.color},${state.alpha}`,
          },
        });
        if (requestID !== previewRequest) return;
        const output = result?.runPluginOperation;
        const preview = typeof output === "string" ? JSON.parse(output) : output;
        if (!preview?.data_url) throw new Error("Preview returned no image");
        const image = new Image();
        image.onload = () => {
          hero.width = image.naturalWidth;
          hero.height = image.naturalHeight;
          hero.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
          hero.getContext("2d").drawImage(image, 0, 0);
          hero.classList.remove("is-loading");
        };
        image.src = preview.data_url;
        if (state.design === "stack" && state.angleAuto) {
          const nextAngle = fanDefaultAngle(preview.images_used);
          if (state.angle !== nextAngle) {
            state.angle = nextAngle;
            overlay.querySelector("[data-angle]").value = state.angle;
            overlay.querySelector("[data-angle-value]").textContent = angleLabel(state.angle);
            renderPreviews();
            scheduleHeroPreview();
          }
        }
        if (state.design === "stack" && state.fanSpacingAuto) {
          const nextSpacing = fanDefaultSpacing(preview.images_used);
          if (state.fanSpacing !== nextSpacing) {
            state.fanSpacing = nextSpacing;
            overlay.querySelector("[data-fan-spacing]").value = state.fanSpacing;
            overlay.querySelector("[data-fan-spacing-value]").textContent = `${Math.round(state.fanSpacing)}%`;
            renderPreviews();
          }
        }
        status.textContent = `${preview.images_used} child images loaded`;
        updateCompositionOptions(preview.images_used);
      } catch (error) {
        if (requestID !== previewRequest) return;
        status.textContent = `Preview failed: ${error.message}`;
        logError(`Preview failed: ${error.message}`);
      }
    }

    async function refreshThumbnailPreviews() {
      const requestID = ++thumbnailRequest;
      try {
        const result = await gql(`mutation PreviewAllGroupCovers($pluginId: ID!, $args: Map) {
          runPluginOperation(plugin_id: $pluginId, args: $args)
        }`, {
          pluginId: "group-cover",
          args: {
            mode: "preview_all",
            group_id: groupID,
            aspect: state.aspect,
            gutter: state.between,
            border: state.border,
            corner: state.corner,
            corner_radius: state.radius,
            angle: state.angle,
            fan_distance: state.fanDistance,
            fan_spacing: state.fanSpacing,
            grid_layout: state.gridLayout,
            hero_index: state.heroIndex,
            hero_layout: state.heroLayout,
            reverse: state.reverse,
            fan_reverse: state.fanReverse,
            gutter_color: `${state.color},${state.alpha}`,
          },
        });
        if (requestID !== thumbnailRequest) return;
        const output = result?.runPluginOperation;
        const previews = typeof output === "string" ? JSON.parse(output) : output;
        if (!previews?.previews) return;
        overlay.querySelectorAll("[data-preview-image]").forEach((image) => {
          image.src = previews.previews[image.dataset.previewImage] || PREVIEW_PLACEHOLDER;
          image.classList.remove("is-loading");
        });
      } catch (error) {
        logError(`Thumbnail preview failed: ${error.message}`);
      }
    }

    function zoomPreview(canvas) {
      try {
        const backdrop = document.createElement("div");
        backdrop.className = "group-cover-preview-zoom";
        backdrop.innerHTML = `<img alt="Expanded layout preview"><button type="button" aria-label="Close preview">×</button>`;
        backdrop.querySelector("img").src = canvas instanceof HTMLCanvasElement ? canvas.toDataURL("image/png") : canvas.src;
        backdrop.addEventListener("click", () => backdrop.remove());
        document.body.appendChild(backdrop);
      } catch (error) {
        logError(`Could not zoom preview: ${error.message}`);
      }
    }

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.className = "group-cover-modal-backdrop";
    overlay.innerHTML = `
      <section class="group-cover-modal" role="dialog" aria-modal="true" aria-labelledby="group-cover-modal-title">
        <header class="group-cover-modal-header">
          <h2 id="group-cover-modal-title">Generate group cover</h2>
          <button type="button" class="group-cover-modal-close" aria-label="Close">×</button>
        </header>
        <div class="group-cover-modal-body">
          <aside class="group-cover-settings">
            <h3>Settings</h3>
            <fieldset>
              <legend>Aspect</legend>
              <div class="group-cover-choice-grid">
                ${["1:1", "3:4", "4:3", "9:16", "16:9"].map((value) => `<button type="button" data-aspect="${value}" class="${value === state.aspect ? "selected" : ""}">${value}</button>`).join("")}
              </div>
            </fieldset>
            <fieldset>
              <legend>Gutter space</legend>
              <div class="group-cover-choice-grid">
                ${[["none", "None / 0"], ["small", "Small / 10"], ["medium", "Medium / 20"], ["large", "Large / 40"], ["custom", "Custom"]].map(([value, label]) => `<button type="button" data-gutter="${value}" class="${value === state.gutterPreset ? "selected" : ""}">${label}</button>`).join("")}
              </div>
              <div class="group-cover-custom-gutter" hidden>
                <label>Between <input type="number" min="0" max="200" data-custom-between value="${state.between}"></label>
                <label>Border <input type="number" min="0" max="200" data-custom-border value="${state.border}"></label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Corner</legend>
              <div class="group-cover-choice-grid">
                ${[["square", "Square"], ["round", "Round"], ["cut", "Cut"]].map(([value, label]) => `<button type="button" data-corner="${value}" class="${value === state.corner ? "selected" : ""}">${label}</button>`).join("")}
              </div>
            </fieldset>
            <label class="group-cover-range-field">Corner radius <input type="range" min="0" max="50" value="${state.radius}" data-radius><output data-radius-value>${state.radius}%</output></label>
            <label class="group-cover-color-field">Gutter color <input type="color" data-color value="${state.color}"></label>
            <label class="group-cover-range-field">Gutter opacity <input type="range" min="0" max="100" value="${state.alpha}" data-alpha><output data-alpha-value>${state.alpha}%</output></label>
            <fieldset data-angle-settings hidden>
              <legend data-angle-label>Stack spread angle</legend>
              <div class="group-cover-angle-row">
                <input type="range" min="15" max="75" value="${state.angle}" data-angle>
                <output data-angle-value>${angleLabel(state.angle)}</output>
                <button type="button" class="group-cover-reset-angle" data-reset-angle>Reset</button>
              </div>
            </fieldset>
            <fieldset data-fan-settings hidden>
              <label><input type="checkbox" data-fan-reverse> Reverse fan direction</label>
              <label class="group-cover-range-field">Vertical offset <input type="range" min="0" max="35" value="${state.fanDistance}" data-fan-distance><output data-fan-distance-value>${state.fanDistance}%</output></label>
              <label class="group-cover-range-field">Horizontal spacing <input type="range" min="0" max="25" value="${state.fanSpacing}" data-fan-spacing><output data-fan-spacing-value>${Math.round(state.fanSpacing)}%</output></label>
            </fieldset>
            <fieldset data-grid-settings>
              <legend>Arrangement</legend>
              <div class="group-cover-arrangement-grid" data-grid-layout-options></div>
            </fieldset>
            <fieldset data-hero-settings hidden>
              <legend>Hero placement</legend>
              <div class="group-cover-arrangement-grid" data-hero-layout-options></div>
              <legend>Hero image</legend>
              <div class="group-cover-hero-choices" data-hero-index-options></div>
            </fieldset>
            <fieldset data-diagonal-settings hidden>
              <label><input type="checkbox" data-reverse> Reverse diagonal</label>
            </fieldset>
          </aside>
          <div class="group-cover-layouts">
            <div class="group-cover-hero-wrap">
              <h3>Preview</h3>
              <canvas class="group-cover-hero-preview is-loading" data-hero-preview data-preview-design="${state.design}" width="520" height="693" aria-label="Selected layout preview"></canvas>
            </div>
            <div class="group-cover-layout-strip" role="listbox" aria-label="Layouts">
              ${[["grid", "Grid"], ["hero", "Hero"], ["diagonal", "Diagonal"], ["filmstrip", "Filmstrip"], ["vertical_strip", "Vertical strip"], ["stack", "Fan"]].map(([value, label]) => `<button type="button" role="option" aria-selected="${value === state.design}" data-design="${value}" class="group-cover-layout-card ${value === state.design ? "selected" : ""}">${layoutPreview(value)}<strong>${label}</strong></button>`).join("")}
            </div>
            <p class="group-cover-modal-status" data-status></p>
          </div>
        </div>
        <footer class="group-cover-modal-footer">
          <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
          <button type="button" class="btn btn-primary" data-generate>Generate</button>
        </footer>
      </section>`;

    function close() {
      overlay.remove();
    }

    function updateSelection(selector, attribute, value) {
      overlay.querySelectorAll(selector).forEach((element) => {
        element.classList.toggle("selected", element.dataset[attribute] === value);
      });
    }

    function updateCompositionOptions(count) {
      const grid = overlay.querySelector("[data-grid-layout-options]");
      const heroLayout = overlay.querySelector("[data-hero-layout-options]");
      const hero = overlay.querySelector("[data-hero-index-options]");
      if (!grid || !heroLayout || !hero) return;
      const layouts = gridLayoutOptions(count);
      if (!layouts.some((option) => option.value === state.gridLayout)) state.gridLayout = layouts[0].value;
      grid.innerHTML = layouts.map((option) => `<button type="button" class="group-cover-arrangement-option ${option.value === state.gridLayout ? "selected" : ""}" data-grid-layout="${option.value}" title="${escapeHTML(option.label)}">${arrangementScheme(option.value, count)}<span>${escapeHTML(option.label)}</span></button>`).join("");
      const heroLayouts = heroLayoutOptions(count);
      if (!heroLayouts.some((option) => option.value === state.heroLayout)) state.heroLayout = heroLayouts[0].value;
      heroLayout.innerHTML = heroLayouts.map((option) => `<button type="button" class="group-cover-arrangement-option ${option.value === state.heroLayout ? "selected" : ""}" data-hero-layout="${option.value}" title="${escapeHTML(option.label)}">${arrangementScheme(option.value)}<span>${escapeHTML(option.label)}</span></button>`).join("");
      state.heroIndex = Math.min(state.heroIndex, Math.max(0, count - 1));
      hero.innerHTML = Array.from({ length: Math.max(1, count) }, (_, index) => {
        const image = previewImages[index];
        const label = image?.groupName || `Image ${index + 1}`;
        const source = image?.src || PREVIEW_PLACEHOLDER;
        return `<button type="button" class="group-cover-hero-choice ${index === state.heroIndex ? "selected" : ""}" data-hero-index="${index}" title="${escapeHTML(label)}"><img src="${source}" alt=""><span>${escapeHTML(label)}</span></button>`;
      }).join("");
    }

    overlay.querySelectorAll("[data-aspect]").forEach((element) => element.addEventListener("click", () => {
      state.aspect = element.dataset.aspect;
      if (state.angleAuto && state.design === "diagonal") state.angle = diagonalDefaultAngle(state.aspect);
      updateSelection("[data-aspect]", "aspect", state.aspect);
      renderPreviews();
      scheduleHeroPreview();
      scheduleThumbnailPreviews();
    }));
    overlay.querySelectorAll("[data-gutter]").forEach((element) => element.addEventListener("click", () => {
      state.gutterPreset = element.dataset.gutter;
      if (state.gutterPreset !== "custom") {
        state.between = state.gutterPreset === "none" ? 0 : state.gutterPreset === "small" ? 10 : state.gutterPreset === "medium" ? 20 : 40;
        state.border = state.between;
      }
      overlay.querySelector(".group-cover-custom-gutter").hidden = state.gutterPreset !== "custom";
      updateSelection("[data-gutter]", "gutter", state.gutterPreset);
      renderPreviews();
      scheduleHeroPreview();
      scheduleThumbnailPreviews();
    }));
    overlay.querySelectorAll("[data-corner]").forEach((element) => element.addEventListener("click", () => {
      state.corner = element.dataset.corner;
      updateSelection("[data-corner]", "corner", state.corner);
      renderPreviews();
      scheduleHeroPreview();
      scheduleThumbnailPreviews();
    }));
    overlay.querySelectorAll("[data-design]").forEach((element) => element.addEventListener("click", () => {
      state.design = element.dataset.design;
      state.angleAuto = true;
      if (state.design === "stack") {
        state.angle = fanDefaultAngle(previewImages.length || 2);
        state.fanSpacing = fanDefaultSpacing(previewImages.length || 2);
      }
      if (state.design === "diagonal") state.angle = diagonalDefaultAngle(state.aspect);
      overlay.querySelector("[data-angle]").value = state.angle;
      overlay.querySelector("[data-hero-preview]").dataset.previewDesign = state.design;
      updateSelection("[data-design]", "design", state.design);
      overlay.querySelectorAll("[data-design]").forEach((item) => item.setAttribute("aria-selected", item.dataset.design === state.design));
      overlay.querySelector("[data-angle-label]").textContent = state.design === "stack" ? "Fan spread angle" : "Diagonal angle";
      overlay.querySelector("[data-angle-settings]").hidden = !["stack", "diagonal"].includes(state.design);
      overlay.querySelector("[data-diagonal-settings]").hidden = state.design !== "diagonal";
      overlay.querySelector("[data-fan-settings]").hidden = state.design !== "stack";
      overlay.querySelector("[data-grid-settings]").hidden = state.design !== "grid";
      overlay.querySelector("[data-hero-settings]").hidden = state.design !== "hero";
      overlay.querySelector("[data-angle-value]").textContent = angleLabel(state.angle);
      renderPreviews();
      scheduleHeroPreview();
      scheduleThumbnailPreviews();
    }));
    overlay.querySelector("[data-fan-reverse]").addEventListener("change", (event) => { state.fanReverse = event.target.checked; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-fan-distance]").addEventListener("input", (event) => { state.fanDistance = Number(event.target.value); overlay.querySelector("[data-fan-distance-value]").textContent = `${state.fanDistance}%`; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-fan-spacing]").addEventListener("input", (event) => { state.fanSpacingAuto = false; state.fanSpacing = Number(event.target.value); overlay.querySelector("[data-fan-spacing-value]").textContent = `${Math.round(state.fanSpacing)}%`; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-grid-layout-options]").addEventListener("click", (event) => {
      const option = event.target.closest("[data-grid-layout]");
      if (!option) return;
      state.gridLayout = option.dataset.gridLayout;
      updateSelection("[data-grid-layout]", "gridLayout", state.gridLayout);
      renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews();
    });
    overlay.querySelector("[data-hero-layout-options]").addEventListener("click", (event) => {
      const option = event.target.closest("[data-hero-layout]");
      if (!option) return;
      state.heroLayout = option.dataset.heroLayout;
      updateSelection("[data-hero-layout]", "heroLayout", state.heroLayout);
      renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews();
    });
    overlay.querySelector("[data-hero-index-options]").addEventListener("click", (event) => {
      const option = event.target.closest("[data-hero-index]");
      if (!option) return;
      state.heroIndex = Number(option.dataset.heroIndex) || 0;
      updateSelection("[data-hero-index]", "heroIndex", String(state.heroIndex));
      renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews();
    });
    overlay.querySelector("[data-reverse]").addEventListener("change", (event) => { state.reverse = event.target.checked; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-radius]").addEventListener("input", (event) => { state.radius = Number(event.target.value); overlay.querySelector("[data-radius-value]").textContent = `${state.radius}%`; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-alpha]").addEventListener("input", (event) => { state.alpha = Number(event.target.value); overlay.querySelector("[data-alpha-value]").textContent = `${state.alpha}%`; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-angle]").addEventListener("input", (event) => { state.angleAuto = false; state.angle = Number(event.target.value); overlay.querySelector("[data-angle-value]").textContent = angleLabel(state.angle); renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-reset-angle]").addEventListener("click", () => { state.angleAuto = true; state.angle = state.design === "stack" ? fanDefaultAngle(previewImages.length || 2) : diagonalDefaultAngle(state.aspect); overlay.querySelector("[data-angle]").value = state.angle; overlay.querySelector("[data-angle-value]").textContent = angleLabel(state.angle); renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-custom-between]").addEventListener("input", (event) => { state.between = Number(event.target.value) || 0; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-custom-border]").addEventListener("input", (event) => { state.border = Number(event.target.value) || 0; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector("[data-color]").addEventListener("input", (event) => { state.color = event.target.value; renderPreviews(); scheduleHeroPreview(); scheduleThumbnailPreviews(); });
    overlay.querySelector(".group-cover-modal-close").addEventListener("click", close);
    overlay.querySelector("[data-cancel]").addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    overlay.querySelector("[data-generate]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = overlay.querySelector("[data-status]");
      button.disabled = true;
      status.textContent = "Generating cover...";
      try {
        await gql(
          `mutation GenerateGroupCover($pluginId: ID!, $args: Map) {
            runPluginOperation(plugin_id: $pluginId, args: $args)
          }`,
          {
            pluginId: "group-cover",
            args: {
              group_id: groupID,
              design: state.design,
              aspect: state.aspect,
              gutter: state.between,
              border: state.border,
              corner: state.corner,
              corner_radius: state.radius,
              angle: state.angle,
              fan_distance: state.fanDistance,
              fan_spacing: state.fanSpacing,
              grid_layout: state.gridLayout,
              hero_index: state.heroIndex,
              hero_layout: state.heroLayout,
              reverse: state.reverse,
              fan_reverse: state.fanReverse,
              gutter_color: `${state.color},${state.alpha}`,
            },
          }
        );
        status.textContent = "Cover generated.";
        window.setTimeout(() => window.location.reload(), 300);
      } catch (error) {
        button.disabled = false;
        status.textContent = `Generation failed: ${error.message}`;
        logError(`Generation failed: ${error.message}`);
      }
    });

    document.body.appendChild(overlay);
    renderPreviews();
    loadPreviewImages(groupID, overlay, (images) => {
      previewImages = images;
      if (state.design === "stack" && state.angleAuto) state.angle = fanDefaultAngle(images.length);
      updateCompositionOptions(images.length);
      if (state.design === "stack" && state.fanSpacingAuto) state.fanSpacing = fanDefaultSpacing(images.length);
      renderPreviews();
    });
    scheduleHeroPreview();
    scheduleThumbnailPreviews();
  }

  function addButton(groupID) {
    if (currentButton()) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn btn-secondary btn-sm group-cover-generate-button";
    button.title = "Generate a cover from child groups";
    button.setAttribute("aria-label", "Generate a cover from child groups");
    button.innerHTML = `<svg class="group-cover-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="6" width="14" height="13" rx="2"></rect><path d="M7 6l1.5-3h4L14 6"></path><circle cx="10" cy="12.5" r="3"></circle><path d="M18 5v6M15 8h6"></path></svg>`;
    button.addEventListener("click", () => createModal(groupID));

    const groupImages = document.querySelector(".group-images");
    if (groupImages) {
      groupImages.appendChild(button);
      return;
    }
    button.classList.add("group-cover-floating-button");
    document.body.appendChild(button);
  }

  function placeExistingButton() {
    const button = currentButton();
    const groupImages = document.querySelector(".group-images");
    if (!button || !groupImages || groupImages.contains(button)) return;
    button.classList.remove("group-cover-floating-button");
    groupImages.appendChild(button);
  }

  async function injectButton() {
    const groupID = currentGroupId();
    if (!groupID) {
      checkedPath = "";
      removeButton();
      return;
    }
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (checkedPath === currentPath || checking) return;
    checking = true;
    try {
      const data = await gql(`query GroupCoverChildren($id: ID!) { findGroup(id: $id) { sub_groups { group { id } } } }`, { id: groupID });
      checkedPath = currentPath;
      if (data.findGroup?.sub_groups?.length) addButton(groupID);
    } catch (error) {
      checkedPath = currentPath;
      logError(`Could not inspect group ${groupID}: ${error.message}`);
    } finally {
      checking = false;
    }
  }

  const observer = new MutationObserver(() => {
    placeExistingButton();
    if (currentGroupId() && !currentButton() && document.querySelector(".group-images")) injectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  injectButton();
  window.setInterval(() => { placeExistingButton(); injectButton(); }, 800);
})();
