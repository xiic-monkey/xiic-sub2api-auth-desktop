import { useCallback, useEffect, useMemo, useState } from "react";
import { api, onReauthEvent } from "./api";
import type {
  AccountView,
  AppInfo,
  ApplyReport,
  CdkCheckResult,
  CdkMergeResult,
  CredentialView,
  EngineStatus,
  FetchResult,
  ReauthEvent,
  Settings,
} from "./types";
import SettingsPanel from "./components/SettingsPanel";
import CredentialPanel from "./components/CredentialPanel";
import AccountTable from "./components/AccountTable";
import ReauthRunner from "./components/ReauthRunner";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [creds, setCreds] = useState<CredentialView | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [engines, setEngines] = useState<EngineStatus | null>(null);

  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [only401, setOnly401] = useState(false);

  const [events, setEvents] = useState<ReauthEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [report, setReport] = useState<ApplyReport | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingLeft, setCheckingLeft] = useState(false);
  const [merging, setMerging] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const reloadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listAccounts();
      setAccounts(list);
      // 默认勾选「需重授权」的账号
      setSelected(new Set(list.filter((a) => a.needs_reauth).map((a) => a.id)));
      const problems = list.filter((a) => a.needs_reauth).length;
      notify(`已加载 ${list.length} 个账号，其中 ${problems} 个需重授权`);
    } catch (e) {
      notify(String(e));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // ---------- 初始化 ----------
  useEffect(() => {
    (async () => {
      try {
        const [s, c, i] = await Promise.all([
          api.loadSettings(),
          api.loadCredentials(),
          api.appInfo(),
        ]);
        setSettings(s);
        setCreds(c);
        setInfo(i);
      } catch (e) {
        notify("初始化失败：" + String(e));
      }
    })();
  }, [notify]);

  // ---------- 订阅 worker 进度事件 ----------
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    onReauthEvent((e) => {
      setEvents((prev) => {
        const next = [...prev, e];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
      if (e.event === "done") {
        setResult(e.result);
        setReport(null);
      } else if (e.event === "preview") {
        // 一键流程自动衔接：写回前的匹配计划
        setReport(e.report);
      } else if (e.event === "apply") {
        // 一键流程自动衔接：写回结果
        setReport(e.report);
        const ok = e.report.outcomes.filter((o) => o.ok).length;
        notify(`写回完成：成功 ${ok} / 失败 ${e.report.outcomes.length - ok}`);
        void reloadAccounts();
      } else if (e.event === "cdk-check") {
        const r = e.result as CdkCheckResult;
        if (r.ok) {
          notify(`${r.cdk}：${r.left_text}`);
        } else {
          notify(`查询失败：${r.left_text || "未知错误"}`);
        }
        setCheckingLeft(false);
      } else if (e.event === "cdk-merge") {
        const r = e.result as CdkMergeResult;
        if (r.ok) {
          notify(`合并成功：${r.new_cdk} ${r.new_left}`);
          // 后端已保存新 CDK，刷新前端状态
          void api.loadCredentials().then(setCreds);
        } else {
          notify("合并失败");
        }
        setMerging(false);
      } else if (e.event === "banned") {
        notify(`检测到被封禁/停用账号：${e.emails.join(", ")}`);
      } else if (e.event === "deleted") {
        const ok = e.deleted.filter((o) => o.ok).length;
        const bad = e.deleted.length - ok;
        notify(`已删除 ${ok} 个被封禁账号${bad > 0 ? `，${bad} 个失败` : ""}`);
        void reloadAccounts();
      } else if (e.event === "error") {
        notify(e.msg);
      } else if (e.event === "exit") {
        setRunning(false);
        setCheckingLeft(false);
        setMerging(false);
      }
    }).then((f) => {
      if (dead) f();
      else un = f;
    });
    return () => {
      dead = true;
      if (un) un();
    };
  }, [notify, reloadAccounts]);

  // ---------- 派生数据 ----------
  const visibleAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 默认按账号 id 从小到大排序（与分组时的排序保持一致）
    return accounts
      .filter((a) => {
        if (only401 && !a.has_401) return false;
        if (q && !(a.name.toLowerCase().includes(q) || a.platform.toLowerCase().includes(q)))
          return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.id - b.id);
  }, [accounts, only401, query]);

  const selectedEmails = useMemo(
    () =>
      accounts
        .filter((a) => selected.has(a.id))
        .map((a) => a.name)
        .filter(Boolean),
    [accounts, selected]
  );

  // ---------- 动作 ----------
  const saveSettings = useCallback(async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const s = await api.saveSettings(settings);
      setSettings(s);
      notify("设置已保存");
    } catch (e) {
      notify(String(e));
    } finally {
      setSavingSettings(false);
    }
  }, [settings, notify]);

  const changeEngine = useCallback(
    async (v: string) => {
      if (!settings) return;
      const next = { ...settings, browser_engine: v };
      setSettings(next);
      try {
        await api.saveSettings(next);
        notify(`浏览器引擎已切换为 ${v === "chrome" ? "本机 Chrome" : "内置 Chromium"}`);
      } catch (e) {
        notify(String(e));
      }
    },
    [settings, notify]
  );

  const saveCreds = useCallback(async () => {
    if (!creds) return;
    setSavingCreds(true);
    try {
      const c = await api.saveCredentials(creds.cdk);
      setCreds(c);
      notify("凭证已保存");
    } catch (e) {
      notify(String(e));
    } finally {
      setSavingCreds(false);
    }
  }, [creds, notify]);

  const checkEngines = useCallback(async () => {
    setChecking(true);
    try {
      const s = await api.checkEngines();
      setEngines(s);
      if (!s.chrome && !s.chromium) notify("没有可用浏览器引擎，请安装 Chrome 或内置 Chromium");
    } catch (e) {
      notify(String(e));
    } finally {
      setChecking(false);
    }
  }, [notify]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(visibleAccounts.map((a) => a.id)) : new Set());
    },
    [visibleAccounts]
  );

  const start = useCallback(async () => {
    setEvents([]);
    setResult(null);
    setReport(null);
    setRunning(true);
    try {
      const n = await api.startReauth(selectedEmails);
      notify(`已启动重授权（${n} 个邮箱）`);
    } catch (e) {
      setRunning(false);
      notify(String(e));
    }
  }, [selectedEmails, notify]);

  const cancel = useCallback(async () => {
    try {
      const ok = await api.cancelReauth();
      notify(ok ? "已发送终止信号" : "没有正在运行的任务");
    } catch (e) {
      notify(String(e));
    }
  }, [notify]);

  const clearResult = useCallback(() => {
    setResult(null);
    setReport(null);
    setEvents([]);
  }, []);

  const checkLeft = useCallback(async () => {
    if (!creds?.cdk) return;
    setEvents([]);
    setCheckingLeft(true);
    try {
      await api.checkCdkLeft(creds.cdk);
    } catch (e) {
      setCheckingLeft(false);
      notify(String(e));
    }
  }, [creds, notify]);

  const mergeCdk = useCallback(
    async (codes: string[]) => {
      if (!creds?.cdk) return;
      setEvents([]);
      setMerging(true);
      try {
        // 把当前保存的 CDK 也加进去（去重交给后端/页面）
        const all = [creds.cdk, ...codes];
        await api.mergeCdk(all);
      } catch (e) {
        setMerging(false);
        notify(String(e));
      }
    },
    [creds, notify]
  );

  /** 分组：按 id 升序后按 pageSize 分页，每页优先级设为页码并写回 sub2api。 */
  const groupAccounts = useCallback(
    async (pageSize: number) => {
      setGrouping(true);
      try {
        const r = await api.groupAccounts(pageSize);
        const ok = r.outcomes.filter((o) => o.ok).length;
        const bad = r.outcomes.length - ok;
        notify(
          bad === 0
            ? `已分 ${r.pages} 组（每组最多 ${r.page_size} 个），优先级 1-${r.pages} 已写入`
            : `分组完成但有 ${bad} 组写入失败，成功 ${ok} 组`
        );
        await reloadAccounts();
      } catch (e) {
        notify(String(e));
      } finally {
        setGrouping(false);
      }
    },
    [notify, reloadAccounts]
  );

  const openUrl = useCallback(
    (url: string) => {
      api.openExternal(url).catch((e) => notify(String(e)));
    },
    [notify]
  );

  // ---------- 渲染 ----------
  const engineLabel =
    settings?.browser_engine === "chrome" ? "本机 Chrome" : "内置 Chromium";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          sub2api 重授权台
          <span className="ver">v{info?.version ?? "—"} · 本地单机版</span>
        </div>
        <div className="meta">
          <span>引擎：{engineLabel}</span>
          <span>
            浏览器：
            {info ? (
              info.browser_ready ? (
                <span className="badge ok">就绪</span>
              ) : (
                <span className="badge err">未找到</span>
              )
            ) : (
              "—"
            )}
          </span>
          {settings?.gate_url && (
            <button className="ghost" onClick={() => openUrl(settings.gate_url)}>
              打开门页
            </button>
          )}
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          {settings ? (
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              onSave={saveSettings}
              saving={savingSettings}
            />
          ) : (
            <section className="card">
              <div className="content">
                <div className="hint">读取设置中…</div>
              </div>
            </section>
          )}

          {creds && settings && (
            <CredentialPanel
              creds={creds}
              onChange={setCreds}
              onSave={saveCreds}
              saving={savingCreds}
              onCheckLeft={checkLeft}
              checkingLeft={checkingLeft}
              onMerge={mergeCdk}
              merging={merging}
              engine={settings.browser_engine}
              onEngineChange={changeEngine}
              engines={engines}
              checking={checking}
              onCheckEngines={checkEngines}
              info={info}
            />
          )}
        </aside>

        <main className="main">
          <AccountTable
            accounts={visibleAccounts}
            loading={loading}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onReload={reloadAccounts}
            onGroup={groupAccounts}
            grouping={grouping}
            only401={only401}
            onOnly401Change={setOnly401}
            query={query}
            onQueryChange={setQuery}
          />

          <ReauthRunner
            emails={selectedEmails}
            running={running || checkingLeft || merging}
            events={events}
            result={result}
            report={report}
            onStart={start}
            onCancel={cancel}
            onClear={clearResult}
            onOpenUrl={openUrl}
          />
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
