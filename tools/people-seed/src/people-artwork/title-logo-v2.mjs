import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { renderTitleLogo, prepareTitleLogoRenderer } from "./title-logo.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

export const PEOPLE_TITLE_LOGO_V2_RENDERER_VERSION = "people-title-logo-standard-canvas-renderer-v5";
export const PEOPLE_TITLE_LOGO_V2_PRESET_ID = "people-title-logo-standard-canvas-v2";
export const PEOPLE_TITLE_LOGO_V2_PRESET_PATH = "tools/people-seed/presets/people-title-logo-standard-canvas-v2.json";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateDesignLockedPreset(preset, basePreset) {
  assert(preset?.id === PEOPLE_TITLE_LOGO_V2_PRESET_ID, "People title-logo v2 preset ID changed.");
  assert(preset?.rendererVersion === PEOPLE_TITLE_LOGO_V2_RENDERER_VERSION, "People title-logo v2 renderer version changed.");
  assert(preset?.status === "design-locked" && preset?.publicationAuthorised === false, "People title-logo v2 must remain design-locked and staging-only until asset publication is separately approved.");
  assert(preset?.basePresetId === basePreset.id && preset?.baseRendererVersion === basePreset.rendererVersion, "People title-logo v2 base renderer binding changed.");
  assert(preset?.version === 3, "People title-logo v2 preset version changed.");
  assert(preset?.canvas?.width === 1600 && preset.canvas.height === 480 && preset.canvas.transparentPadding === 24, "People title-logo v2 must use the approved standard 1600x480 canvas and padding.");
  assert(preset?.typography?.fontSize === 150 && preset.typography.sizingRule === "uniform-fixed", "People title-logo v2 uniform name sizing changed.");
  assert(preset?.typography?.minimumVisibleLineGap === 2, "People title-logo v2 minimum visible line gap changed.");
  assert(preset?.typography?.presentationCase === "uppercase-en-US" && preset.typography.alignment === "center", "People title-logo v2 name presentation changed.");
  assert(JSON.stringify(preset.typography.region) === JSON.stringify({ x: 0, y: 32, width: 1600, height: 259 }), "People title-logo v2 name region changed.");
  assert(preset?.separator?.style === "split-rule-open-clapboard", "People title-logo v2 separator must use the approved open-clapboard lock.");
  assert(preset?.separator?.width === 700 && preset.separator.height === 50 && preset.separator.baseWidth === 460 && preset.separator.baseHeight === 33, "People title-logo v2 separator size changed.");
  assert(typeof preset?.separator?.lineThickness === "number" && preset.separator.lineThickness > 0, "People title-logo v2 separator line thickness must be positive.");
  assert(preset?.separator?.iconWidth === 32 && preset.separator.bodyTop === 15 && preset.separator.bodyHeight === 17, "People title-logo v2 clapboard geometry changed.");
  assert(preset?.separator?.ruleClearance === 18, "People title-logo v2 clapboard rule clearance changed.");
  assert(preset?.separator?.top === 317 && preset.separator.nameGap === 26 && preset.separator.collectionGap === 19, "People title-logo v2 fixed secondary positioning changed.");
  assert(typeof preset?.separator?.opacity === "number" && preset.separator.opacity > 0 && preset.separator.opacity <= 1, "People title-logo v2 separator opacity is invalid.");
  assert(preset?.collection?.text === "COLLECTION" && preset.collection.family === basePreset.typography.family, "People title-logo v2 COLLECTION typography changed family or content.");
  assert(preset?.collection?.weight === 500 && preset.collection.fontSize === 97.65, "People title-logo v2 COLLECTION must use the approved uniform size.");
  assert(preset?.collection?.tracking === 10.6575, "People title-logo v2 COLLECTION tracking changed.");
  assert(preset?.output?.format === "png" && preset.output.alpha === true && preset.output.canvas === "standard-1600x480", "People title-logo v2 output contract changed.");
  assert(preset?.output?.visibleAlphaThreshold === 0, "People title-logo v2 visible-alpha threshold changed.");
}

