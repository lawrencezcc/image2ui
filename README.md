# Design2Code

## Project Memory

项目全局记忆只有两条，完整定义见 [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)：

- 项目目标：将 UI 参考图的效果 100% 还原复刻为可视化 UI 组件，支持 `dom`、`svg`、`canvas` 等主流的底层技术。
- 程序设计原则：遵守软件设计的 SOLID 原则。

## Notes

这个仓库当前实现的是一个面向“以图生组件”的实验性流水线，包含：

- `scene` 解析
- Vue SFC 生成
- 浏览器渲染截图
- 误差检测与 repair report
- 阶段归档、timeline 与预览页

后续所有模型选型、验证策略和底层渲染技术决策，都应以上述项目记忆为基准。

实现阶段顺序见 [ROADMAP.md](./ROADMAP.md)。
