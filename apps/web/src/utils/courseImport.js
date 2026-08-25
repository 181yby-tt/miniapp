const WEEKDAYS = { 周一: 1, 星期一: 1, 周二: 2, 星期二: 2, 周三: 3, 星期三: 3, 周四: 4, 星期四: 4, 周五: 5, 星期五: 5, 周六: 6, 星期六: 6, 周日: 7, 星期日: 7 };
const STATUS = { 草稿: 'DRAFT', 开放: 'OPEN', 开放报名: 'OPEN', 停止: 'CLOSED', 停止报名: 'CLOSED', 已结束: 'FINISHED', 已归档: 'ARCHIVED' };
const HEADERS = {
  name: ['课程名称', '课程名', '名称'],
  category: ['课程分类', '分类'],
  capacity: ['课程容量', '容量', '人数上限'],
  teachers: ['任课教师', '教师', '老师'],
  weekday: ['星期', '上课星期'],
  period: ['节次', '上课节次'],
  venue: ['上课场地', '场地', '教室'],
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

function weekdayNumber(value) {
  const text = valueText(value);
  if (WEEKDAYS[text]) return WEEKDAYS[text];
  const number = Number(text.replace(/[^0-9]/g, ''));
  return number >= 1 && number <= 7 ? number : 0;
}

function periodNumber(value) {
  const number = Number(valueText(value).replace(/[^0-9]/g, ''));
  return number >= 1 && number <= 20 ? number : 0;
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
    const category = categoryName ? meta.categories.find((item) => item.name === categoryName) : meta.categories[0];
    if (!category) return errors.push({ row_number: rowNumber, message: `找不到课程分类“${categoryName || '默认分类'}”` });
    const teacherNames = indexes.teachers === undefined ? [] : splitNames(row[indexes.teachers]);
    const teacherIds = [];
    const errorCountBeforeReferences = errors.length;
    for (const teacherName of teacherNames) {
      const teacher = meta.staff.find((item) => item.name === teacherName);
      if (!teacher) errors.push({ row_number: rowNumber, message: `找不到教师“${teacherName}”，请先在基础数据中添加` });
      else teacherIds.push(teacher.id);
    }

    const weekday = indexes.weekday === undefined ? 0 : weekdayNumber(row[indexes.weekday]);
    const period = indexes.period === undefined ? 0 : periodNumber(row[indexes.period]);
    const venueName = indexes.venue === undefined ? '' : valueText(row[indexes.venue]);
    let schedule = null;
    if (weekday || period || venueName) {
      const slot = meta.time_slots.find((item) => Number(item.weekday) === weekday && Number(item.period) === period);
      const venue = meta.venues.find((item) => item.name === venueName);
      if (!slot) errors.push({ row_number: rowNumber, message: '星期或节次无效，请先在基础数据中配置时间段' });
      if (!venue) errors.push({ row_number: rowNumber, message: `找不到场地“${venueName}”` });
      if (slot && venue) schedule = { time_slot_id: slot.id, venue_id: venue.id };
    }
    if (errors.length > errorCountBeforeReferences) return;

    const statusText = indexes.status === undefined ? '' : valueText(row[indexes.status]);
    const status = STATUS[statusText] || (['DRAFT', 'OPEN', 'CLOSED', 'FINISHED', 'ARCHIVED'].includes(statusText.toUpperCase()) ? statusText.toUpperCase() : 'DRAFT');
    const description = indexes.description === undefined ? '' : valueText(row[indexes.description]);
    const existing = courses.get(name);
    if (existing) {
      if (existing.capacity !== capacity) errors.push({ row_number: rowNumber, message: `同一课程“${name}”的容量不一致` });
      existing.teachers = [...new Set([...existing.teachers, ...teacherIds])];
      if (schedule && !existing.schedules.some((item) => item.time_slot_id === schedule.time_slot_id && item.venue_id === schedule.venue_id)) existing.schedules.push(schedule);
    } else {
      courses.set(name, { name, category_id: category.id, capacity, teachers: teacherIds, schedules: schedule ? [schedule] : [], status, description, allowed_scope: { type: 'all' } });
    }
  });
  if (!courses.size && !errors.length) throw new Error('Excel 中没有可导入的课程数据');
  return { rows: [...courses.values()], errors, header_row: headerIndex + 1 };
}
