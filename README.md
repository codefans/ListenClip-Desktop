# ListenClip Desktop

Material 3 英语精听 Windows 桌面客户端 — MVP v0.1

## 功能

| 功能 | 状态 |
|------|------|
| 本地音视频导入（MP3/MP4/WAV/M4A/MKV…） | ✅ |
| Whisper API AI 自动转录 + 智能断句 | ✅ |
| 句子卡片精听播放器 | ✅ |
| 单句 A-B 循环（1×/2×/3×/∞） | ✅ |
| 上/下一句键盘导航（← →） | ✅ |
| 播放速度调节（0.5x–1.5x） | ✅ |
| 媒体库列表 + 处理状态追踪 | ✅ |
| 全文进度条拖拽 | ✅ |
| 句子列表侧边栏 | ✅ |

## 快速开始

### 前置要求

- Node.js ≥ 18
- OpenAI API Key（用于 Whisper 转录）

### 安装 & 运行

```bash
npm install
npm run dev
```

### 首次使用

1. 点击左侧 **设置** 齿轮，填入 OpenAI API Key
2. 返回媒体库，点击右下角 **+** 导入音频或视频文件
3. 填写标题后点击 **开始处理**（后台调用 Whisper 转录）
4. 处理完成后自动进入精听播放器

### 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `←` | 上一句 |
| `→` | 下一句 |

## 项目结构

```
src/
├── main/                   # Electron 主进程
│   ├── index.ts            # 窗口创建、协议注册
│   ├── ipc.ts              # IPC 处理器
│   └── services/
│       ├── store.ts        # JSON 本地数据持久化
│       ├── ffmpeg.ts       # 音频提取（ffmpeg-static）
│       └── whisper.ts      # OpenAI Whisper API 调用
├── preload/
│   └── index.ts            # 安全 contextBridge API 桥接
├── renderer/src/
│   ├── App.tsx             # NavigationRail + 路由
│   ├── theme.ts            # Material 3 暗色主题
│   └── pages/
│       ├── Library.tsx     # 媒体库
│       ├── ImportWizard.tsx # 导入向导
│       ├── Processing.tsx  # AI 处理进度
│       ├── Player.tsx      # 精听播放器 ★
│       └── Settings.tsx    # 设置中心
└── shared/
    └── types.ts            # 主进程/渲染层共享类型
```

## 技术栈

- **Electron 35** + **electron-vite 3**
- **React 18** + **TypeScript 5**
- **MUI v5**（Material 3 暗色主题）
- **ffmpeg-static**（内置 FFmpeg，无需系统安装）
- **OpenAI SDK v4**（Whisper-1 转录）
- 自定义 JSON 持久化（无额外 native 依赖）

## 数据存储

所有数据存储在系统用户目录：
- Windows: `%APPDATA%\listencip-desktop\`
  - `listencip-store.json` — 项目/句子/设置数据
  - `audio/` — 提取的音频文件
