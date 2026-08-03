# 交付概览 · 课序选课排课小程序（学生端 + 后端）

## 本次完成内容

在 `E:\181app\kexu` 下交付了一套**可运行的核心闭环**：

### 1. 微信小程序（学生端，原生 WXML/WXSS）
7 个页面全部就绪并通过 API 契约校验：

| 页面 | 路径 | 功能 |
|------|------|------|
| 登录 | `pages/login` | 账号登录、首次登录强制改密跳转 |
| 课程大厅 | `pages/hall` | 概览、搜索、分类筛选、课程卡片列表、下拉刷新 |
| 课程详情 | `pages/detail` | 公开信息、报名/退课、名额与状态、冲突原因提示 |
| 我的课程 | `pages/mine` | 已报名列表、退课、历史记录、可再选余量 |
| 我的课表 | `pages/schedule` | 按周一~周五 × 节次组织的周课表网格 |
| 个人中心 | `pages/profile` | 学号/年级/班级、改密入口、退出登录 |
| 修改密码 | `pages/change-password` | 原/新/确认密码，首次登录场景返回首页 |

配套：`components/course-card`（可复用课程卡）、`utils/request.js`（Promise 化请求层 + 401 跳登录）、`utils/auth.js`（登录态/改密/登出）。

### 2. 后端（零依赖 Node HTTP，端口 3000）
- 认证：登录态签发、密码哈希、改密
- 课程：大厅查询（按学段范围过滤）、详情、管理端 CRUD 预留
- 报名：**内存事务 + 条件更新 + 幂等键**，已通过 12 项核心断言
- 退课：释放名额、写审计
- 个人域：`/api/me/enrollments`、`/api/me/schedule`、`/api/me/profile`
- 管理域：`/api/admin/*` 接口契约已预留（dashboard / 课程 / 代报名代退课 / 冲突预检 / 审计）

### 3. 文档
- `README.md` — 运行方式、API 一览、业务规则、生产化建议
- `docs/schema.sql` — 生产环境 MySQL 8 建表（与内存结构一一对应）

## 如何运行

```bash
# 后端
cd E:\181app\kexu\server && node src/server.js
# 微信开发者工具导入 E:\181app\kexu\miniprogram，勾选「不校验合法域名」
```

演示账号：学生 `20260108`/`123456`，管理员 `admin`/`demo123456`（均首次登录需改密）。

## 验证结果
- 后端 12 项核心逻辑测试全通过（并发恰好满员数成功、重复报名 1 条、时间/教师/场地冲突拦截、容量下限、数量上限）。
- 小程序 4 个新页面接口冒烟测试通过，返回字段与页面渲染完全匹配。

## 后续可做
- 教务管理 Web 后台（接口已预留）
- 小程序正式版配置 HTTPS + 合法域名（修改 `utils/request.js` 的 `BASE_URL`）
- 将内存 store 替换为 `docs/schema.sql` 的 MySQL，事务用 `SELECT ... FOR UPDATE`
