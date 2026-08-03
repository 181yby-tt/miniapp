@echo off
chcp 65001 >nul
REM ============================================================
REM  铁英中学选课系统 - 后端一键启动脚本
REM  用途：在本地启动后端 API（端口 3000），供微信开发者工具联调
REM  注意：关闭此窗口即停止后端；调试小程序时请保持窗口打开
REM ============================================================
SETLOCAL
SET "NODE=C:\Users\25101\.workbuddy\binaries\node\versions\22.22.2\node.exe"
SET "SERVER_DIR=%~dp0server"

if not exist "%NODE%" (
  echo [错误] 未找到 node 运行时：%NODE%
  echo 请确认路径，或修改本脚本中的 NODE 变量。
  pause
  exit /b 1
)

echo ============================================================
echo   启动后端 API 服务 (端口 3000)
echo   目录: %SERVER_DIR%
echo ============================================================
echo.

REM 切换到 server 目录并启动
pushd "%SERVER_DIR%"
"%NODE%" src/server.js
popd

echo.
echo [已停止] 后端进程已退出。
pause
