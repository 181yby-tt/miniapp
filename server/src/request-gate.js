'use strict';

// 单实例内：报名可以并行；整库快照写入及管理操作与报名互斥。
// 必须先完成逐行持久化和内存更新，才能让管理端保存新的快照。
function createRequestGate({ maxQueued = 512 } = {}) {
  let readers = 0;
  let writer = false;
  const queue = [];
  const busy = () => Object.assign(new Error('当前报名人数较多，请稍后重试'), { code: 'BUSY_RETRY' });
  function pump() {
    if (writer) return;
    while (queue.length) {
      const next = queue[0];
      if (next.exclusive && readers) return;
      queue.shift();
      if (next.exclusive) writer = true; else readers += 1;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        if (next.exclusive) writer = false; else readers -= 1;
        pump();
      });
      if (writer) return;
    }
  }
  return (exclusive) => {
    if (queue.length >= maxQueued) return Promise.reject(busy());
    return new Promise((resolve) => { queue.push({ exclusive, resolve }); pump(); });
  };
}
module.exports = { createRequestGate };
