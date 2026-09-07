import { useState } from 'react';
import { parseStudentDeletionSheet } from '../../utils/studentDeletion.js';

export default function StudentDeletePanel({ api, toast, onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState('');
  const [error, setError] = useState('');
  async function chooseFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy) return;
    setPreview(null); setCount(''); setError(''); setFileName(file.name);
    if (file.size > 10 * 1024 * 1024) return setError('Excel 文件不能超过 10MB');
    setBusy(true);
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const student_nos = parseStudentDeletionSheet(await readSheet(file));
      setPreview(await api.previewStudentDeletion({ student_nos }));
    } catch (err) { setError(err.message || '无法读取名单'); }
    finally { setBusy(false); }
  }
  async function confirmDeletion() {
    if (busy || !preview?.matches.length || count !== String(preview.matches.length)) return;
    setBusy(true); setError('');
    try {
      const result = await api.confirmStudentDeletion({ confirmation_token: preview.confirmation_token, confirm_count: Number(count) });
      setPreview(null); setCount(''); setFileName('');
      toast(`已删除 ${result.deleted_count} 名学生，释放 ${result.released_count} 个报名名额`);
      onDeleted();
    } catch (err) { setError(err.message); setPreview(null); setCount(''); }
    finally { setBusy(false); }
  }
  return <details className="student-account-tools student-delete-tools">
    <summary><span><strong>按名单删除学生</strong><small>导入专业队等无需参与选课的学生名单</small></span><b>展开</b></summary>
    <div className="student-delete-body">
      <p>Excel 只需“学号”列，也可使用原学生名单。学号有前导零时，请按文本填写。上传后先核对，不会立即删除。</p>
      <label className="upload-button">{busy ? '正在处理…' : '选择删除名单 Excel'}<input type="file" accept=".xlsx" disabled={busy} onChange={chooseFile} /></label>
      {fileName ? <small>{fileName}</small> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preview ? <>
        <p><strong>匹配 {preview.matches.length} 人</strong> · 未找到 {preview.not_found.length} 个学号 · 已合并 {preview.duplicate_count} 行重复学号</p>
        {preview.not_found.length ? <p className="student-delete-unmatched">未找到（不会删除）：{preview.not_found.join('、')}</p> : null}
        <div className="student-delete-matches" aria-label="待删除学生预览">{preview.matches.map((s) => <div key={s.id}><strong>{s.name}<small>{s.student_no}</small></strong><span>{s.grade} {s.class_name}<small>{s.enrolled_count ? `已报 ${s.enrolled_count} 门` : '未报名'}</small></span></div>)}</div>
        {preview.matches.length ? <>
          <p className="student-delete-warning">确认后，这些学生的资料、登录账号和报名记录会一并删除，已登录的账号也将失效，并释放 {preview.release_count} 个名额。其他学生不受影响，页面不支持撤销。</p>
          <label className="student-delete-confirm"><span>请输入删除人数 <strong>{preview.matches.length}</strong> 确认</span><input inputMode="numeric" autoComplete="off" value={count} disabled={busy} onChange={(event) => setCount(event.target.value)} /></label>
          <div className="student-delete-actions"><button disabled={busy} onClick={() => { setPreview(null); setCount(''); }}>取消</button><button className="danger-button" disabled={busy || count !== String(preview.matches.length)} onClick={confirmDeletion}>{busy ? '正在删除…' : `确认删除 ${preview.matches.length} 名学生`}</button></div>
        </> : null}
      </> : null}
    </div>
  </details>;
}
