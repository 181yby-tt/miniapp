const HEADER_ALIASES = {
  student_no: ['学号', '学生学号', '学生编号', 'studentno', 'studentid', '账号'],
  name: ['姓名', '学生姓名', 'name'],
  grade: ['年级', 'grade'],
  class_name: ['班级', '行政班', 'classname', 'class'],
};
const GRADES = { 初一: '初一', 七年级: '初一', '7年级': '初一', 初二: '初二', 八年级: '初二', '8年级': '初二', 初三: '初三', 九年级: '初三', '9年级': '初三' };

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return String(value).trim();
}

function normalizedHeader(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function headerField(value) {
  const normalized = normalizedHeader(value);
  return Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || '';
}

export function parseStudentSheet(sheetRows) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const headerIndex = rows.slice(0, 10).findIndex((row) => Array.isArray(row) && row.some((cell) => headerField(cell) === 'student_no'));
  if (headerIndex < 0) throw new Error('前 10 行中没有找到“学号”列，请确认 Excel 第一行包含学号表头');

  const indexes = {};
  rows[headerIndex].forEach((cell, index) => {
    const field = headerField(cell);
    if (field && indexes[field] === undefined) indexes[field] = index;
  });
  if (indexes.name === undefined) throw new Error('Excel 需要包含“姓名”列');
  if (indexes.grade === undefined) throw new Error('Excel 需要包含“年级”列，填写初一、初二或初三');

  const parsed = [];
  const errors = [];
  const seen = new Set();
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    if (!Array.isArray(row) || row.every((cell) => !text(cell))) return;
    const studentNo = text(row[indexes.student_no]);
    const item = {
      row_number: rowNumber,
      student_no: studentNo,
      name: text(row[indexes.name]),
      grade: GRADES[text(row[indexes.grade])] || '',
      class_name: indexes.class_name === undefined ? '未分组' : text(row[indexes.class_name]) || '未分组',
    };

    if (!studentNo) errors.push({ row_number: rowNumber, message: '学号为空' });
    else if (!item.name) errors.push({ row_number: rowNumber, message: '姓名为空' });
    else if (!item.grade) errors.push({ row_number: rowNumber, message: '年级请填写初一、初二或初三' });
    else if (studentNo.length > 32) errors.push({ row_number: rowNumber, message: '学号不能超过 32 个字符' });
    else if (seen.has(studentNo)) errors.push({ row_number: rowNumber, message: `学号 ${studentNo} 在文件中重复` });
    else {
      seen.add(studentNo);
      parsed.push(item);
    }
  });

  if (!parsed.length && !errors.length) throw new Error('Excel 中没有可导入的学生数据');
  return { rows: parsed, errors, header_row: headerIndex + 1 };
}
