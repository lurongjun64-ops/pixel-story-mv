# GitHub 调研与选型

检索日期：2026-10-21。查看了仓库搜索、网页搜索及以下实际 SKILL.md/README；本次范围内未找到直接覆盖“像素角色＋游戏数值叙事＋歌曲时间轴＋成片检查”的单一技能。这不代表 GitHub 上绝不存在。

| 候选 | 已核对的内容 | 适配判断 |
|---|---|---|
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | 官方 README，包含创建、动画、字幕、预览、渲染等技能；本机已有对应技能 | 复用通用视频知识；缺少本题的像素叙事与素材契约 |
| [willibrandon/pixel-plugin 的 pixel-art-animator](https://github.com/willibrandon/pixel-plugin/blob/main/skills/pixel-art-animator/SKILL.md) | 帧时长、动画标签、步行循环、linked cels；调用专用 Aseprite MCP | 适合精灵动画，未覆盖 MV；当前会话未提供这些 Aseprite MCP 工具 |
| [thedes13/pixel-brand-video](https://github.com/thedes13/pixel-brand-video/blob/main/pixel-brand-video/SKILL.md) | 30 秒 16:9 品牌宣传模板，依赖 HyperFrames，并附音频混音流程 | 最接近的完整视频技能，但故事结构为品牌介绍、成本对比与 Logo，不能直接等同歌曲叙事 MV |
| [ervareza/agent-skill-pixel-art](https://github.com/ervareza/agent-skill-pixel-art/blob/v4.3.0/skills/pixel-art/SKILL.md) | 像素素材、色板、sprite sheet、审计与导出工具 | 可作资产阶段候选，未覆盖音乐叙事成片；没有安装以免扩大自动触发范围 |

本技能的模板、渲染脚本和工作流独立编写，没有复制第三方仓库代码。没有安装上述第三方依赖、改写现有 Remotion 技能或替换科普技能。用低依赖 Canvas 骨架使普通场景可直接运行；复杂工程仍可使用已装的官方 Remotion 技能。

## 1.1.0 深入阅读与落地

2026-10-21 继续读取实际实现，而非只读 README：

| 读到的具体文件 | 吸收的部分 | 本地落地与边界 |
|---|---|---|
| [pixel-art/quality_audit.py](https://github.com/ervareza/agent-skill-pixel-art/blob/v4.3.0/skills/pixel-art/scripts/quality_audit.py)、[sprite_conventions.md](https://github.com/ervareza/agent-skill-pixel-art/blob/v4.3.0/skills/pixel-art/references/sprite_conventions.md) | 透明边缘、色板、单元规格、具名动作 | 重写成可在浏览器和 Node 测试中共用的 `assets/starter/pixel-art.mjs`；采用精确色板匹配，孤立像素只警告，避免误杀合法星点；审计对象限定原生 PNG |
| [pixel-art-animator/SKILL.md](https://github.com/willibrandon/pixel-plugin/blob/main/skills/pixel-art-animator/SKILL.md) | 不均匀帧时长、动作标签、往返循环、静态背景复用 | 同一原创 PNG 的 idle/walk 标签和逐格 durations；采样纯粹由局部帧决定，支持 forward/ping-pong/hold；不依赖其 Aseprite MCP |
| [pixel-brand-video/build_mix.py](https://github.com/thedes13/pixel-brand-video/blob/main/pixel-brand-video/assets/audio-pipeline/build_mix.py)、[mixing-notes.md](https://github.com/thedes13/pixel-brand-video/blob/main/pixel-brand-video/references/mixing-notes.md) | 以音效峰值而非文件起点对拍、SFX 声部、sidechain、补齐总时长、两遍响度测量 | 重写 `scripts/audio.mjs`：使用采样点延迟、负预卷裁切、完整时长声部、可选音乐压低/响度/淡出、最终 AAC 测量；不用其固定曲目 ID、BPM、音效配置或自动变速 |
| [Remotion audio.md](https://github.com/remotion-dev/skills/blob/039e8a2fc78b67efc228d5645367838b85818a1c/skills/remotion-markup/audio.md)、[sequencing.md](https://github.com/remotion-dev/skills/blob/039e8a2fc78b67efc228d5645367838b85818a1c/skills/remotion-markup/sequencing.md) | 分清素材裁切点与成片延迟；把独立媒体放在可编辑时间边界 | BGM 的 offsetSeconds 与 cue 的全局 frame 分开，画面与音效共用帧号；新增 inspect 与 mix，支持先查关键帧、单独调声音 |

通过 GitHub 连接器读取上述文件，仅执行本地重新编写的代码。未将远端技能中“必须如何做”的措辞当成用户授权或本技能的通用规则。所有美术、音乐参数依故事与用户选择调整。
