import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AccountView } from "../types";

/** 每页账号数的可选范围（分组粒度）。 */
const GROUP_SIZES = Array.from({ length: 20 }, (_, i) => i + 1);

interface Props {
  accounts: AccountView[];
  loading: boolean;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
  onReload: () => void;
  /** 按每页大小分组：按 id 升序分页，每页优先级设为页码 */
  onGroup: (pageSize: number) => void;
  grouping: boolean;
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
  onGroup,
  grouping,
  only401,
  onOnly401Change,
  query,
  onQueryChange,
}: Props) {
  const [showGroup, setShowGroup] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const groupBtnRef = useRef<HTMLButtonElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null);

  // 卡片是 overflow:hidden，弹层相对按钮定位会被裁掉，所以挂到 body 上用 fixed 定位。
  const openGroup = () => {
    const r = groupBtnRef.current?.getBoundingClientRect();
    setPopPos(
      r
        ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }
        : { top: 80, right: 16 }
    );
    setShowGroup(true);
  };

  const confirmGroup = () => {
    onGroup(pageSize);
    setShowGroup(false);
  };

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
          <button
            ref={groupBtnRef}
            className="ghost"
            onClick={() => (showGroup ? setShowGroup(false) : openGroup())}
            disabled={loading || grouping}
          >
            {grouping ? "分组中…" : "分组"}
          </button>
          {showGroup &&
            popPos &&
            createPortal(
              <>
                <div className="popover-backdrop" onClick={() => setShowGroup(false)} />
                <div
                  className="popover"
                  style={{ position: "fixed", top: popPos.top, right: popPos.right }}
                >
                  <div className="popover-title">每页账号数（分组粒度）</div>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {GROUP_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <div className="hint">
                    按账号 id 从小到大排序后分页，第 N 页的账号优先级统一设为 N。
                  </div>
                  <button className="primary" onClick={confirmGroup} disabled={grouping}>
                    确认
                  </button>
                </div>
              </>,
              document.body
            )}
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
                <th style={{ width: 66 }}>优先级</th>
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
                  <td className="mono">{a.priority === null ? <span className="muted">—</span> : a.priority}</td>
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
