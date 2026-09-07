'use strict';
const GRADE_NAMES = ['初一', '初二', '初三'];
const ALIASES = { 初一: '初一', 七年级: '初一', '7年级': '初一', 初二: '初二', 八年级: '初二', '8年级': '初二', 初三: '初三', 九年级: '初三', '9年级': '初三' };
const normalizeGradeName = (name) => ALIASES[String(name ?? '').trim()] || '';
// 兼容早期验收数据；导入入口仍只接受正常年级名称。
const legacyGradeName = (name) => normalizeGradeName(name) || (name === '验收七年级' ? '初一' : '');
function ensureFixedGrades(db, nextId) {
  let changed = false;
  GRADE_NAMES.forEach((name, index) => {
    if (!db.grades.some((g) => g.name === name)) {
      const alias = db.grades.find((g) => legacyGradeName(g.name) === name);
      if (alias) alias.name = name;
      else db.grades.push({ id: nextId('grades'), name, sort_order: index + 1, status: 'ACTIVE' });
      changed = true;
    }
  });
  // 保留原有记录和班级编号，只统一其年级引用；旧课程范围仍可通过别名解析。
  for (const row of [...(db.students || []), ...(db.classes || [])]) {
    const id = canonicalGradeId(db, row.grade_id);
    if (id !== undefined && row.grade_id !== id) {
      row.grade_id = id;
      changed = true;
    }
  }
  return changed;
}
function fixedGrades(db) { return GRADE_NAMES.map((name) => db.grades.find((g) => g.name === name)).filter(Boolean); }
function canonicalGradeId(db, id) {
  const grade = db.grades.find((g) => g.id === Number(id));
  return fixedGrades(db).find((g) => g.name === legacyGradeName(grade?.name))?.id;
}
module.exports = { normalizeGradeName, ensureFixedGrades, fixedGrades, canonicalGradeId };
