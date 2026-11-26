<div align="center">
  <img src="assets/icons/icon128.png" width="96" alt="MarkNest 图标">
  <h1>MarkNest</h1>
  <p><strong>独立于 Chrome 原生书签的本地书签扩展：数据保存在你指定的 JSON 文件中。</strong></p>
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-0B57D0">
    <img alt="Chrome" src="https://img.shields.io/badge/Chrome-120%2B-4285F4">
    <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-34A853">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
  </p>
  <p>
    <a href="https://github.com/akizono/mark-nest/releases/tag/v1.0.0">下载 v1.0.0</a>
    &nbsp;·&nbsp;
    <a href="#安装">安装</a>
    &nbsp;·&nbsp;
    <a href="#构建与测试">构建与测试</a>
    &nbsp;·&nbsp;
    <a href="README.md">English</a>
  </p>
</div>

## 概述

MarkNest 把个人书签树保存在你选定的本机 `bookmarks.json` 中，不与 Chrome 原生书签同步。可选访问密码用于锁定弹窗与设置；这是访问控制，不是加密。

需要 **Chrome 120+**。

## 功能

- 多级目录与书签，根目录也可直接放书签
- 按标题、网址、目录名搜索
- 从工具栏菜单、网页右键或弹窗添加当前页
- 从 Chrome 书签勾选目录/网页，导入到指定的 MarkNest 目录
- 三种存储：目录自动保存、单文件自动保存、手动导出
- 密码设置 / 修改 / 关闭 / 重置（重置不删除书签）
- 解锁策略：每次打开弹窗、直到手动锁定（浏览器重启后仍保持）、每次浏览器会话
- 界面语言：英文、简体中文、繁体中文、日文（跟随浏览器语言）

## 下载

预构建包发布在 GitHub Releases：

> [github.com/akizono/mark-nest/releases](https://github.com/akizono/mark-nest/releases)

**v1.0.0** 请下载 `mark-nest-1.0.0.zip`，解压后按下面步骤加载。也可以直接克隆或下载源码仓库。

## 安装

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择解压后的 `mark-nest-1.0.0` 目录（开发时可选本仓库根目录）

### 首次使用

1. 点击工具栏 MarkNest 图标
2. 完成初始化：选择目录、单个 JSON 文件，或手动模式
3. 可选：设置访问密码

若取消目录/文件选择，不会创建存储位置。

## 存储模式

| 模式 | 权威数据源 | 自动写入 |
| --- | --- | --- |
| 目录 | 所选文件夹内的 `bookmarks.json` | 是 |
| 单文件 | 绑定的 `bookmarks.json` | 是 |
| 手动 | 你导出的 JSON 文件 | 否 — 修改后需导出 |

规则：

- 书签数据以 JSON 为准，不以 `chrome.storage.local` 作为主书签库
- 文件权限丢失时会提示重新授权，不会静默切换模式
- 切换模式会保留当前内存中的书签树
- 目录模式写入流程：`bookmarks.json.tmp` → 校验 → `.bak` → 正式文件

## 解锁策略

1. **每次打开弹窗** — 关闭弹窗后再次打开需解锁
2. **直到手动锁定** — 浏览器重启后仍保持解锁，直到你在工具栏菜单、设置或弹窗中锁定
3. **浏览器会话（默认）** — 退出浏览器后清空解锁状态（`chrome.storage.session`）

## JSON 结构

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T00:00:00.000Z",
  "folders": [
    {
      "id": "folder_…",
      "name": "私人",
      "sortOrder": 0,
      "folders": [],
      "bookmarks": [
        {
          "id": "bookmark_…",
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

密码哈希与解锁状态不会写入该文件。

## 权限

`storage` · `contextMenus` · `tabs` · `activeTab` · `bookmarks`

`bookmarks` 仅用于从 Chrome 书签导入。Chrome 不允许扩展往书签栏右键菜单加项；请用扩展图标右键「从 Chrome 书签导入…」或「设置 → 数据管理」。

未申请：`history`、`cookies`、`webRequest`、`scripting`。

## 已知限制

1. File System Access 的目录/文件句柄可能失效，需在提示时用用户手势重新授权
2. 初始化与切换存储建议在设置页/初始化页完成，弹窗生命周期较短
3. 手动模式下，修改先落在工作缓冲，导出后才永久保存
4. 能打开设置页即可重置密码 — 这不是保险箱
5. favicon 依赖公网图标服务，失败时回退为扩展图标
6. 需要 Chrome 120 或更高版本

## 构建与测试

无打包工具。仓库根目录即为扩展根目录。

```bash
node tests/validate-data.test.js
```

覆盖 JSON 校验、目录/书签变更、合并导入（允许重复 URL；冲突 ID 会重映射）以及基础 manifest 检查。

### 打包 Release zip

在仓库根目录（PowerShell）：

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

将 `mark-nest-<version>.zip` 上传为 Release 资源，不要提交 zip 到仓库。

## 架构

- **书签：** `scripts/bookmarks.js` + `scripts/file-manager.js`（磁盘 JSON）
- **句柄：** IndexedDB
- **配置 / 密码哈希 /「直到手动锁定」标记：** `chrome.storage.local`
- **会话解锁：** `chrome.storage.session`
- **界面：** 原生 ES Module（popup、options、setup、add-bookmark、import-chrome）

```text
mark-nest/
├── manifest.json
├── background/          service worker（菜单、启动解锁）
├── popup/
├── options/
├── pages/               setup、add-bookmark、import-chrome
├── scripts/             auth、storage、bookmarks、import
├── assets/
├── _locales/            en / zh_CN / zh_TW / ja
└── tests/
```

## 参与贡献

欢迎 Issue 与 Pull Request。较大行为变更请先开 Issue 讨论。

贡献时请：

- 增改界面文案时同步 `_locales/en`、`zh_CN`、`zh_TW`、`ja`
- 提 PR 前运行 `node tests/validate-data.test.js`
- 不要提交生成的 zip、凭据或本地存储导出

## 许可证

MIT。见 [LICENSE](LICENSE)。
