# 课序 · 校本选课排课系统（学生微信小程序 + 后端）

铁英中学选课排课系统的**可运行核心闭环**：原生微信小程序（学生端） + 零依赖 Node 后端，
覆盖方案 / PRD / 技术方案中定义的关键能力——课程浏览、报名、退课、我的课表、个人中心，
以及后端最难的两件事：**报名并发不超卖** 与 **时间/教师/场地硬冲突校验 + 幂等**。

> 教务管理后台（Web）已包含在 `admin-console.html`（单文件 SPA，直接对接真实后端）。
> 学生端已接入**真实微信登录**：`wx.login` → 后端 `code2Session` 换 `openid` → 首次绑定学号 → 之后一键登录。

**AppID**：`wxe660278769911dc3`（已写入 `miniprogram/project.config.json`）。
**AppSecret**：`74a77f27c5f66b9153851a45055c7ad1`（仅服务端 `server/src/config.js`，切勿进前端/公开仓库）。

详见 **[上线与测试指南](docs/上线与测试指南.md)**。

---

## 目录结构

```
kexu/
├── server/                 # 零依赖 Node HTTP 后端（端口 3000）
│   ├── src/
│   │   ├── server.js       # 路由 + 报名事务 + 冲突校验 + 幂等
│   │   ├── store.js        # 内存 store，镜像 MySQL 表结构，持久化 data.json
│   │   └── auth.js         # 登录态签发（HMAC）、密码哈希
│   ├── test.js             # 后端核心逻辑测试（不超卖/幂等/冲突/容量）
│   ├── smoke_mp.js         # 小程序页面接口冒烟测试
│   └── package.json
├── miniprogram/            # 微信小程序（学生端，原生 WXML/WXSS）
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json / sitemap.json
│   ├── utils/{request,auth}.js
│   ├── components/course-card/
│   └── pages/{login,hall,detail,mine,schedule,profile,change-password}/
└── docs/
    └── schema.sql          # 生产环境 MySQL 8 建表语句
```

---

## 快速开始

### 1. 启动后端

```bash
cd server
node src/server.js          # 监听 http://localhost:3000，首次启动自动生成种子数据
```

演示账号：
- 管理员：`admin` / `demo123456`（首次登录需改密）
- 学生（学号即账号）：`20260108`（林晓雨）/ `123456`（首次登录需改密）

### 2. 打开小程序

1. 用微信开发者工具「导入项目」，目录选择 `kexu/miniprogram`。
2. AppID 可填测试号（或你自己的）。
3. 详情 → 本地设置 → 勾选 **「不校验合法域名、TLS 版本以及 HTTPS 证书」**（开发阶段）。
4. `utils/request.js` 中 `BASE_URL` 默认 `http://localhost:3000`；真机预览或上线时改为
   你已备案且加入小程序后台 **request 合法域名** 的 **HTTPS** 地址。

### 3. 跑测试

```bash
node server/test.js          # 后端 12 项核心逻辑断言
node server/smoke_mp.js      # 小程序页面接口冒烟（需后端在运行）
```

---

## API 一览（学生端）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 `token` / `user_type` / `must_change_password` |
| POST | `/api/auth/wechat-login` | 微信登录：`wx.login` 的 `code` → `openid`；已绑定返回 token，未绑定返回 `NEED_BIND` + `openid` |
| POST | `/api/auth/bind` | 首次绑定：`openid` + 学号/工号 + 初始密码 → 绑定并返回 token |
| POST | `/api/auth/bind-current` | 已登录用户绑定当前微信（手动登录后自动关联，便于下次一键登录） |
| POST | `/api/auth/change-password` | 修改密码（≥8 位，两次一致） |
| GET  | `/api/courses?open=1&q=&category=` | 课程大厅（按学段范围过滤） |
| GET  | `/api/courses/:id` | 课程详情（含 `enrolled` / `remaining`） |
| POST | `/api/courses/:id/enroll` | 报名（body: `idempotency_key`） |
| DELETE | `/api/courses/:id/enrollment` | 退课 |
| GET  | `/api/me/enrollments` | 我的课程（items + history + max_active） |
| GET  | `/api/me/schedule` | 我的课表（按星期/节次组织的排课） |
| GET  | `/api/me/profile` | 个人资料（学号/姓名/年级/班级） |

所有受保护接口需在 Header 带 `Authorization: Bearer <token>`。

### 关键业务规则（后端已校验）

- **并发不超卖**：报名在内存事务中 `active_count + 1 <= capacity` 条件更新，并发抢座仅恰好满员数成功。
- **幂等**：同一 `idempotency_key` 重复提交只产生 1 条报名记录，返回 `idempotent: true`。
- **时间冲突**：学生已报名课程与其报入课程的时间槽（weekday-period）重叠 → `STUDENT_TIME_CONFLICT`。
- **教师/场地冲突**：管理端代报名时，同一教师或同一场地在同一时间槽开两门课 → `STAFF_CONFLICT` / `VENUE_CONFLICT`。
- **容量下限**：课程已报名人数低于容量时不允许「停止报名」变为归档态。
- **数量上限**：学生活跃报名数达到 `student.max_active_courses`（默认 2）→ `STUDENT_LIMIT_REACHED`。

---

## 生产化建议

- **换数据库**：`docs/schema.sql` 提供 MySQL 8 建表；把 `store.js` 的读写替换为 SQL 即可，
  事务用 `SELECT ... FOR UPDATE` 保证不超卖，逻辑可直接复用 `server.js` 中的校验函数。
- **配置外置**：`system_configs` 已支持运行期配置（密码最小长度、学生上限、报名开放开关）。
- **域名与安全**：小程序正式版必须 HTTPS + 合法域名白名单；密码哈希、token 签发见 `auth.js`。
- **管理后台**：预留 `/api/admin/*`（dashboard / courses CRUD / 代报名代退课 / 冲突预检 / 审计），
  按 `miniprogram` 同样的请求层对接 Web 即可。
