import { useEffect, useState } from 'react';
import { parseStudentSheet } from '../../utils/studentImport.js';
import { buildStudentCredentialSheet, STUDENT_CREDENTIAL_COLUMNS } from '../../utils/studentCredentialExport.js';
import { localDateStamp } from '../../utils/enrollmentSummaryExport.js';

async function downloadCredentials(credentials) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  await writeExcelFile(buildStudentCredentialSheet(credentials), {
    columns: STUDENT_CREDENTIAL_COLUMNS,
    sheet: '学生账号',
    stickyRowsCount: 1,
  }).toFile(`学生初始账号_${localDateStamp()}.xlsx`);
}

export default function StudentImportPanel({ api, toast, onImported }) {
  const [manual, setManual] = useState({ student_no: '', name: '', grade: '', class_name: '' });
  const [manualSaving, setManualSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [resetExisting, setResetExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [credentials, setCredentials] = useState([]);
  const [initialPassword, setInitialPassword] = useState('12345678');

  useEffect(() => {
    api.getAdminConfigs()
      .then((result) => setInitialPassword(result.items.find((item) => item.key === 'security.student_initial_password')?.value || '12345678'))
      .catch(() => {});
  }, [api]);

  const updateManual = (key) => (event) => setManual((current) => ({ ...current, [key]: event.target.value }));

  async function createSingle(event) {
    event.preventDefault();
    setManualSaving(true);
    try {
      const result = await api.importAdminStudents({ rows: [{ ...manual, row_number: 1 }] });
      setCredentials(result.credentials || []);
      setManual({ student_no: '', name: '', grade: '', class_name: '' });
      toast('学生已添加，登录账号就是学号');
      onImported();
    } catch (error) { toast(error.message, 'error'); }
    finally { setManualSaving(false); }
  }

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

  return <div className="student-account-tools">
    <section className="paper-card student-manual-card">
      <div className="card-title"><div><p className="eyebrow ink">添加一名学生</p><h2>手动添加学生</h2><span>登录账号自动使用学号，统一初始密码为 <code>{initialPassword}</code></span></div></div>
      <form onSubmit={createSingle}>
        <label><span>学号</span><input value={manual.student_no} onChange={updateManual('student_no')} placeholder="必填，例如：20260001" /></label>
        <label><span>姓名</span><input value={manual.name} onChange={updateManual('name')} placeholder="必填，例如：张三" /></label>
        <label><span>年级</span><input value={manual.grade} onChange={updateManual('grade')} placeholder="例如：七年级" /></label>
        <label><span>班级</span><input value={manual.class_name} onChange={updateManual('class_name')} placeholder="例如：1 班" /></label>
        <button className="primary-button" disabled={manualSaving || !manual.student_no.trim() || !manual.name.trim()}>{manualSaving ? '正在添加…' : '添加学生并生成账号'}</button>
      </form>
    </section>
    <section className="student-import-card">
    <div><p className="eyebrow ink">批量添加学生</p><h2>Excel 导入学生名单</h2><p>系统自动以学号作为登录账号，所有新学生使用统一初始密码 <strong>{initialPassword}</strong>，首次登录必须修改。</p></div>
    <label className="upload-button">选择学生 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>
    {preview ? <div className="import-preview">
      <div className="import-summary"><strong>{fileName}</strong><span>{preview.rows.length} 名可导入 · {preview.errors.length} 行需修正</span></div>
      <div className="import-instructions"><strong>Excel 表头</strong><span>必填：学号、姓名</span><span>可选：年级、班级</span><small>不需要密码列；系统统一设置初始密码，学生首次登录必须修改。</small></div>
      <label className="check-line"><input type="checkbox" checked={resetExisting} onChange={(event) => setResetExisting(event.target.checked)} /><span>把已存在学生的密码也重置为统一初始密码</span></label>
      {preview.errors.length ? <div className="import-errors"><strong>需要修正</strong>{preview.errors.slice(0, 8).map((error) => <span key={`${error.row_number}-${error.message}`}>第 {error.row_number} 行：{error.message}</span>)}</div> : null}
      <div className="import-sample"><span>导入预览</span>{preview.rows.slice(0, 5).map((student) => <span key={student.student_no}><strong>{student.student_no}</strong>{student.name} · {student.grade} · {student.class_name}</span>)}</div>
      <button className="primary-compact" disabled={importing || !preview.rows.length} onClick={runImport}>{importing ? '正在生成账号并导入…' : `确认导入 ${preview.rows.length} 名学生`}</button>
    </div> : null}
    {credentials.length ? <div className="credential-result"><div><strong>账号已经生成</strong><span>登录账号为学号，统一初始密码为 {initialPassword}。可下载含年级、班级的 Excel 名单发放给学生。</span></div><button onClick={async () => { try { await downloadCredentials(credentials); } catch (error) { toast(error.message || 'Excel 下载失败', 'error'); } }}>下载 Excel 账号表</button><div className="credential-preview">{credentials.slice(0, 5).map((item) => <span key={item.student_no}><strong>{item.name}</strong><code>{item.class_name}</code><code>{item.username}</code></span>)}</div></div> : null}
    </section>
  </div>;
}
