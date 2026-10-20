# 音乐与音效时间轴

借鉴 pixel-brand-video 的 cue sheet、音效峰值对齐和分声部混音，结合 Remotion 的源裁切与时间轴延迟分离。每个时间点先换成一个全局帧号，用相同帧号驱动画面动作与音效。

先记录实际歌曲版本、音源起点、乐句/歌词区间和主要转折；不要用推测 BPM 代替实际对位。歌曲参考链接不是音源文件；没有可用歌曲仍能完成无声画面。BPM、变速、压缩和响度目标均不固定套用参考宣传片。

## 音效 cue

```json
{
  "frame":120,"kind":"sfx","note":"手指触碰星星；与接触画面同帧",
  "sound":{
    "path":"audio/touch.wav",
    "trimStartSeconds":0,"durationSeconds":0.6,"peakSeconds":0.25,
    "gainDb":-9,"status":"original","source":"真实原创或素材使用依据"
  }
}
```

60fps 下，frame 120 是成片第 2 秒。peakSeconds 是**裁切后素材**中目标峰值的位置；素材应提前到 1.75 秒开始播放。源裁切与成片延迟是不同参数。若提前量小于 0，脚本裁去片头之前的音效部分，而不是把整段向后平移导致峰值错位。延迟按 48kHz 采样点计算，避免毫秒取整引起累计偏移。源文件过短、状态不明确或路径越界时会报错。

## 分声部、淡出和测量

`mix` 与 `render` 使用同一个音频实现：

1. 根据音源起点裁切 BGM 并施加增益；依据 cue 裁切、短淡入淡出、延迟各音效。
2. 音效先合成独立声部并补静音到全片长度。开启 ducking 时用它压低 BGM，再合成；避免最后一个音效结束后截短后续音乐。只有音效、没有 BGM 时也可输出完整长度。
3. 根据 `audio.mix` 设置对完整混音淡出，再测量/处理响度。`targetLufs:null` 禁用归一化；省略整个 mix 对象保留旧版行为。
4. 保存 `premaster.wav`、`mixed.wav`、`mix-filter.txt`、`audio-cues.json` 和 `mix-report.json`。带音轨 MP4 导出后另测最终 AAC，不能只测无损中间文件。

两遍 loudnorm 的 true peak/LRA 约束可能使实际 LUFS 偏离目标；静音或极短音源会出现非有限测量值，跳过归一化并明确记录。`audio-output.json` 显示实际值和峰值目标是否满足；`technical.json` 的 noClipping 只检查最终音轨是否到达 0 dBTP，不代表配乐与人声平衡已获验收。不能仅修改报告状态代替听片。

新模板默认 -16 LUFS、-2 dBTP 与短片尾淡出，只是起点；不要把歌曲人声压得很低，音效也不应盖住重点歌词。每个动作都加响声会破坏节奏，关键接触/转折才用音效。未获用户要求不自动改变歌曲速度、音高或循环拼接。

实现参数核对依据：[FFmpeg 音频滤镜](https://ffmpeg.org/ffmpeg-filters.html#Audio-Filters)，尤其 adelay、apad、sidechaincompress 和 loudnorm。