export async function loadTitleLogoV2Configuration({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, baseConfiguration } = {}) {
  assert(baseConfiguration?.preset, "People title-logo v2 requires the validated production title-logo configuration.");
  const presetPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_V2_PRESET_PATH);
  const presetBuffer = await fs.readFile(presetPath);
  const preset = JSON.parse(presetBuffer);
  validateDesignLockedPreset(preset, baseConfiguration.preset);
  return { preset, presetPath, presetHash: sha256(presetBuffer) };
}

export async function prepareTitleLogoV2Renderer({ people, basePrepared = null, proofConfiguration = null, fontDirectory = null } = {}) {
  assert(Array.isArray(people) && people.length > 0, "People title-logo v2 requires at least one selected identity.");
  const prepared = basePrepared || await prepareTitleLogoRenderer({ people, fontDirectory });
  const resolvedProofConfiguration = proofConfiguration || await loadTitleLogoV2Configuration({ baseConfiguration: prepared.configuration });
  assert(prepared.fontRecord.family === resolvedProofConfiguration.preset.collection.family, "People title-logo v2 COLLECTION must use the approved Person-name font family.");
  assert(prepared.fontRecord.verifiedWeights.includes(resolvedProofConfiguration.preset.collection.weight), "People title-logo v2 COLLECTION weight was not verified.");
  return { ...prepared, proofConfiguration: resolvedProofConfiguration };
}

