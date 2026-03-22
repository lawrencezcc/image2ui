<script setup>
import { onMounted } from 'vue'
import { createCanvasBindings } from '../canvas-runtime'

const canvasSpecs = {
  "chart-canvas": {
    "kind": "pie",
    "width": 260,
    "height": 260,
    "plot": {
      "x": 0,
      "y": 0,
      "width": 260,
      "height": 260,
      "rotation": 0
    },
    "categories": [
      "2010-01-10",
      "2013-11-13",
      "2017-09-17"
    ],
    "min": 30,
    "max": 150,
    "step": 30,
    "innerRadiusRatio": 0.58,
    "legendItems": [
      {
        "name": "能源",
        "color": "#1790ff"
      },
      {
        "name": "金属",
        "color": "#30c25b"
      },
      {
        "name": "农副产品",
        "color": "#facc15"
      }
    ],
    "series": [
      {
        "name": "能源",
        "color": "#1790ff",
        "fillColor": "#0066FF",
        "data": [],
        "points": [
          {
            "x": 0,
            "y": 0.42
          },
          {
            "x": 0.5,
            "y": 0.55
          },
          {
            "x": 1,
            "y": 0.32
          }
        ],
        "areaOpacity": 0.18,
        "lineDash": [
          8,
          6
        ]
      },
      {
        "name": "金属",
        "color": "#30c25b",
        "fillColor": "#00AA00",
        "data": [],
        "points": [
          {
            "x": 0,
            "y": 0.45
          },
          {
            "x": 0.5,
            "y": 0.5
          },
          {
            "x": 1,
            "y": 0.35
          }
        ],
        "areaOpacity": 0.18,
        "lineDash": [
          8,
          6
        ]
      },
      {
        "name": "农副产品",
        "color": "#facc15",
        "fillColor": "#FFC000",
        "data": [],
        "points": [
          {
            "x": 0,
            "y": 0.43
          },
          {
            "x": 0.5,
            "y": 0.52
          },
          {
            "x": 1,
            "y": 0.34
          }
        ],
        "areaOpacity": 0.18,
        "lineDash": [
          8,
          6
        ]
      }
    ],
    "overlays": []
  }
}
const { setCanvasRef, drawAll } = createCanvasBindings()

onMounted(() => {
  drawAll(canvasSpecs)
})
</script>

<template>
  <div
    data-artboard-root="true"
    style="position:relative;width:1258px;height:876px;background:#FFFFFF;overflow:visible;border-radius:24px;box-sizing:border-box"
  >
    <div data-node-id="card" style="position:absolute;left:0px;top:0px;width:1258px;height:876px;z-index:0;opacity:1;overflow:visible;background:#FFFFFF;white-space:nowrap"></div>
<canvas data-node-id="chart-canvas" :ref="setCanvasRef('chart-canvas')" width="260" height="260" style="position:absolute;left:653px;top:352px;width:260px;height:260px;z-index:10;opacity:1;overflow:visible;background:transparent;white-space:nowrap"></canvas>
<div data-node-id="legend-0-stage-swatch" style="position:absolute;left:108px;top:67px;width:14px;height:14px;z-index:20;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#1790ff;white-space:nowrap"></div>
<div data-node-id="legend-0-stage-text" style="position:absolute;left:134px;top:50px;width:89px;height:49px;z-index:21;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">能源</div>
<div data-node-id="legend-1-stage-swatch" style="position:absolute;left:510px;top:67px;width:14px;height:14px;z-index:22;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#30c25b;white-space:nowrap"></div>
<div data-node-id="legend-1-stage-text" style="position:absolute;left:536px;top:50px;width:89px;height:49px;z-index:23;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">金属</div>
<div data-node-id="legend-2-stage-swatch" style="position:absolute;left:915px;top:67px;width:14px;height:14px;z-index:24;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#facc15;white-space:nowrap"></div>
<div data-node-id="legend-2-stage-text" style="position:absolute;left:941px;top:50px;width:170px;height:49px;z-index:25;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">农副产品</div>
<div data-node-id="x-0-2010-01-10" style="position:absolute;left:105px;top:798px;width:193px;height:37px;z-index:26;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:27px;font-weight:500;line-height:33px;letter-spacing:0px;white-space:nowrap;text-align:left">2010-01-10</div>
<div data-node-id="x-1-2013-11-13" style="position:absolute;left:568px;top:798px;width:194px;height:37px;z-index:27;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:27px;font-weight:500;line-height:33px;letter-spacing:0px;white-space:nowrap;text-align:left">2013-11-13</div>
<div data-node-id="x-2-2017-09-17" style="position:absolute;left:1032px;top:798px;width:193px;height:37px;z-index:28;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:27px;font-weight:500;line-height:33px;letter-spacing:0px;white-space:nowrap;text-align:left">2017-09-17</div>
<div data-node-id="tick-0-30" style="position:absolute;left:33px;top:749px;width:50px;height:35px;z-index:29;opacity:1;overflow:visible;background:transparent;color:#98A2B3;font-family:Arial;font-size:26px;font-weight:400;line-height:32px;letter-spacing:0px;white-space:nowrap;text-align:left">30</div>
<div data-node-id="tick-1-60" style="position:absolute;left:33px;top:600px;width:50px;height:35px;z-index:30;opacity:1;overflow:visible;background:transparent;color:#98A2B3;font-family:Arial;font-size:26px;font-weight:400;line-height:32px;letter-spacing:0px;white-space:nowrap;text-align:left">60</div>
<div data-node-id="tick-2-90" style="position:absolute;left:33px;top:450px;width:50px;height:35px;z-index:31;opacity:1;overflow:visible;background:transparent;color:#98A2B3;font-family:Arial;font-size:26px;font-weight:400;line-height:32px;letter-spacing:0px;white-space:nowrap;text-align:left">90</div>
<div data-node-id="tick-3-120" style="position:absolute;left:19px;top:299px;width:63px;height:35px;z-index:32;opacity:1;overflow:visible;background:transparent;color:#98A2B3;font-family:Arial;font-size:26px;font-weight:400;line-height:32px;letter-spacing:0px;white-space:nowrap;text-align:left">120</div>
<div data-node-id="tick-4-150" style="position:absolute;left:19px;top:149px;width:63px;height:35px;z-index:33;opacity:1;overflow:visible;background:transparent;color:#98A2B3;font-family:Arial;font-size:26px;font-weight:400;line-height:32px;letter-spacing:0px;white-space:nowrap;text-align:left">150</div>
<svg data-node-id="callout-0-stage" style="position:absolute;left:225px;top:95px;width:566px;height:269px;z-index:34;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 566 269">
  <polyline fill="none" stroke="#1790ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="558,261 530,8 8,8" />
  <circle cx="558" cy="261" r="5" fill="#1790ff" />
</svg>
<svg data-node-id="callout-1-stage" style="position:absolute;left:627px;top:95px;width:164px;height:269px;z-index:35;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 269">
  <polyline fill="none" stroke="#30c25b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="156,261 128,8 8,8" />
  <circle cx="156" cy="261" r="5" fill="#30c25b" />
</svg>
<svg data-node-id="callout-2-stage" style="position:absolute;left:775px;top:95px;width:164px;height:269px;z-index:36;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 269">
  <polyline fill="none" stroke="#facc15" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="8,261 36,8 156,8" />
  <circle cx="8" cy="261" r="5" fill="#facc15" />
</svg>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
