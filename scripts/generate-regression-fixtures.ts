import path from 'node:path'

import sharp from 'sharp'

import { ensureDir } from '../src/pipeline/utils'

function wrapSvg(width: number, height: number, inner: string) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#ffffff" />
    ${inner}
  </svg>
  `.trim()
}

async function writeSvgPng(filePath: string, svg: string) {
  await ensureDir(path.dirname(filePath))
  await sharp(Buffer.from(svg)).png().toFile(filePath)
}

async function main() {
  const outputDir = path.resolve('test-inputs')
  const areaPath = path.join(outputDir, 'fixture-f2-area.png')
  const scatterPath = path.join(outputDir, 'fixture-f2-scatter.png')

  const areaSvg = wrapSvg(
    1200,
    820,
    `
    <g font-family="Arial" fill="#4B5563">
      <circle cx="84" cy="52" r="10" fill="#2F80ED" />
      <text x="108" y="60" font-size="34">North</text>
      <circle cx="264" cy="52" r="10" fill="#39C1C9" />
      <text x="288" y="60" font-size="34">South</text>
      <text x="516" y="780" font-size="34">Month</text>
      <g transform="translate(64 430) rotate(-90)">
        <text x="0" y="0" font-size="34">Revenue</text>
      </g>
    </g>
    <g stroke="#E8EDF5" stroke-width="2" stroke-dasharray="6 10">
      <line x1="120" y1="700" x2="1120" y2="700" />
      <line x1="120" y1="570" x2="1120" y2="570" />
      <line x1="120" y1="440" x2="1120" y2="440" />
      <line x1="120" y1="310" x2="1120" y2="310" />
      <line x1="120" y1="180" x2="1120" y2="180" />
    </g>
    <g font-family="Arial" fill="#98A2B3" font-size="28">
      <text x="84" y="708">0</text>
      <text x="72" y="578">25</text>
      <text x="72" y="448">50</text>
      <text x="72" y="318">75</text>
      <text x="56" y="188">100</text>
      <text x="160" y="760">Jan.</text>
      <text x="330" y="760">Feb.</text>
      <text x="500" y="760">Mar.</text>
      <text x="670" y="760">Apr.</text>
      <text x="840" y="760">May</text>
      <text x="1000" y="760">Jun.</text>
    </g>
    <path d="M 150 680 L 315 590 L 485 460 L 655 360 L 825 400 L 995 250 L 995 700 L 150 700 Z" fill="#2F80ED" fill-opacity="0.16" />
    <path d="M 150 620 L 315 550 L 485 520 L 655 430 L 825 300 L 995 340 L 995 700 L 150 700 Z" fill="#39C1C9" fill-opacity="0.16" />
    <path d="M 150 680 L 315 590 L 485 460 L 655 360 L 825 400 L 995 250" fill="none" stroke="#2F80ED" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 150 620 L 315 550 L 485 520 L 655 430 L 825 300 L 995 340" fill="none" stroke="#39C1C9" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
    `,
  )

  const scatterSvg = wrapSvg(
    1180,
    840,
    `
    <g font-family="Arial" fill="#4B5563">
      <circle cx="86" cy="52" r="10" fill="#2F80ED" />
      <text x="110" y="60" font-size="34">Alpha</text>
      <circle cx="270" cy="52" r="10" fill="#39C1C9" />
      <text x="294" y="60" font-size="34">Beta</text>
      <text x="520" y="792" font-size="34">Efficiency</text>
      <g transform="translate(64 430) rotate(-90)">
        <text x="0" y="0" font-size="34">Growth</text>
      </g>
    </g>
    <g stroke="#E8EDF5" stroke-width="2" stroke-dasharray="6 10">
      <line x1="130" y1="720" x2="1080" y2="720" />
      <line x1="130" y1="560" x2="1080" y2="560" />
      <line x1="130" y1="400" x2="1080" y2="400" />
      <line x1="130" y1="240" x2="1080" y2="240" />
      <line x1="130" y1="120" x2="1080" y2="120" />
      <line x1="130" y1="120" x2="130" y2="720" />
      <line x1="360" y1="120" x2="360" y2="720" />
      <line x1="590" y1="120" x2="590" y2="720" />
      <line x1="820" y1="120" x2="820" y2="720" />
      <line x1="1080" y1="120" x2="1080" y2="720" />
    </g>
    <g font-family="Arial" fill="#98A2B3" font-size="28">
      <text x="86" y="728">0</text>
      <text x="62" y="568">25</text>
      <text x="62" y="408">50</text>
      <text x="62" y="248">75</text>
      <text x="44" y="128">100</text>
      <text x="116" y="770">0.0</text>
      <text x="344" y="770">0.25</text>
      <text x="566" y="770">0.5</text>
      <text x="796" y="770">0.75</text>
      <text x="1048" y="770">1.0</text>
    </g>
    <g fill="#2F80ED" fill-opacity="0.82">
      <circle cx="230" cy="620" r="13" />
      <circle cx="344" cy="510" r="13" />
      <circle cx="470" cy="430" r="13" />
      <circle cx="620" cy="310" r="13" />
      <circle cx="910" cy="240" r="13" />
    </g>
    <g fill="#39C1C9" fill-opacity="0.82">
      <circle cx="290" cy="660" r="13" />
      <circle cx="430" cy="540" r="13" />
      <circle cx="590" cy="470" r="13" />
      <circle cx="760" cy="300" r="13" />
      <circle cx="980" cy="200" r="13" />
    </g>
    `,
  )

  await writeSvgPng(areaPath, areaSvg)
  await writeSvgPng(scatterPath, scatterSvg)

  console.log(JSON.stringify({ areaPath, scatterPath }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
