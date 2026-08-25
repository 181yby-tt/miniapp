import { useState } from 'react';
import { parseCourseSheet } from '../../utils/courseImport.js';

export default function CourseImportPanel({ api, courses, meta, toast, onImported }) {
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [failures, setFailures] = useState([]);

  async function chooseFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Excel 文件不能超过 10MB', 'error');
    try {
      const { readSheet } = await import('read-excel-file/browser');
      setPreview(parseCourseSheet(await readSheet(file), meta));
      setFileName(file.name); setFailures([]);
    } catch (error) { setPreview(null); setFileName(''); toast(error.message || '无法读取课程 Excel', 'error'); }
  }

  async function runImport() {
    if (!preview?.rows.length) return;
    setImporting(true); const failed = []; let saved = 0;
    for (const item of preview.rows) {
      try {
        const existing = courses.find((course) => course.name === item.name);
        if (existing) await api.updateAdminCourse(existing.id, item);
        else await api.createAdminCourse(item);
        saved += 1;
      } catch (error) { failed.push({ name: item.name, message: error.message }); }
    }
    setFailures(failed); setImporting(false); onImported();
    toast(failed.length ? `已保存 ${saved} 门，${failed.length} 门因冲突或资料问题未保存` : `已导入 ${saved} 门课程`, failed.length ? 'error' : 'success');
  }

  return <section className="course-import-panel">
    <div><strong>Excel 批量导入课程</strong><span>支持课程名称、分类、容量、教师、星期、节次、场地、状态和课程介绍。同一课程多行会合并为多次排课。</span></div>
    <label className="upload-button secondary-upload">选择课程 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>
    {preview ? <div className="course-import-preview"><div><strong>{fileName}</strong><span>{preview.rows.length} 门课程 · {preview.errors.length} 行需修正</span></div>{preview.errors.length ? <div className="import-errors">{preview.errors.slice(0, 6).map((error) => <span key={`${error.row_number}-${error.message}`}>第 {error.row_number} 行：{error.message}</span>)}</div> : null}<button className="primary-compact" disabled={importing || !preview.rows.length} onClick={runImport}>{importing ? '正在导入和检查排课冲突…' : '确认导入课程'}</button></div> : null}
    {failures.length ? <div className="import-errors">{failures.map((item) => <span key={item.name}>{item.name}：{item.message}</span>)}</div> : null}
  </section>;
}
