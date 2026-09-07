const STATUS = { 草稿: 'DRAFT', 开放: 'OPEN', 开放报名: 'OPEN', 停止: 'CLOSED', 停止报名: 'CLOSED', 已结束: 'FINISHED', 已归档: 'ARCHIVED' };
const HEADERS = {
  name: ['课程名称', '课程名', '名称'],
  category: ['课程分类', '分类'],
  capacity: ['课程容量', '容量', '人数上限'],
  teachers: ['任课教师', '教师', '老师'],
  status: ['课程状态', '状态'],
  description: ['课程介绍', '课程说明', '说明'],
};

const valueText = (value) => value === null || value === undefined ? '' : String(value).trim();
const headerText = (value) => valueText(value).toLowerCase().replace(/[\s_-]+/g, '');
const splitNames = (value) => valueText(value).split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean);

function headerField(value) {
  const normalized = headerText(value);
  return Object.entries(HEADERS).find(([, names]) => names.some((name) => headerText(name) === normalized))?.[0] || '';
}

export function parseCourseSheet(sheetRows, meta) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const headerIndex = rows.slice(0, 10).findIndex((row) => Array.isArray(row) && row.some((cell) => headerField(cell) === 'name'));
  if (headerIndex < 0) throw new Error('前 10 行中没有找到“课程名称”列');
  const indexes = {};
  rows[headerIndex].forEach((cell, index) => {
    const field = headerField(cell);
    if (field && indexes[field] === undefined) indexes[field] = index;
  });
  if (indexes.capacity === undefined) throw new Error('Excel 需要包含“课程容量”列');

  const courses = new Map();
  const errors = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    if (!Array.isArray(row) || row.every((cell) => !valueText(cell))) return;
    const name = valueText(row[indexes.name]);
    const capacity = Number(valueText(row[indexes.capacity]));
    if (!name) return errors.push({ row_number: rowNumber, message: '课程名称为空' });
    if (!Number.isInteger(capacity) || capacity < 1) return errors.push({ row_number: rowNumber, message: '课程容量必须是正整数' });

    const categoryName = indexes.category === undefined ? '' : valueText(row[indexes.category]);
    const category = categoryName ? meta.categories.find((item) => item.name === categoryName) : null;
    if (categoryName && !category) return errors.push({ row_number: rowNumber, message: `找不到课程分类“${categoryName}”` });
    const teacherNames = indexes.teachers === undefined ? [] : splitNames(row[indexes.teachers]);
    const statusText = indexes.status === undefined ? '' : valueText(row[indexes.status]);
    const status = STATUS[statusText] || (['DRAFT', 'OPEN', 'CLOSED', 'FINISHED', 'ARCHIVED'].includes(statusText.toUpperCase()) ? statusText.toUpperCase() : 'DRAFT');
    if (statusText && !STATUS[statusText] && !['DRAFT', 'OPEN', 'CLOSED', 'FINISHED', 'ARCHIVED'].includes(statusText.toUpperCase())) return errors.push({ row_number: rowNumber, message: `无法识别课程状态“${statusText}”` });
    const description = indexes.description === undefined ? '' : valueText(row[indexes.description]);
    const existing = courses.get(name);
    if (existing) {
      if (existing.capacity !== capacity) errors.push({ row_number: rowNumber, message: `同一课程“${name}”的容量不一致` });
      if (indexes.teachers !== undefined) existing.teacher_names = [...new Set([...splitNames(existing.teacher_names), ...teacherNames])].join('、');
    } else {
      courses.set(name, { name, capacity, ...(category ? { category_id: category.id } : {}), ...(indexes.teachers !== undefined ? { teacher_names: teacherNames.join('、') } : {}), ...(statusText ? { status } : {}), ...(indexes.description !== undefined ? { description } : {}) });
    }
  });
  if (!courses.size && !errors.length) throw new Error('Excel 中没有可导入的课程数据');
  return { rows: [...courses.values()], errors, header_row: headerIndex + 1 };
}
