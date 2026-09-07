export function parseStudentDeletionSheet(rows) {
  const text = (value) => String(value ?? '').trim();
  const aliases = ['学号', '学生学号', 'studentno', 'studentnumber', 'studentid'];
  const header = (value) => aliases.includes(text(value).toLowerCase().replace(/[\s_-]/g, ''));
  const index = rows.slice(0, 10).findIndex((row) => row.some(header));
  if (index < 0) throw new Error('前 10 行中没有找到“学号”列');
  if (rows[index].filter(header).length !== 1) throw new Error('请只保留一列学号');
  const column = rows[index].findIndex(header);
  const numbers = [];
  for (let i = index + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every((value) => !text(value))) continue;
    const value = row[column];
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`第 ${i + 1} 行学号有误，请将学号按文本填写`);
    if (!['string', 'number'].includes(typeof value) || !text(value) || text(value).length > 32) throw new Error(`第 ${i + 1} 行缺少有效学号，请修正后重新上传`);
    numbers.push(text(value));
  }
  if (!numbers.length || numbers.length > 3000) throw new Error('每次支持 1 至 3000 行学号');
  return numbers;
}
