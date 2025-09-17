# Zotero 8 兼容性适配说明

## 概述
本插件已成功适配Zotero 8，确保在最新版本的Zotero中正常运行。

## 主要更改

### 1. 版本兼容性设置
- **manifest.json**: 更新了版本兼容性范围
  - `strict_min_version`: 从 "7.0.0-beta.70" 更新为 "8.0.0"
  - `strict_max_version`: 保持 "8.*.*" 以支持所有Zotero 8版本

### 2. 构建配置优化
- **zotero-plugin.config.ts**: 更新了构建目标
  - `target`: 从 "firefox115" 更新为 "firefox120" 以支持更新的Firefox引擎

### 3. 依赖包更新
- **zotero-plugin-toolkit**: 更新到 4.1.2 版本，确保与Zotero 8的兼容性
- **zotero-types**: 保持 3.1.5 版本，提供稳定的类型定义

### 4. 代码修复
- 修复了TypeScript类型检查错误
- 添加了空值检查以防止运行时错误

## 安装说明

1. 构建插件：
   ```bash
   npm run build
   ```

2. 安装生成的XPI文件：
   - 文件位置：`build/zotero-annotation-manage.xpi`
   - 在Zotero中通过"工具" → "插件" → "从文件安装插件"进行安装

## 兼容性
- ✅ Zotero 8.0.0 及以上版本
- ✅ 所有Zotero 8.x 版本
- ❌ Zotero 7.x 及以下版本（已移除支持）

## 注意事项
- 本插件现在专门针对Zotero 8进行优化
- 如果您使用的是Zotero 7，请使用之前的版本
- 建议在安装前备份您的Zotero数据库

## 故障排除
如果遇到兼容性问题：
1. 确保您使用的是Zotero 8.0.0或更高版本
2. 检查插件是否正确安装
3. 查看Zotero的错误控制台获取详细错误信息
4. 如有问题，请提交GitHub issue