function unionBounds(bounds) {
  const minX = Math.floor(Math.min(...bounds.map((bound) => bound.x)));
  const minY = Math.floor(Math.min(...bounds.map((bound) => bound.y)));
  const maxX = Math.ceil(Math.max(...bounds.map((bound) => bound.x + bound.width)));
  const maxY = Math.ceil(Math.max(...bounds.map((bound) => bound.y + bound.height)));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

async function alphaVisibleBounds(runtime, buffer) {
  const { data, info } = await runtime.sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert(maxX >= minX && maxY >= minY, "People title-logo v2 layer contains no visible pixels.");
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function cropVisible(runtime, buffer, bounds = null) {
  const visible = bounds || await alphaVisibleBounds(runtime, buffer);
  const output = await runtime.sharp(buffer)
    .extract({ left: visible.x, top: visible.y, width: visible.width, height: visible.height })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  return { output, bounds: visible };
}

async function renderCollection(runtime, preset, fontRecord) {
  const style = preset.collection;
  const tracking = Math.round(style.tracking * 1024);
  const size = Math.round(style.fontSize * 1024);
  const markup = `<span foreground="${style.colour}" font_family="${fontRecord.family}" font_weight="${style.weight}" size="${size}" letter_spacing="${tracking}">${style.text}</span>`;
  const raw = await runtime.sharp({
    text: {
      text: markup,
      font: `${fontRecord.family} ${style.fontSize}`,
      fontfile: fontRecord.fontPath,
      rgba: true,
      dpi: 72,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  return cropVisible(runtime, raw);
}

function escapePangoMarkup(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function renderNameAtFontSize(runtime, baseRecord, fontSize, fontRecord, maximumHeight) {
  const size = Math.round(fontSize * 1024);
  const sourceBounds = baseRecord.lineBounds;
  const sourceTop = Math.min(...sourceBounds.map((bound) => bound.y));
  const scaleFromBase = fontSize / baseRecord.finalFontSize;
  const layers = [];
  for (const [index, line] of baseRecord.presentationLines.entries()) {
    const markup = `<span foreground="#FFFFFF" font_family="${fontRecord.family}" font_weight="${fontRecord.weight}" size="${size}">${escapePangoMarkup(line)}</span>`;
    const raw = await runtime.sharp({
      text: {
        text: markup,
        font: `${fontRecord.family} ${fontSize}`,
        fontfile: fontRecord.fontPath,
        rgba: true,
        dpi: 72,
      },
    }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
    const cropped = await cropVisible(runtime, raw);
    layers.push({
      output: cropped.output,
      width: cropped.bounds.width,
      height: cropped.bounds.height,
      top: Math.round((sourceBounds[index].y - sourceTop) * scaleFromBase),
    });
  }
  const width = Math.max(...layers.map((layer) => layer.width));
  const originalHeight = Math.max(...layers.map((layer) => layer.top + layer.height));
  const lineGapAdjustment = Math.max(0, originalHeight - maximumHeight);
  if (lineGapAdjustment > 0) {
    assert(layers.length === 2, `${baseRecord.stableKey}: People title-logo v2 line-gap compaction requires exactly two lines.`);
    layers[1].top -= lineGapAdjustment;
  }
  const visibleLineGap = layers.length === 2
    ? layers[1].top - (layers[0].top + layers[0].height)
    : null;
  const height = Math.max(...layers.map((layer) => layer.top + layer.height));
  const output = await runtime.sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite(layers.map((layer) => ({ input: layer.output, left: Math.round((width - layer.width) / 2), top: layer.top })))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  return { output, width, height, fontSize, scaleFromBase, lineGapAdjustment, visibleLineGap };
}

async function renderFixedName(runtime, baseRecord, preset, fontRecord) {
  const typography = preset.typography;
  const rendered = await renderNameAtFontSize(runtime, baseRecord, typography.fontSize, fontRecord, typography.region.height);
  assert(rendered.lineGapAdjustment === 0 || rendered.visibleLineGap >= typography.minimumVisibleLineGap, `${baseRecord.stableKey}: People title-logo v2 line-gap compaction exceeds the approved minimum visible gap.`);
  assert(rendered.width <= typography.region.width && rendered.height <= typography.region.height, `${baseRecord.stableKey}: People title-logo v2 name cannot fit the approved standard canvas.`);
  return rendered;
}

function renderSeparatorSvg(style) {
  const centre = style.baseWidth / 2;
  const iconLeft = centre - style.iconWidth / 2;
  const iconRight = centre + style.iconWidth / 2;
  const lineY = style.bodyTop + style.bodyHeight / 2;
  const leftRuleEnd = iconLeft - style.ruleClearance;
  const rightRuleStart = iconRight + style.ruleClearance;
  assert(leftRuleEnd > 0 && rightRuleStart < style.baseWidth, "People title-logo v2 separator geometry does not fit its canvas.");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${style.width}" height="${style.height}" viewBox="0 0 ${style.baseWidth} ${style.baseHeight}"><g fill="none" stroke="${style.colour}" stroke-opacity="${style.opacity}" stroke-width="${style.lineThickness}" stroke-linecap="round" stroke-linejoin="round"><path d="M0 ${lineY} H${leftRuleEnd} M${rightRuleStart} ${lineY} H${style.baseWidth}"/><rect x="${iconLeft}" y="${style.bodyTop}" width="${style.iconWidth}" height="${style.bodyHeight}" rx="1"/><path d="M${iconLeft - 1} 12 L${iconRight - 3} 1 L${iconRight} 6 L${iconLeft + 1} 17 Z"/><path d="M${iconLeft + 8} 9 L${iconLeft + 12} 14 M${iconLeft + 18} 5 L${iconLeft + 22} 10"/></g><circle cx="${iconLeft + 1}" cy="16" r="1.7" fill="${style.colour}" fill-opacity="${style.opacity}"/></svg>`);
}

export async function renderTitleLogoV2({ person, runtime, configuration, fontRecord, proofConfiguration } = {}) {
  const preset = proofConfiguration?.preset;
  assert(preset?.id === PEOPLE_TITLE_LOGO_V2_PRESET_ID, "People title-logo v2 configuration is missing.");
  const base = await renderTitleLogo({ person, runtime, configuration, fontRecord });
  const baseNameBounds = unionBounds(base.record.lineBounds);
  const name = await renderFixedName(runtime, base.record, preset, fontRecord);
  const collection = await renderCollection(runtime, preset, fontRecord);
  const separatorBuffer = renderSeparatorSvg(preset.separator);
  const separatorMetadata = await runtime.sharp(separatorBuffer).metadata();
  assert(separatorMetadata.width === preset.separator.width && separatorMetadata.height === preset.separator.height, "People title-logo v2 separator dimensions changed.");

  const { width, height, transparentPadding } = preset.canvas;
  const nameRegion = preset.typography.region;
  const nameLeft = Math.round((width - name.width) / 2);
  const nameTop = nameRegion.y + nameRegion.height - name.height;
  const separatorLeft = Math.round((width - preset.separator.width) / 2);
  const collectionLeft = Math.round((width - collection.bounds.width) / 2);
  const separatorTop = preset.separator.top;
  const collectionTop = separatorTop + preset.separator.height + preset.separator.collectionGap;
  const actualNameGap = separatorTop - (nameTop + name.height);
  assert(nameLeft >= nameRegion.x && nameLeft + name.width <= nameRegion.x + nameRegion.width, `${person.stableKey}: People title-logo v2 name exceeds its horizontal region.`);
  assert(nameTop >= nameRegion.y && nameTop + name.height <= nameRegion.y + nameRegion.height, `${person.stableKey}: People title-logo v2 name exceeds its vertical region.`);
  assert(actualNameGap === preset.separator.nameGap, `${person.stableKey}: People title-logo v2 name-to-secondary gap changed.`);
  assert(collectionTop + collection.bounds.height <= height - transparentPadding, `${person.stableKey}: People title-logo v2 fixed secondary block exceeds the bottom safe margin.`);

  const output = await runtime.sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  }).composite([
    { input: name.output, left: nameLeft, top: nameTop },
    { input: separatorBuffer, left: separatorLeft, top: separatorTop },
    { input: collection.output, left: collectionLeft, top: collectionTop },
  ]).png({
    compressionLevel: preset.output.compressionLevel,
    adaptiveFiltering: preset.output.adaptiveFiltering,
    palette: preset.output.palette,
  }).toBuffer();
  const metadata = await runtime.sharp(output, { failOn: "error" }).metadata();
  assert(metadata.format === "png" && metadata.width === width && metadata.height === height && metadata.hasAlpha === true && metadata.channels === 4, `${person.stableKey}: People title-logo v2 output is not exact RGBA PNG.`);
  assert(output.length < 1024 * 1024, `${person.stableKey}: People title-logo v2 exceeds the repository 1 MiB asset limit.`);

  return {
    output,
    record: {
      version: "people-title-logo-standard-canvas-record-v1",
      rendererVersion: PEOPLE_TITLE_LOGO_V2_RENDERER_VERSION,
      presetId: preset.id,
      presetHash: proofConfiguration.presetHash,
      status: preset.status,
      publicationAuthorised: preset.publicationAuthorised,
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationName: base.record.presentationName,
      canonicalNameLines: base.record.canonicalNameLines,
      presentationLines: base.record.presentationLines,
      lineBreakSource: base.record.lineBreakSource,
      nameFontFamily: fontRecord.family,
      nameFontWeight: fontRecord.weight,
      baseNameFontSize: base.record.finalFontSize,
      nameFontSize: name.fontSize,
      nameScaleFromBase: Number(name.scaleFromBase.toFixed(6)),
      nameSizingRule: preset.typography.sizingRule,
      lockedNameFontSize: preset.typography.fontSize,
      lineGapAdjustment: name.lineGapAdjustment,
      visibleLineGap: name.visibleLineGap,
      minimumVisibleLineGap: preset.typography.minimumVisibleLineGap,
      nameRegion: { ...nameRegion },
      baseNameBounds,
      nameBounds: { x: nameLeft, y: nameTop, width: name.width, height: name.height },
      separatorStyle: preset.separator.style,
      separatorBounds: { x: separatorLeft, y: separatorTop, width: preset.separator.width, height: preset.separator.height },
      nameToSeparatorGap: actualNameGap,
      separatorToCollectionGap: preset.separator.collectionGap,
      collectionText: preset.collection.text,
      collectionFontFamily: fontRecord.family,
      collectionFontWeight: preset.collection.weight,
      collectionFontSize: preset.collection.fontSize,
      collectionTracking: preset.collection.tracking,
      collectionBounds: { x: collectionLeft, y: collectionTop, width: collection.bounds.width, height: collection.bounds.height },
      transparentPadding,
      canvasRule: preset.output.canvas,
      visibleAlphaThreshold: preset.output.visibleAlphaThreshold,
      canvasWidth: width,
      canvasHeight: height,
      alphaTransparent: true,
      byteCount: output.length,
      outputHash: sha256(output),
      baseRendererVersion: base.record.rendererVersion,
      basePresetId: base.record.presetId,
      baseOutputHash: base.record.outputHash,
      fontHash: fontRecord.fontHash,
      fontLockHash: configuration.fontLockHash,
      ownerReviewStatus: "pending",
    },
  };
}
