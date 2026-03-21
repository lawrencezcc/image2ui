<script setup>
import { onMounted } from 'vue'
import { createCanvasBindings } from '../canvas-runtime'

const canvasSpecs = {
  "chart-canvas": {
    "kind": "donut",
    "width": 180,
    "height": 180,
    "plot": {
      "x": 0,
      "y": 0,
      "width": 180,
      "height": 180,
      "rotation": 0
    },
    "categories": [],
    "min": 0,
    "max": 120,
    "step": 30,
    "innerRadiusRatio": 0.58,
    "legendItems": [
      {
        "name": "学习",
        "color": "#1790ff"
      },
      {
        "name": "睡觉",
        "color": "#12c2c1"
      },
      {
        "name": "吃饭",
        "color": "#30c25b"
      },
      {
        "name": "讲礼貌",
        "color": "#facc15"
      },
      {
        "name": "其他",
        "color": "#f04964"
      },
      {
        "name": "运动",
        "color": "#8443e0"
      },
      {
        "name": "暂无备注",
        "color": "#3436c7"
      }
    ],
    "series": [
      {
        "name": "学习",
        "color": "#1790ff",
        "fillColor": "#3399FF",
        "data": [
          20
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "睡觉",
        "color": "#12c2c1",
        "fillColor": "#00CCCC",
        "data": [
          100
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "吃饭",
        "color": "#30c25b",
        "fillColor": "#00CC00",
        "data": [
          10
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "讲礼貌",
        "color": "#facc15",
        "fillColor": "#FFCC00",
        "data": [
          30
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "其他",
        "color": "#f04964",
        "fillColor": "#FF3366",
        "data": [
          10
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "运动",
        "color": "#8443e0",
        "fillColor": "#9933CC",
        "data": [
          20
        ],
        "points": [],
        "areaOpacity": 0.18
      },
      {
        "name": "暂无备注",
        "color": "#3436c7",
        "fillColor": "#333399",
        "data": [
          10
        ],
        "points": [],
        "areaOpacity": 0.18
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
    style="position:relative;width:1104px;height:780px;background:#FFFFFF;overflow:visible;border-radius:24px;box-sizing:border-box"
  >
    <div data-node-id="card" style="position:absolute;left:0px;top:0px;width:1104px;height:780px;z-index:0;opacity:1;overflow:visible;background:#FFFFFF;white-space:nowrap"></div>
<canvas data-node-id="chart-canvas" :ref="setCanvasRef('chart-canvas')" width="180" height="180" style="position:absolute;left:584px;top:377px;width:180px;height:180px;z-index:10;opacity:1;overflow:visible;background:transparent;white-space:nowrap"></canvas>
<div data-node-id="legend-0-stage-swatch" style="position:absolute;left:40px;top:69px;width:14px;height:14px;z-index:20;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#1790ff;white-space:nowrap"></div>
<div data-node-id="legend-0-stage-text" style="position:absolute;left:66px;top:55px;width:73px;height:43px;z-index:21;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">学习</div>
<div data-node-id="legend-1-stage-swatch" style="position:absolute;left:251px;top:69px;width:14px;height:14px;z-index:22;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#12c2c1;white-space:nowrap"></div>
<div data-node-id="legend-1-stage-text" style="position:absolute;left:277px;top:55px;width:72px;height:43px;z-index:23;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">睡觉</div>
<div data-node-id="legend-2-stage-swatch" style="position:absolute;left:457px;top:69px;width:14px;height:14px;z-index:24;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#30c25b;white-space:nowrap"></div>
<div data-node-id="legend-2-stage-text" style="position:absolute;left:483px;top:55px;width:73px;height:43px;z-index:25;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">吃饭</div>
<div data-node-id="legend-3-stage-swatch" style="position:absolute;left:664px;top:69px;width:14px;height:14px;z-index:26;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#facc15;white-space:nowrap"></div>
<div data-node-id="legend-3-stage-text" style="position:absolute;left:690px;top:55px;width:111px;height:43px;z-index:27;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">讲礼貌</div>
<div data-node-id="legend-4-stage-swatch" style="position:absolute;left:871px;top:69px;width:14px;height:14px;z-index:28;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#f04964;white-space:nowrap"></div>
<div data-node-id="legend-4-stage-text" style="position:absolute;left:897px;top:55px;width:73px;height:43px;z-index:29;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">其他</div>
<div data-node-id="legend-5-stage-swatch" style="position:absolute;left:42px;top:136px;width:14px;height:14px;z-index:30;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#8443e0;white-space:nowrap"></div>
<div data-node-id="legend-5-stage-text" style="position:absolute;left:68px;top:122px;width:73px;height:43px;z-index:31;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">运动</div>
<div data-node-id="legend-6-stage-swatch" style="position:absolute;left:248px;top:136px;width:14px;height:14px;z-index:32;opacity:1;overflow:hidden;border-radius:8px 8px 8px 8px;background:#3436c7;white-space:nowrap"></div>
<div data-node-id="legend-6-stage-text" style="position:absolute;left:274px;top:122px;width:145px;height:43px;z-index:33;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">暂无备注</div>
<div data-node-id="ocr-7-stage" style="position:absolute;left:57px;top:230px;width:145px;height:42px;z-index:34;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">暂无备注</div>
<div data-node-id="ocr-8-stage" style="position:absolute;left:976px;top:238px;width:72px;height:42px;z-index:35;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">学习</div>
<div data-node-id="ocr-9-10-00" style="position:absolute;left:55px;top:291px;width:95px;height:31px;z-index:36;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$10.00</div>
<div data-node-id="ocr-10-stage" style="position:absolute;left:57px;top:327px;width:73px;height:43px;z-index:37;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">运动</div>
<div data-node-id="ocr-11-20-00" style="position:absolute;left:55px;top:387px;width:95px;height:31px;z-index:38;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$20.00</div>
<div data-node-id="ocr-12-stage" style="position:absolute;left:57px;top:422px;width:73px;height:42px;z-index:39;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">其他</div>
<div data-node-id="ocr-13-10-00" style="position:absolute;left:55px;top:483px;width:95px;height:31px;z-index:40;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$10.00</div>
<div data-node-id="ocr-14-stage" style="position:absolute;left:60px;top:518px;width:107px;height:42px;z-index:41;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">讲礼貌</div>
<div data-node-id="ocr-15-30-00" style="position:absolute;left:55px;top:579px;width:95px;height:31px;z-index:42;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$30.00</div>
<div data-node-id="ocr-16-stage" style="position:absolute;left:57px;top:614px;width:73px;height:42px;z-index:43;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">吃饭</div>
<div data-node-id="ocr-17-10-00" style="position:absolute;left:55px;top:675px;width:95px;height:31px;z-index:44;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$10.00</div>
<div data-node-id="ocr-18-20-00" style="position:absolute;left:955px;top:299px;width:96px;height:31px;z-index:45;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$20.00</div>
<div data-node-id="ocr-19-stage" style="position:absolute;left:976px;top:543px;width:72px;height:43px;z-index:46;opacity:1;overflow:visible;background:transparent;color:#4B5563;font-family:Arial;font-size:28px;font-weight:500;line-height:34px;letter-spacing:0px;white-space:nowrap;text-align:left">睡觉</div>
<div data-node-id="ocr-20-100-00" style="position:absolute;left:939px;top:605px;width:110px;height:31px;z-index:47;opacity:1;overflow:visible;background:transparent;color:#475467;font-family:Arial;font-size:23px;font-weight:600;line-height:28px;letter-spacing:0px;white-space:nowrap;text-align:left">$100.00</div>
<svg data-node-id="callout-0-stage" style="position:absolute;left:692.5754615162455px;top:276px;width:281.42453848375453px;height:117.20913959861679px;z-index:48;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 281.42453848375453 117.20913959861679">
  <polyline fill="none" stroke="#1790ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="8,109.20913959861679 36,8 273.42453848375453,8" />
  <circle cx="8" cy="109.20913959861679" r="5" fill="#1790ff" />
</svg>
<svg data-node-id="callout-1-stage" style="position:absolute;left:735.5754615162455px;top:509.5495316971527px;width:238.42453848375453px;height:88.4504683028473px;z-index:49;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 238.42453848375453 88.4504683028473">
  <polyline fill="none" stroke="#12c2c1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="8,8 36,80.4504683028473 230.42453848375453,80.4504683028473" />
  <circle cx="8" cy="8" r="5" fill="#12c2c1" />
</svg>
<svg data-node-id="callout-2-stage" style="position:absolute;left:558px;top:94px;width:63.18881681795688px;height:441.8111831820431px;z-index:50;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63.18881681795688 441.8111831820431">
  <polyline fill="none" stroke="#30c25b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="55.18881681795688,433.8111831820431 27.188816817956877,8 8,8" />
  <circle cx="55.18881681795688" cy="433.8111831820431" r="5" fill="#30c25b" />
</svg>
<svg data-node-id="callout-3-stage" style="position:absolute;left:581.0588027088181px;top:94px;width:106.94119729118188px;height:394.45336399345985px;z-index:51;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 106.94119729118188 394.45336399345985">
  <polyline fill="none" stroke="#facc15" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="8,386.45336399345985 36,8 98.94119729118188,8" />
  <circle cx="8" cy="386.45336399345985" r="5" fill="#facc15" />
</svg>
<svg data-node-id="callout-4-stage" style="position:absolute;left:132px;top:419.956817022399px;width:473.3734389198004px;height:56.04318297760102px;z-index:52;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 473.3734389198004 56.04318297760102">
  <polyline fill="none" stroke="#f04964" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="465.3734389198004,8 437.3734389198004,48.04318297760102 8,48.04318297760102" />
  <circle cx="465.3734389198004" cy="8" r="5" fill="#f04964" />
</svg>
<svg data-node-id="callout-5-stage" style="position:absolute;left:132px;top:366px;width:499.4504683028473px;height:39.42453848375453px;z-index:53;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 499.4504683028473 39.42453848375453">
  <polyline fill="none" stroke="#8443e0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="491.4504683028473,31.42453848375453 463.4504683028473,8 8,8" />
  <circle cx="491.4504683028473" cy="31.42453848375453" r="5" fill="#8443e0" />
</svg>
<svg data-node-id="callout-6-stage" style="position:absolute;left:421px;top:161px;width:247.5466360065401px;height:229.05880270881818px;z-index:54;opacity:1;overflow:visible;background:transparent;white-space:nowrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 247.5466360065401 229.05880270881818">
  <polyline fill="none" stroke="#3436c7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="239.5466360065401,221.05880270881818 211.5466360065401,8 8,8" />
  <circle cx="239.5466360065401" cy="221.05880270881818" r="5" fill="#3436c7" />
</svg>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
