import { createCanvas } from 'canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 390
const HEIGHT = 844
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const screenshots = [
  { file: 'screenshot-menu.png', subtitle: 'Browse the interactive menu' },
  { file: 'screenshot-order.png', subtitle: 'Track your order in real time' },
]

function drawScreenshot(subtitle) {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const context = canvas.getContext('2d')

  context.fillStyle = '#0a0a0f'
  context.fillRect(0, 0, WIDTH, HEIGHT)

  context.fillStyle = '#B8860B'
  context.fillRect(95, 354, 200, 4)

  context.fillStyle = '#ffffff'
  context.font = 'bold 42px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('Menuverse', WIDTH / 2, HEIGHT / 2)

  context.fillStyle = '#b8b8c0'
  context.font = '16px sans-serif'
  context.fillText(subtitle, WIDTH / 2, HEIGHT / 2 + 48)

  return canvas.toBuffer('image/png')
}

await mkdir(resolve(rootDir, 'public'), { recursive: true })

for (const screenshot of screenshots) {
  const outputPath = resolve(rootDir, 'public', screenshot.file)
  await writeFile(outputPath, drawScreenshot(screenshot.subtitle))
  console.log(`Generated ${outputPath}`)
}
