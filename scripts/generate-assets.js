#!/usr/bin/env node
// Gera splash.png e icon.png a partir do path SVG da logo Alber.
// Uso: node scripts/generate-assets.js

const sharp = require('sharp')
const fs    = require('fs')
const path  = require('path')

const logoPathD = fs.readFileSync(
  path.join(__dirname, '../design/logo-path.txt'),
  'utf8',
).trim()

// Bounding box natural do path (calculado a partir das coordenadas)
const PATH_MIN_X = -309.10
const PATH_MIN_Y =   -1.83
const PATH_W     =  737.00
const PATH_H     =  702.36

function buildSVG(canvasW, canvasH, logoTargetH) {
  const scale   = logoTargetH / PATH_H
  const scaledW = PATH_W * scale

  // Translação para centralizar o path no canvas
  const tx = (canvasW - scaledW) / 2 - PATH_MIN_X * scale
  const ty = (canvasH - logoTargetH) / 2 - PATH_MIN_Y * scale

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <rect width="${canvasW}" height="${canvasH}" fill="#000000"/>
  <path
    d="${logoPathD}"
    fill="#FFFFFF"
    transform="translate(${tx.toFixed(4)}, ${ty.toFixed(4)}) scale(${scale.toFixed(6)})"
  />
</svg>`
}

async function run() {
  const assetsDir = path.join(__dirname, '../assets')

  // ── splash.png — 1242×2688 (iPhone 14 Pro Max @3x), logo ~400px alto ─────
  const splashSVG = buildSVG(1242, 2688, 400)
  await sharp(Buffer.from(splashSVG))
    .png()
    .toFile(path.join(assetsDir, 'splash.png'))
  console.log('✓  assets/splash.png  (1242×2688)')

  // ── icon.png — 1024×1024, logo ~600px alto ───────────────────────────────
  const iconSVG = buildSVG(1024, 1024, 600)
  await sharp(Buffer.from(iconSVG))
    .png()
    .toFile(path.join(assetsDir, 'icon.png'))
  console.log('✓  assets/icon.png    (1024×1024)')

  // ── android-icon-foreground.png — 1024×1024, logo ~500px (área safe 66%) ─
  const fgSVG = buildSVG(1024, 1024, 500)
  await sharp(Buffer.from(fgSVG))
    .png()
    .toFile(path.join(assetsDir, 'android-icon-foreground.png'))
  console.log('✓  assets/android-icon-foreground.png (1024×1024)')

  // ── android-icon-monochrome.png — cópia do foreground ────────────────────
  await sharp(Buffer.from(fgSVG))
    .png()
    .toFile(path.join(assetsDir, 'android-icon-monochrome.png'))
  console.log('✓  assets/android-icon-monochrome.png (1024×1024)')

  // ── favicon.png — 196×196 ─────────────────────────────────────────────────
  const faviconSVG = buildSVG(196, 196, 120)
  await sharp(Buffer.from(faviconSVG))
    .png()
    .toFile(path.join(assetsDir, 'favicon.png'))
  console.log('✓  assets/favicon.png (196×196)')

  console.log('\nDone.')
}

run().catch(err => {
  console.error('Erro ao gerar assets:', err.message)
  process.exit(1)
})
