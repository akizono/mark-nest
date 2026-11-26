<div align="center">
  <img src="assets/icons/icon128.png" width="96" alt="MarkNest 图标">
  <h1>MarkNest</h1>
  <p>Your Personal Bookmark Space</p>
  <p><strong>Chrome MV3 独立书签管理扩展：书签保存在本机 JSON 中，与 Chrome 原生书签系统分离。</strong></p>
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-0B57D0">
    <img alt="Chrome" src="https://img.shields.io/badge/Chrome-120%2B-4285F4">
    <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-34A853">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
  </p>
  <p>
    <a href="https://github.com/akizono/mark-nest/releases">下载</a>
    &nbsp;·&nbsp;
    <a href="#从源码构建">从源码构建</a>
    &nbsp;·&nbsp;
    <a href="README.md">English</a>
  </p>
</div>

## 项目简介

MarkNest 是一套独立于 Chrome 原生书签系统的本地书签管理插件。网页收藏进 MarkNest 自己的多级目录，数据写成电脑上的 `bookmarks.json`（例如你选定的 `D:\MyData\MarkNest\bookmarks.json`），可在资源管理器中直接打开，不依赖服务器、账号或云端。

主要用途是访问控制：避免家人、小孩或不熟悉电脑的人随便点开某些私人网站。可选密码会锁定弹窗和设置。

需要 Chrome 120+。

## 功能

- 无限层级目录，根目录也可直接放书签
- 按标题、网址、目录名搜索
- 工具栏菜单、网页右键或弹窗可添加当前页
- 可选：从 Chrome 书签勾选目录或网页，导入到 MarkNest 指定目录
- 存储方式：目录自动保存、单文件自动保存、手动导出
- 密码可设置、修改、关闭、重置（重置不删书签）
- 解锁策略：每次打开弹窗、直到手动锁定（浏览器重启后仍保持）、每个浏览器会话
- 界面支持英文、简体中文、繁体中文、日文（跟随浏览器语言）

## 下载

发布包在 GitHub Releases：

> [github.com/akizono/mark-nest/releases](https://github.com/akizono/mark-nest/releases)

**v1.0.0** 下载 `mark-nest-1.0.0.zip` 并解压。

## 安装

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择解压后的 `mark-nest-1.0.0` 目录

首次使用：点击工具栏图标，选择本机目录、单个 JSON 文件或手动模式，并可设置访问密码。取消目录/文件选择时不会创建存储位置。

开发时可直接加载本仓库根目录。

## 配置

书签数据只写在 `bookmarks.json`。密码哈希、解锁状态等配置不写入该文件。

| 模式 | 权威数据源 | 自动写入 |
| --- | --- | --- |
| 目录 | 所选文件夹内的 `bookmarks.json` | 是 |
| 单文件 | 绑定的 `bookmarks.json` | 是 |
| 手动 | 你导出的 JSON | 否 — 改完需要导出 |

目录模式写入流程：临时文件 → 校验 → `.bak` 备份 → 正式文件。JSON 损坏时会提示，不会自动覆盖坏文件。

解锁策略：

| 策略 | 行为 |
| --- | --- |
| 每次打开弹窗 | 关闭弹窗后再次打开需解锁 |
| 直到手动锁定 | 浏览器重启后仍保持解锁，直到你锁定 |
| 浏览器会话（默认） | 退出浏览器后清空（`chrome.storage.session`） |

数据结构示例：

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T00:00:00.000Z",
  "folders": [
    {
      "id": "folder_001",
      "name": "私人",
      "sortOrder": 0,
      "folders": [],
      "bookmarks": [
        {
          "id": "bookmark_001",
          "title": "Example",
          "url": "https://example.com",
          "sortOrder": 0
        }
      ]
    }
  ],
  "rootBookmarks": []
}
```

权限：`storage`、`contextMenus`、`tabs`、`activeTab`、`bookmarks`。  
`bookmarks` 仅用于可选的「从 Chrome 导入」；MarkNest 不以 Chrome 原生书签作为数据源。Chrome 也不允许往书签栏右键菜单加扩展项；请用扩展图标右键「从 Chrome 书签导入…」或「设置 → 数据管理」。

## 限制

- File System Access 句柄在浏览器重启后可能失效，提示时需重新授权
- 初始化与切换存储建议在设置页/初始化页完成；弹窗生命周期短
- 手动模式的修改先落在工作缓冲，导出后才永久保存
- favicon 走公网图标服务，失败时用扩展图标
- 不能收藏 `chrome://` 等受限页面

## 从源码构建

无打包工具。仓库根目录就是扩展根目录。

需要：Node.js（跑测试）、Chrome 120+。

```bash
node tests/validate-data.test.js
```

测试覆盖 JSON 校验、目录/书签变更、合并导入（允许重复 URL；冲突 ID 会重映射）以及基础 manifest 检查。

### 打包 Release zip

在仓库根目录执行（PowerShell）：

```powershell
$version = (Get-Content .\manifest.json -Raw | ConvertFrom-Json).version
$out = Join-Path $env:TEMP "mark-nest-$version"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $out | Out-Null
Copy-Item -Recurse `
  manifest.json,background,popup,options,pages,scripts,assets,_locales,LICENSE,README.md,README.zh-CN.md `
  $out
Compress-Archive -Path (Join-Path $out '*') -DestinationPath ".\mark-nest-$version.zip" -Force
```

把 `mark-nest-<version>.zip` 挂到 Release，不要把 zip 提交进仓库。

## 架构

- 入口：`background/service-worker.js`（菜单、启动解锁）、`popup/`、`options/`、`pages/`
- 书签树：`scripts/bookmarks.js`；磁盘读写：`scripts/file-manager.js`
- 目录/文件句柄：IndexedDB
- 配置、密码哈希、「直到手动锁定」标记：`chrome.storage.local`
- 会话解锁：`chrome.storage.session`
- 界面：原生 ES Module（无 React/Vue）

```text
mark-nest/
├── manifest.json
├── background/
├── popup/
├── options/
├── pages/          setup、add-bookmark、import-chrome
├── scripts/        auth、storage、bookmarks、import
├── assets/
├── _locales/       en、zh_CN、zh_TW、ja
└── tests/
```

## 参与贡献

较大行为变更请先开 Issue。

- 改界面文案时同步 `_locales/en`、`zh_CN`、`zh_TW`、`ja`
- 提 PR 前跑 `node tests/validate-data.test.js`
- 不要提交生成的 zip、凭据或本地存储导出

## 许可证

MIT，见 [LICENSE](LICENSE)。
