# 工程与时间轴

`init` 将 `assets/starter/` 复制到一个尚不存在的作品目录；拒绝覆盖已有目录。先修改 `episode.json`，再按实际故事扩展 `index.html` 的场景和绘画函数。不要直接编辑技能里的 starter 来制作每一期。

## 命令

```bash
node <技能目录>/scripts/pixel-mv.mjs init <新作品目录>
node <技能目录>/scripts/pixel-mv.mjs validate <作品目录>
node <技能目录>/scripts/pixel-mv.mjs inspect <作品目录>
node <技能目录>/scripts/pixel-mv.mjs mix <作品目录> <新音频输出目录>
# 预览：在作品目录启动本地服务，用浏览器打开 index.html
python3 -m http.server 8765 --bind 127.0.0.1 --directory <作品目录>
# 用户要 MP4 时；技能自测可导出短测试工程
node <技能目录>/scripts/pixel-mv.mjs render <作品目录>
```

`render` 只绑定随机的本地回环端口，使用独立无登录浏览器读取本作品，输出到唯一的 `renders/<时间戳>/`，不覆盖历史视频。可用 `PIXEL_RENDER_DIR` 指定一个尚不存在的输出目录。测试、修改字幕或裁切后要重跑相应检查。

运行时检测：

- Node 22+；优先通过 `load_workspace_dependencies` 发现本机路径。
- Playwright：先尝试当前工程，再尝试环境变量 `PIXEL_PLAYWRIGHT`（包目录或入口文件），使用仓库安装的 Playwright。
- Chromium：`PIXEL_CHROMIUM`，或 Playwright 自己的浏览器缓存。不存在时清楚报错，不静默联网下载。
- FFmpeg/ffprobe：`PIXEL_FFMPEG`、`PIXEL_FFPROBE`，否则 PATH。

通过环境变量指向本机已有工具，例如 `PIXEL_FFMPEG=/path/to/ffmpeg`；不同机器使用各自的实际路径。

可在单次命令中加这些环境变量，不写入 shell 配置。工具参数通过进程参数数组传递，不拼接 shell 命令。初始模板只使用本机系统字体；交付其他机器时应提供获准的字体并等待其加载。

## episode.json 契约（v1）

- `width/height`：输出像素，正偶数。`logicalWidth/logicalHeight`：整数逻辑像素；宽高放大倍率必须相同且为整数。模板默认 960×540、320×180；发布时可用 1920×1080、320×180。竖版示例为 1080×1920、180×320，需看实际排版。
- `fps`：合成帧率，默认 60。`durationFrames`：正整数，时长为它除以 fps。
- `scenes`：从 0 连续覆盖至 durationFrames，半开区间 `[start,end)`，不得有空洞、重叠、重复 id。`place` 为模板支持的 `station/workshop/rooftop`；新场景在 `drawWorld()` 中实现并同步 validator 的场景列表。
- `hero`：`fromX/toX` 为逻辑画幅宽度比例；`action` 为 `idle/walk`；`stepFps` 控制精灵低帧率动作。所有位置由当前帧重新计算。
- `hero.spriteId` 可选：引用 `art.assets` 的 PNG 精灵表，使用其具名动作与每帧停留时长；存在时衣着由 PNG 决定，`coat/stepFps` 仅供无精灵表的旧版程序人物使用。详见 [素材与动作](art-and-motion.md)。现有 v1 工程不添加这些字段也能继续导出。
- `stats.light/time`：每场一个 `[初值,终值]`，每帧插值；是演示剧情指标，不是真实数据。改指标含义时同时改 HUD 与可见故事。
- `captions`：全局帧号的 `[start,end)`、`text`。区间有序、不重叠；按字形实际宽度换行。完整句保留显示，场景动作负责主要节奏。
- `cues`：全局 `frame`、`kind`、`note`；用于记录乐句/动作/音效锚点。普通 cue 仅记事件；添加 `sound` 对象后才会实际混音，其 `peakSeconds` 将素材内峰值对齐到该 `frame`。详见 [音乐与音效时间轴](audio-timeline.md)。不自动生成或下载音效。
- `audio`：`path` 为作品内相对路径，`offsetSeconds` 为音源裁切起点，`gainDb` 为增益；`status` 为 `missing/user-authorized/licensed/original`，后面三项必须有 `source` 记录。只在用户确实授权或来源证据成立后标注，不为通过校验自行改状态。脚本会检查文件和音源剩余时长，过短时报错；不自动循环或变速。
- `audio.mix` 可选：`ducking`、`fadeOutSeconds`、`targetLufs`（null 禁用）与 `truePeakDb`。新模板启用音效触发的音乐压低、0.4 秒淡出和两遍响度处理；旧工程省略此对象时保留简单增益行为。没有 BGM 但有 `cue.sound` 时也会输出有声视频。

## 浏览器绘制契约

`window.ready` 等待 JSON 和字体就绪；`window.renderFrame(frame)` 清除并重绘整个画布；`window.getDiagnostics()` 返回文字溢出项。渲染前设置 `window.__RENDER_MODE__=true` 关闭实时播放。外部图片扩展后也必须纳入 ready，并用本地路径；不要在渲染过程中请求远程生成服务。

输出 `qa/determinism.json` 用跳帧前后同一帧的 PNG 哈希检查绘制是否一致；`qa/assets.json` 保存原生 PNG 的色板、透明度和单元边界审计；`qa/technical.json` 核验视频帧数、尺寸、帧率、时长、音轨及音视频全片解码；`qa/key-*.png` 为每场首、中、尾帧。混音额外保留声部合成图、cue 表、预混音/混音 WAV、混音前后响度及最终 AAC 音轨测量。报告中的 `visualReview/audioReview` 默认未验证，实际完整观看/聆听后单独记录结果。

脚本维护后运行 `node <技能目录>/scripts/test.mjs`；它检查时间轴错误、变长动作、像素审计、音效峰值与负预卷等行为。改音频滤镜后还须用短音频实际混音，改绘图后用 `inspect` 与短片导出检查，不能以单元测试代替媒体检查。

## 改为 Remotion

需要 Studio 编辑时读取已安装 `remotion-best-practices`，由 `useCurrentFrame()` 调用相同场景绘制逻辑。保持整数像素坐标与独立清晰字幕，不把 Canvas 的 `requestAnimationFrame` 带入离线时间轴。音源放作品本地媒体目录，用同一个帧时间轴计算音频裁切和字幕，记录适配后的实际导出证据。
