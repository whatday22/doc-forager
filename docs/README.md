# docs/

这个目录放**给 GitHub 首页看的素材**。

## 需要你补的文件

| 文件名 | 用途 | README 里的引用 |
|---|---|---|
| `demo.gif` | 首页首图，**最重要** | `![界面演示](docs/demo.gif)` |
| `shot-*.png` | 正文里分功能展示的截图 | 按需在 README 里加 `![](...)` |

> ⚠️ **`demo.gif` 现在还不存在**，所以 GitHub 上 README 首图会显示成裂图。
> 录好放进来、连同这一次提交推上去就好了。

## 怎么录 demo.gif（Windows，全程免费）

### 方案 A：ScreenToGif（推荐，能直接导出 GIF）

1. 装 [ScreenToGif](https://www.screentogif.com/)（开源）
2. 打开 `index.html`，**先按 `F` 全屏**，把窗口调到 1280×720 左右
3. ScreenToGif → 新建录制 → 框住整个画布区域
4. 录这 15 秒（照着做，节奏刚好）：
   - 把 `测试样本/经营分析报告.docx` 拖进左上角虚线框
   - 在编辑区打 `营收 毛利率 用户数`
   - `Ctrl+Enter`
   - 让它跑 3~4 秒（虫子爬行、卡片逐条弹出）
   - 点左下 **▤ 覆盖率自检**，浮层停 2 秒
   - 收尾：鼠标挪到虫子身上，等它冒出「我可是赛博虫，不是草履虫！」
5. 导出 → 帧率 **12~15 fps**、宽度 **960~1280**（超过 10 MB 会加载很慢）
6. 存成 `docs/demo.gif`

### 方案 B：Xbox Game Bar（系统自带，只能录 MP4）

`Win` + `Alt` + `R` 开始/停止录制，视频存在 `视频/捕获/`。
再用 ScreenToGif 或 [ezgif](https://ezgif.com/video-to-gif) 转成 GIF。

### 方案 C：只截静态图（最省事）

`Win` + `Shift` + `S` 截取 → 存成 `docs/shot-main.png`，
然后把 README 里那行 `![界面演示](docs/demo.gif)` 改成：

```markdown
![界面演示](docs/shot-main.png)
```

**一张好截图也比没有图强得多。**

## 录图的几个要点

- **不要录整个桌面**，只录 HUD 本身（黑底 + 霓虹才对味）
- 录之前**先跑一次**让图里有点内容，空白的蛛网图不好看
- GIF 文件尽量压到 **5 MB 以内**，否则首屏加载会卡
- 想放多张图，命名用 `shot-01-xxx.png` 方便排序
