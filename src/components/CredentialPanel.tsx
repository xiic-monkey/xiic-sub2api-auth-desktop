import type { AppInfo, CredentialView, EngineStatus } from "../types";

interface Props {
  creds: CredentialView;
  onChange: (c: CredentialView) => void;
  onSave: () => void;
  saving: boolean;

  engine: string;
  onEngineChange: (v: string) => void;
  engines: EngineStatus | null;
  checking: boolean;
  onCheckEngines: () => void;

  info: AppInfo | null;
}

export default function CredentialPanel({
  creds,
  onChange,
  onSave,
  saving,
  engine,
  onEngineChange,
  engines,
  checking,
  onCheckEngines,
  info,
}: Props) {
  const set = <K extends keyof CredentialView>(k: K, v: CredentialView[K]) =>
    onChange({ ...creds, [k]: v });

  return (
    <>
      <section className="card">
        <header>
          <span>接码平台凭证</span>
          <button className="ghost" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </header>
        <div className="content">
          <div className="field">
            <label>CDK（重授权消耗）</label>
            <input
              value={creds.cdk}
              placeholder="TA-XXXX-XXXX-XXXX"
              onChange={(e) => set("cdk", e.target.value)}
            />
          </div>
          <div className="hint">
            {creds.exists
              ? `已保存 · 更新于 ${creds.updated_at || "—"}`
              : "尚未保存凭证。重授权流程需要有效 CDK。"}
          </div>
        </div>
      </section>

      <section className="card">
        <header>
          <span>运行环境</span>
          <button className="ghost" onClick={onCheckEngines} disabled={checking}>
            {checking ? "检测中…" : "检测"}
          </button>
        </header>
        <div className="content">
          <div className="field">
            <label>浏览器引擎</label>
            <select value={engine} onChange={(e) => onEngineChange(e.target.value)}>
              <option value="chrome">本机 Google Chrome（不下载，推荐）</option>
              <option value="chromium">内置 Chromium（需已安装）</option>
            </select>
          </div>
          <div className="actions">
            <span className={engines?.chrome ? "badge ok" : engines ? "badge err" : "badge dim"}>
              Chrome {engines ? (engines.chrome ? "可用" : "不可用") : "未检测"}
            </span>
            <span
              className={engines?.chromium ? "badge ok" : engines ? "badge dim" : "badge dim"}
            >
              Chromium {engines ? (engines.chromium ? "可用" : "未安装") : "未检测"}
            </span>
          </div>
          {engines?.chromeError && (
            <div className="hint">Chrome：{engines.chromeError}</div>
          )}
          <div className="field">
            <label>worker 状态</label>
            <div className="hint">
              {info ? (
                <>
                  <b>{info.worker_ready ? "已就绪" : "缺失"}</b>
                  <br />
                  {info.worker_script}
                </>
              ) : (
                "读取中…"
              )}
            </div>
          </div>
          {info && (
            <div className="hint">
              数据目录：{info.data_dir}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
