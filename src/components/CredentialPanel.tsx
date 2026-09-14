import { useState } from "react";
import type { AppInfo, CredentialView, EngineStatus } from "../types";

interface Props {
  creds: CredentialView;
  onChange: (c: CredentialView) => void;
  onSave: () => void;
  saving: boolean;

  onCheckLeft: () => void;
  checkingLeft: boolean;
  onMerge: (codes: string[]) => void;
  merging: boolean;

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
  onCheckLeft,
  checkingLeft,
  onMerge,
  merging,
  engine,
  onEngineChange,
  engines,
  checking,
  onCheckEngines,
  info,
}: Props) {
  const set = <K extends keyof CredentialView>(k: K, v: CredentialView[K]) =>
    onChange({ ...creds, [k]: v });

  const [showMerge, setShowMerge] = useState(false);
  const [mergeInput, setMergeInput] = useState("");

  const startMerge = () => {
    const codes = mergeInput
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (codes.length === 0) return;
    onMerge(codes);
    setShowMerge(false);
    setMergeInput("");
  };

  return (
    <>
      <section className="card">
        <header>
          <span>接码平台凭证</span>
          <div className="header-actions">
            <button className="ghost" onClick={onCheckLeft} disabled={checkingLeft || merging || saving}>
              {checkingLeft ? "查询中…" : "次数"}
            </button>
            <button className="ghost" onClick={() => setShowMerge(true)} disabled={checkingLeft || merging || saving}>
              {merging ? "合并中…" : "合并"}
            </button>
            <button className="ghost" onClick={onSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
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

      {showMerge && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowMerge(false)}>
          <div className="modal">
            <div className="modal-head">
              <h3>合并 CDK</h3>
              <button className="ghost" onClick={() => setShowMerge(false)} disabled={merging}>
                取消
              </button>
            </div>
            <div className="modal-body">
              <p className="hint">
                一行一张 CDK。系统会把下面输入的 CDK 与当前已保存的 CDK 一起拿到门页合并，新 CDK 会自动覆盖保存。
              </p>
              <textarea
                value={mergeInput}
                onChange={(e) => setMergeInput(e.target.value)}
                placeholder="TA-XXXX-XXXX-XXXX\nTA-YYYY-YYYY-YYYY"
                rows={6}
                disabled={merging}
              />
            </div>
            <div className="modal-foot">
              <button className="primary" onClick={startMerge} disabled={merging || !mergeInput.trim()}>
                {merging ? "合并中…" : "合并为新 CDK"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <header>
          <span>运行环境</span>
          <button className="ghost" onClick={onCheckEngines} disabled={checking}>
            {checking ? "检测中…" : "检测"}
          </button>
        </header>
        <div className="content">
          <div className="field">
            <label>浏览器引擎（原生 CDP，零 Node）</label>
            <select value={engine} onChange={(e) => onEngineChange(e.target.value)}>
              <option value="chrome">本机 Google Chrome（推荐）</option>
              <option value="chromium">系统 Chromium（需已安装）</option>
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
          {info && (
            <div className="hint">
              浏览器：{info.browser_ready ? info.browser_path : "未找到（先点「检测」确认）"}
              <br />
              数据目录：{info.data_dir}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
