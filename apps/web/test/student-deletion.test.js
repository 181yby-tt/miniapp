import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentDeletionSheet } from '../src/utils/studentDeletion.js';
import writeExcelFile from 'write-excel-file/node';
import { readSheet } from 'read-excel-file/node';

test('删除名单只要求学号，保留前导零和重复行供预览计数', () => {
  assert.deepEqual(parseStudentDeletionSheet([['专业队录取名单'], ['学号', '姓名'], ['001', '张同学'], ['001', '张同学'], [123, '李同学']]), ['001', '001', '123']);
});
test('删除名单有错误时整体阻止，不能静默忽略空学号、超长学号或失真的数值', () => {
  for (const row of [[null, '张同学'], ['1'.repeat(33)], [9007199254740992], [1.5], [new Date()]]) assert.throws(() => parseStudentDeletionSheet([['学号', '姓名'], row]));
  assert.throws(() => parseStudentDeletionSheet([['姓名'], ['张同学']]));
  assert.throws(() => parseStudentDeletionSheet([['学号', '学生学号'], ['001', '002']]));
  assert.throws(() => parseStudentDeletionSheet([['学号']]));
});

test('真实 XLSX 读取后学号仍能精确匹配', async () => {
  const buffer = await writeExcelFile([['学号', '姓名'], ['001', '学生1'], ['0063', '学生63']].map((row) => row.map((value) => ({ value, type: String })))).toBuffer();
  assert.deepEqual(parseStudentDeletionSheet(await readSheet(buffer)), ['001', '0063']);
});
