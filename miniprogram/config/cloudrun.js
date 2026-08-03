// miniprogram/config/cloudrun.js
// 微信云托管（WeChat CloudRun）部署开关与标识
// 上线步骤见 docs/云托管部署指南.md
module.exports = {
  // 是否走云托管内网通道：
  //   false → 本地/模拟器联调用 wx.request（BASE_URL）
  //   true  → 线上用 wx.cloud.callContainer（微信内网，免备案/免证书/免白名单）
  enabled: false,

  // 微信云托管环境 ID（控制台「环境管理」获取，形如 prod-xxx）
  env: 'prod-xxxx',

  // 服务名称（控制台「服务管理」新建服务时填写的名称，联调时作 X-WX-SERVICE）
  service: 'kexu-backend',
};
