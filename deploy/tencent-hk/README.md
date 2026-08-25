# 腾讯云香港部署

这一套部署同时提供学生 Web、PC 宽屏界面、教务后台和 API：

- `https://你的域名/`：统一登录入口
- `https://你的域名/courses`：学生课程大厅
- `https://你的域名/admin`：教务后台
- `https://你的域名/api/health`：健康检查

## 服务器准备

建议使用腾讯云香港地域的 Linux 轻量应用服务器，安全组仅开放：

- TCP 22：SSH，最好限制为管理员固定 IP
- TCP 80：Caddy 申请证书和 HTTP 跳转
- TCP/UDP 443：HTTPS 与 HTTP/3

不要开放 3306；MySQL 只在 Docker 内部网络中访问。

服务器需要安装 Docker Engine、Docker Compose 插件和 Git。

## 首次上线

1. 将域名的 A 记录解析到香港服务器公网 IP。
2. 将仓库克隆到服务器。
3. 进入部署目录并创建生产环境变量：

   ```bash
   cd miniapp/deploy/tencent-hk
   cp .env.example .env
   ```

4. 编辑 `.env`，填写真实域名以及三个不同的随机密码/密钥。
5. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

6. 查看状态：

   ```bash
   docker compose ps
   docker compose logs -f app caddy
   ```

Caddy 会在域名已经正确解析、80/443 可访问后自动申请和续期 HTTPS 证书。

## 更新代码

```bash
git pull --ff-only
cd deploy/tencent-hk
docker compose up -d --build
```

应用容器可随时重建，业务数据保存在 `mysql_data` Docker 卷中。

## 备份

上线前先建立每日备份任务。手动备份示例：

```bash
docker compose exec -T mysql sh -c 'exec mysqldump -ukexu -p"$MYSQL_PASSWORD" kexu' > kexu-backup.sql
```

备份文件应复制到另一台机器或对象存储，不能只保留在当前服务器。
