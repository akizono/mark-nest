# MarkNest 技术说明与测试记录

## 关键决策（已确认）

1. **解锁模式二**：持久解锁直到手动锁定，跨浏览器重启仍有效（`chrome.storage.local`）
2. **初始化入口**：优先 Popup 内选目录/文件；失败或不便时打开 `pages/setup.html`
3. **添加书签入口**：工具栏图标右键（`contexts: ['action']`）+ 页面右键
4. **存储三档**：directory → file → manual；权限失效优先重新授权
5. **最低版本**：Chrome 120+

## 数据流

```
UI → data-service → bookmarks(mutate) → file-manager.saveBookmarks
                                         ├ directory: atomic write bookmarks.json
                                         ├ file: write bound file handle
                                         └ manual: pendingData buffer + export warning
```

句柄存 IndexedDB；配置/密码哈希/模式二解锁标记存 `chrome.storage.local`。

## 自动化测试结果

```
node tests/validate-data.test.js
→ All tests passed.
```

覆盖：JSON 校验、非法 URL、文件夹/书签添加、合并导入去重与 ID 重映射、manifest 权限约束。

## 手工测试清单（建议）

- [ ] 首次安装 → 目录模式创建 bookmarks.json
- [ ] 扩展重载后重新授权仍可读同一文件
- [ ] 浏览器重启后模式二仍解锁；模式三需重新解锁
- [ ] 模式一：关闭 popup 再开需密码
- [ ] 删除非空目录的两种策略
- [ ] Ctrl+点击书签在新标签打开
- [ ] 工具栏右键 / 页面右键添加当前页；chrome:// 被拒绝
- [ ] 手动模式修改后提示导出；导出后文件可再导入合并
- [ ] 损坏 JSON 不覆盖；提示进入设置
- [ ] 切换存储模式不丢失当前树数据

## 已知风险

- 部分环境下 popup 内 `showDirectoryPicker` 可能因窗口生命周期中断；已提供全页 setup/options 兜底
- 单文件模式无同目录 `.bak` 原子替换，依赖写入后回读校验
