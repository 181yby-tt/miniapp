import { useState } from 'react';
import { parseStudentSheet } from '../../utils/studentImport.js';

function downloadCredentials(credentials) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [['姓名', '学号', '登录账号', '初始密码'], ...credentials.map((item) => [item.name, item.student_no, item.username, item.password])];
  const csv = `\ufeff${lines.map((line) => line.map(escape).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `学生初始账号_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  URL.revokeObjectURL(url);
}

export default function StudentImportPanel({ api, toast, onImported }) {
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [resetExisting, setResetExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [credentials, setCredentials] = useState([]);

  async function chooseFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Excel 文件不能超过 10MB', 'error');
    try {
      const { readSheet } = await import('read-excel-file/browser');
      setPreview(parseStudentSheet(await readSheet(file)));
      setFileName(file.name); setCredentials([]);
    } catch (error) { setPreview(null); setFileName(''); toast(error.message || '无法读取 Excel 文件', 'error'); }
  }

  async function runImport() {
    if (!preview?.rows.length) return;
    setImporting(true);
    try {
      let created = 0; let updated = 0; const generated = [];
      for (let index = 0; index < preview.rows.length; index += 200) {
        const result = await api.importAdminStudents({ rows: preview.rows.slice(index, index + 200), reset_existing_password: resetExisting });
        created += result.created; updated += result.updated; generated.push(...(result.credentials || []));
      }
      setCredentials(generated);
      toast(`导入完成：新增 ${created} 名，更新 ${updated} 名`);
      onImported();
    } catch (error) { toast(error.message, 'error'); }
    finally { setImporting(false); }
  }

  return <section className="student-import-card">
    <div><p className="eyebrow ink">第一步：导入学生资料</p><h2>学生名单与登录账号</h2><p>上传后，系统自动以学号作为登录账号，并根据姓名和学号生成独立初始密码。学生会立即出现在下方学生管理列表中。</p></div>
    <label className="upload-button">选择学生 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>
    {preview ? <div className="import-preview">
      <div className="import-summary"><strong>{fileName}</strong><span>{preview.rows.length} 名可导入 · {preview.errors.length} 行需修正</span></div>
      <div className="import-instructions"><strong>Excel 表头</strong><span>必填：学号、姓名</span><span>可选：年级、班级、初始密码</span><small>不填写初始密码时由系统自动生成；首次登录必须修改。</small></div>
      <label className="check-line"><input type="checkbox" checked={resetExisting} onChange={(event) => setResetExisting(event.target.checked)} /><span>重新生成已存在学生的初始密码</span></label>
      {preview.errors.length ? <div className="import-errors"><strong>需要修正</strong>{preview.errors.slice(0, 8).map((error) => <span key={`${error.row_number}-${error.message}`}>第 {error.row_number} 行：{error.message}</span>)}</div> : null}
      <div className="import-sample"><span>导入预览</span>{preview.rows.slice(0, 5).map((student) => <span key={student.student_no}><strong>{student.student_no}</strong>{student.name} · {student.grade} · {student.class_name}</span>)}</div>
      <button className="primary-compact" disabled={importing || !preview.rows.length} onClick={runImport}>{importing ? '正在生成账号并导入…' : `确认导入 ${preview.rows.length} 名学生`}</button>
    </div> : null}
    {credentials.length ? <div className="credential-result"><div><strong>账号已经生成</strong><span>共 {credentials.length} 组新账号。初始密码只在这里返回一次，请立即下载并妥善保管。</span></div><button onClick={() => downloadCredentials(credentials)}>下载账号密码表</button><div className="credential-preview">{credentials.slice(0, 5).map((item) => <span key={item.student_no}><strong>{item.name}</strong><code>{item.username}</code><code>{item.password}</code></span>)}</div></div> : null}
  </section>;
}
