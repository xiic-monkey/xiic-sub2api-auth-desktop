import type { Settings } from "../types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onSave: () => void;
  saving: boolean;
}

export default function SettingsPanel({ settings, onChange, onSave, saving }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <section className="card">
      <header>
        <span>连接设置</span>
        <button className="ghost" onClick={onSave} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </header>
      <div className="content">
        <div className="field">
          <label>sub2api 地址</label>
          <input
            value={settings.base_url}
            placeholder="http://your-sub2api-host:38011"
            onChange={(e) => set("base_url", e.target.value)}
          />
        </div>
        <div className="field">
          <label>管理员邮箱</label>
          <input
            value={settings.email}
            placeholder="admin@sub2api.local"
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div className="field">
          <label>管理员密码</label>
          <input
            type="password"
            value={settings.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>2FA 密钥（可空）</label>
            <input
              value={settings.totp_secret}
              placeholder="base32"
              onChange={(e) => set("totp_secret", e.target.value)}
            />
          </div>
          <div className="field">
            <label>最长等待（秒）</label>
            <input
              type="number"
              min={30}
              value={settings.max_seconds}
              onChange={(e) => set("max_seconds", Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <label className="row-between tiny muted" style={{ cursor: "pointer" }}>
          <span>校验证书（自签证书请取消勾选）</span>
          <input
            type="checkbox"
            checked={settings.verify_tls}
            onChange={(e) => set("verify_tls", e.target.checked)}
          />
        </label>
        <div className="field">
          <label>接码门页</label>
          <input
            value={settings.gate_url}
            onChange={(e) => set("gate_url", e.target.value)}
          />
        </div>
        <div className="field">
          <label>CPA 转换页（CDK 路径）</label>
          <input value={settings.cpa_url} onChange={(e) => set("cpa_url", e.target.value)} />
        </div>
      </div>
    </section>
  );
}

/** 收码站：非 CDK 授权路径（sub2api 授权链接 + 邮箱验证码）用。 */
export function MailPanel({ settings, onChange, onSave, saving }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <section className="card">
      <header>
        <span>收码站</span>
        <button className="ghost" onClick={onSave} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </header>
      <div className="content">
        <div className="hint">
          非 CDK 授权路径用：OpenAI 登录把验证码发到账号邮箱，这里配置的是能读到验证码的邮箱站。
        </div>
        <div className="field">
          <label>站点地址</label>
          <input
            value={settings.mail_base_url}
            placeholder="https://mail.example.com"
            onChange={(e) => set("mail_base_url", e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>用户名</label>
            <input
              value={settings.mail_username}
              placeholder="用户名"
              onChange={(e) => set("mail_username", e.target.value)}
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              type="password"
              value={settings.mail_password}
              onChange={(e) => set("mail_password", e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>非 CDK 单账号最长等待（秒）</label>
          <input
            type="number"
            min={60}
            value={settings.openai_max_seconds}
            onChange={(e) => set("openai_max_seconds", Number(e.target.value) || 0)}
          />
        </div>
        <label className="row-between tiny muted" style={{ cursor: "pointer" }}>
          <span>使用有头窗口（Cloudflare 要人工验证时能点一下）</span>
          <input
            type="checkbox"
            checked={settings.openai_headed}
            onChange={(e) => set("openai_headed", e.target.checked)}
          />
        </label>
      </div>
    </section>
  );
}
