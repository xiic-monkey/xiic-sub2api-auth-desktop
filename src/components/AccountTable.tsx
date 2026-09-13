import type { AccountView } from "../types";

interface Props {
  accounts: AccountView[];
  loading: boolean;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
  onReload: () => void;
  only401: boolean;
  onOnly401Change: (v: boolean) => void;
  query: string;
  onQueryChange: (v: string) => void;
}

export default function AccountTable({
  accounts,
  loading,
  selected,
  onToggle,
  onToggleAll,
  onReload,
  only401,
  onOnly401Change,
  query,
  onQueryChange,
}: Props) {
  const allChecked = accounts.length > 0 && accounts.every((a) => selected.has(a.id));

  const statusBadge = (a: AccountView) => {
    if (a.has_401) return <span className="badge err">401</span>;
    if (a.error_message) return <span className="badge warn">error</span>;
    if (a.status === "active") return <span className="badge ok">active</span>;
    return <span className="badge dim">{a.status || "—"}</span>;
  };

  const expiry = (a: AccountView) => {
    if (a.expires_in_days === null) return <span className="muted">—</span>;
    if (a.expires_in_days < 0) return <span style={{ color: "var(--danger)" }}>已过期</span>;
    return <span className="muted">{a.expires_in_days} 天</span>;
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header>
        <span>
          账号列表
          <span className="tiny muted" style={{ marginLeft: 8, fontWeight: 400 }}>
            {accounts.length} 条{selected.size > 0 ? ` · 已选 ${selected.size}` : ""}
          </span>
        </span>
        <div className="actions">
          <input
            style={{ width: 180 }}
            placeholder="搜索邮箱 / 平台"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          <label className="tiny muted" style={{ display: "flex", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={only401}
              onChange={(e) => onOnly401Change(e.target.checked)}
            />
            只看 401
          </label>
          <button className="ghost" onClick={onReload} disabled={loading}>
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </header>

      <div className="table-wrap">
        {accounts.length === 0 ? (
          <div className="empty">
            {loading
              ? "正在从 sub2api 拉取账号…"
              : "没有账号。先在上方填好连接设置并保存，再点「刷新」。"}
          </div>
        ) : (
          <table className="accounts">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => onToggleAll(e.target.checked)}
                  />
                </th>
                <th style={{ width: 54 }}>#</th>
                <th>账号</th>
                <th style={{ width: 120 }}>平台 / 类型</th>
                <th style={{ width: 78 }}>状态</th>
                <th style={{ width: 70 }}>剩余</th>
                <th style={{ width: 92 }}>凭证</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr
                  key={a.id}
                  className={selected.has(a.id) ? "picked" : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).tagName === "INPUT") return;
                    onToggle(a.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => onToggle(a.id)}
                    />
                  </td>
                  <td className="mono">{a.id}</td>
                  <td className="mono">{a.name || "—"}</td>
                  <td className="muted">
                    {a.platform}
                    {a.account_type ? ` / ${a.account_type}` : ""}
                  </td>
                  <td>{statusBadge(a)}</td>
                  <td>{expiry(a)}</td>
                  <td>
                    {a.needs_reauth ? (
                      a.has_refresh_token ? (
                        <span className="badge warn">有 rt</span>
                      ) : (
                        <span className="badge err">无 rt</span>
                      )
                    ) : (
                      <span className="muted tiny">—</span>
                    )}
                  </td>
                  <td className="err-cell" title={a.error_message}>
                    {a.error_message || <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
