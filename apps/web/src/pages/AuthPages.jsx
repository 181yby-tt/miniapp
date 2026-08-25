import { useState } from 'react';
import { routeForSession } from '@kexu/client-core';
import { navigate } from '../runtime/browser.js';

export function LoginPage({ api, sessionStore, onSession }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!username.trim() || !password) return setError('请输入学号或教职工账号和密码');
    setLoading(true); setError('');
    try {
      const next = api ? await api.login(username.trim(), password) : null;
      sessionStore.set(next);
      onSession(next);
      navigate(routeForSession(next), { replace: true });
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="平台介绍">
        <div className="brand-mark">课</div>
        <div><p className="eyebrow">铁英中学</p><h1>选课排课</h1><p className="brand-copy">课程、排课与报名管理</p></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow ink">账号登录</p><h2>登录</h2><p className="login-intro">使用学校发放的账号和密码</p>
          <label><span>账号</span><input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入学号或教职工账号" /></label>
          <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? '正在登录…' : '登录'}</button>
          <p className="login-note">首次登录需要修改初始密码</p>
        </form>
      </section>
    </main>
  );
}

export function ChangePasswordPage({ api, session, sessionStore, onSession, toast }) {
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.new_password.length < 8) return setError('新密码至少 8 位');
    if (form.new_password !== form.confirm_password) return setError('两次输入的新密码不一致');
    setLoading(true);
    try {
      await api.changePassword(form);
      const next = { ...session, must_change_password: false };
      sessionStore.set(next); onSession(next); toast('密码已修改'); navigate(routeForSession(next), { replace: true });
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  return <main className="password-page"><form className="password-card" onSubmit={submit}><div className="brand-mark dark">密</div><p className="eyebrow ink">账号安全</p><h1>{session.must_change_password ? '设置你的新密码' : '修改密码'}</h1><p>新密码至少 8 位，建议同时包含数字和字母。</p><label><span>原密码</span><input type="password" value={form.old_password} onChange={update('old_password')} autoComplete="current-password" /></label><label><span>新密码</span><input type="password" value={form.new_password} onChange={update('new_password')} autoComplete="new-password" /></label><label><span>确认新密码</span><input type="password" value={form.confirm_password} onChange={update('confirm_password')} autoComplete="new-password" /></label>{error ? <div className="form-error">{error}</div> : null}<button className="primary-button" disabled={loading}>{loading ? '正在保存…' : '保存新密码'}</button>{!session.must_change_password ? <button type="button" className="text-button full" onClick={() => window.history.back()}>返回</button> : null}</form></main>;
}
