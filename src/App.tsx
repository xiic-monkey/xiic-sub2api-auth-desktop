import { useCallback, useEffect, useMemo, useState } from "react";
import { api, onReauthEvent } from "./api";
import type {
  AccountView,
  AppInfo,
  ApplyReport,
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
  const [applying, setApplying] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

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
      } else if (e.event === "error") {
        notify(e.msg);
      } else if (e.event === "exit") {
        setRunning(false);
      }
    }).then((f) => {
      if (dead) f();
      else un = f;
    });
    return () => {
      dead = true;
      if (un) un();
    };
  }, [notify]);

  // ---------- 派生数据 ----------
  const visibleAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (only401 && !a.has_401) return false;
      if (q && !(a.name.toLowerCase().includes(q) || a.platform.toLowerCase().includes(q)))
        return false;
      return true;
    });
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

  const preview = useCallback(async () => {
    const raw = result?.cpaPage?.output;
    if (!raw) return;
    setApplying(true);
    try {
      setReport(await api.applyResult(raw, false));
    } catch (e) {
      notify(String(e));
    } finally {
      setApplying(false);
    }
  }, [result, notify]);

  const applyNow = useCallback(async () => {
    const raw = result?.cpaPage?.output;
    if (!raw) return;
    setApplying(true);
    try {
      const r = await api.applyResult(raw, true);
      setReport(r);
      const ok = r.outcomes.filter((o) => o.ok).length;
      notify(`写回完成：成功 ${ok} / 失败 ${r.outcomes.length - ok}`);
      await reloadAccounts();
    } catch (e) {
      notify(String(e));
    } finally {
      setApplying(false);
    }
  }, [result, notify, reloadAccounts]);

  const clearResult = useCallback(() => {
    setResult(null);
    setReport(null);
    setEvents([]);
  }, []);

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
            only401={only401}
            onOnly401Change={setOnly401}
            query={query}
            onQueryChange={setQuery}
          />

          <ReauthRunner
            emails={selectedEmails}
            running={running}
            events={events}
            result={result}
            report={report}
            applying={applying}
            onStart={start}
            onCancel={cancel}
            onPreview={preview}
            onApply={applyNow}
            onClear={clearResult}
            onOpenUrl={openUrl}
          />
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
