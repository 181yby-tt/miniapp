#!/usr/bin/env bash
set -euo pipefail

CONFIRMATION=${1:-}
if [[ "$CONFIRMATION" != "--confirm-clear-demo-data" ]]; then
  cat <<'EOF'
此脚本会清空学生、教师、课程、排课、报名、年级班级和基础资料。
管理员账号和系统规则会保留，数据库会先自动备份。

确认执行时请运行：
  ./clear-demo-data.sh --confirm-clear-demo-data
EOF
  exit 2
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "$SCRIPT_DIR/../.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-/home/ubuntu/backups}
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/kexu-before-demo-clean-$STAMP.sql"
COMPOSE=(sudo docker compose -f "$SCRIPT_DIR/docker-compose.yml" --project-directory "$SCRIPT_DIR")
APP_STOPPED=false

restart_app_on_exit() {
  if [[ "$APP_STOPPED" == true ]]; then
    "${COMPOSE[@]}" up -d app >/dev/null
  fi
}
trap restart_app_on_exit EXIT

cd "$PROJECT_DIR"
install -d -m 700 "$BACKUP_DIR"
"${COMPOSE[@]}" exec -T mysql sh -c 'exec mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null

echo "正在暂停应用写入…"
"${COMPOSE[@]}" stop app >/dev/null
APP_STOPPED=true

echo "正在备份数据库到 $BACKUP_FILE …"
"${COMPOSE[@]}" exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces kexu' > "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
test -s "$BACKUP_FILE"

echo "正在清除演示业务数据…"
"${COMPOSE[@]}" exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kexu' < "$SCRIPT_DIR/clear-demo-data.sql"

echo "正在重新启动应用…"
"${COMPOSE[@]}" up -d app >/dev/null
APP_STOPPED=false

for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent http://127.0.0.1/api/health >/dev/null; then
    echo "清理完成。管理员账号与系统规则已保留。"
    echo "备份文件：$BACKUP_FILE"
    echo "请按顺序录入基础资料、导入学生，再导入课程。"
    exit 0
  fi
  sleep 5
done

echo "数据已清理，但应用健康检查失败，请查看容器日志。" >&2
exit 1
