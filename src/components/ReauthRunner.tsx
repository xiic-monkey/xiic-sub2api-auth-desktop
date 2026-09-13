import type { ApplyReport, FetchResult, ReauthEvent } from "../types";

interface Props {
  emails: string[];
  running: boolean;
  events: ReauthEvent[];
  result: FetchResult | null;
  report: ApplyReport | null;
  onStart: () => void;
  onCancel: () => void;
  onClear: () => void;
  onOpenUrl: (url: string) => void;
}

type StepEvent = Extract<ReauthEvent, { event: "step" }>;

const STEP_LABEL: Record<string, string> = {
  spawn: "启动浏览器自动化",
  open: "打开门页",
  detect: "检测门页状态",
  gate: "填写 CDK 进入",
  emails: "填入邮箱",
  go: "点击获取令牌",
  "poll-done": "轮询结束",
  copy: "复制全部并读剪切板",
  cpa: "CPA 转换",
  apply: "匹配账号并写回",
  applied: "写回完成",
};

function lineOf(e: ReauthEvent): { text: string; cls: string } | null {
  switch (e.event) {
    case "step":
      return { text: `▸ ${e.msg}`, cls: "" };
    case "poll":
      return {
        text: `  [${e.t}] stat=${e.stat || "-"}  dlAll=${e.dlAll}  copyAll=${e.copyAll}`,
        cls: "dim",
      };
    case "log":
      return { text: e.msg, cls: "dim" };
    case "error":
      return { text: `✗ ${e.msg}`, cls: "err" };
    case "done":
      return { text: "✓ 结果已就绪（含 refresh_token）", cls: "ok" };
    case "exit":
      return {
        text: e.success ? "✓ 进程正常退出" : `✗ 进程退出（code=${e.code ?? "null"}）`,
        cls: e.success ? "ok" : "err",
      };
    case "raw":
      return { text: e.line, cls: "dim" };
    default:
      return null;
  }
}

export default function ReauthRunner({
  emails,
  running,
  events,
  result,
  report,
  onStart,
  onCancel,
  onClear,
  onOpenUrl,
}: Props) {
  const steps = events.filter((e): e is StepEvent => e.event === "step");
  const lastStep = steps.length > 0 ? steps[steps.length - 1].step : "";
  const hasClipboard = !!result?.clipboard;
  const hasCpaOutput = !!result?.cpaPage?.output;
  // 一键流程：fetch 结束后后端会自动 preview + apply，这里只反映状态
  const applying = running && lastStep === "apply";

  return (
    <section className="runner">
      <div className="runner-head">
        <span className="title">
          一键重授权
          <span className="tiny muted" style={{ marginLeft: 8, fontWeight: 400 }}>
            {emails.length > 0 ? `已选 ${emails.length} 个邮箱` : "请先在上方勾选账号"}
          </span>
        </span>
        {result && (
          <button className="ghost" onClick={onClear} disabled={running}>
            清空结果
          </button>
        )}
        {running ? (
          <button className="danger" onClick={onCancel}>
            终止
          </button>
        ) : (
          <button className="primary" onClick={onStart} disabled={emails.length === 0}>
            开始重授权
          </button>
        )}
      </div>

      <div className="runner-body">
        <div className="timeline">
          {steps.length === 0 ? (
            <div className="tiny muted">
              流程：门页 → 填 CDK 进入 → 填邮箱 → 获取令牌 → 轮询 → 复制全部 → CPA 转换 → 读输出
            </div>
          ) : (
            steps.map((s, i) => {
              const isLast = i === steps.length - 1;
              const cls = !running && isLast ? "done" : isLast ? "active" : "done";
              return (
                <div className="tl-item" key={`${s.step}-${i}`}>
                  <span className={`tl-dot ${cls}`} />
                  <span className="tl-text">
                    <b>{STEP_LABEL[s.step] ?? s.step}</b>
                    <div className="tl-sub">{s.msg}</div>
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="console">
          {events.length === 0 ? (
            <div className="ln dim">等待开始…</div>
          ) : (
            events.map((e, i) => {
              const l = lineOf(e);
              if (!l) return null;
              return (
                <div className={`ln ${l.cls}`} key={i}>
                  {l.text}
                </div>
              );
            })
          )}
          {running && lastStep !== "poll-done" && (
            <div className="ln dim">运行中…（每 5 秒轮询一次页面）</div>
          )}
        </div>
      </div>

      {result && (
        <div className="result-box">
          <div className="row-between">
            <span className="tiny">
              {result.done ? (
                <span className="badge ok">流程完成</span>
              ) : (
                <span className="badge warn">未检测到完成信号</span>
              )}{" "}
              <span className="muted" style={{ marginLeft: 6 }}>
                {result.emailsCount} 个邮箱
                {result.finalState?.stat ? ` · ${result.finalState.stat}` : ""}
                {result.finalState?.note ? ` · ${result.finalState.note}` : ""}
              </span>
            </span>
            <div className="actions">
              {result.cpaPage && (
                <button
                  className="ghost"
                  onClick={() => onOpenUrl(result.cpaPage!.url)}
                  title="可选查看；流程已自动访问 CPA 页并读取输出，无需手动操作"
                >
                  查看 CPA 页
                </button>
              )}
              <span className="tiny muted">
                {applying
                  ? "自动匹配并写回中…"
                  : !hasCpaOutput
                    ? "未拿到 CPA 输出"
                    : report
                      ? "已自动写回（含恢复调度）"
                      : ""}
              </span>
            </div>
          </div>

          <div className="hint">
            剪切板结果：{hasClipboard ? `${result.clipboard.length} 字符` : "空（可能回退到 #emails）"}
            {result.cpaPage && (
              <>
                {" "}
                · CPA 输出：{hasCpaOutput ? `${result.cpaPage.output.length} 字符` : "空"}
              </>
            )}
          </div>

          {result.errors.length > 0 && (
            <details>
              <summary className="tiny muted" style={{ cursor: "pointer" }}>
                {result.errors.length} 条警告
              </summary>
              <div className="hint" style={{ marginTop: 6 }}>
                {result.errors.map((e, i) => (
                  <div key={i}>· {e}</div>
                ))}
              </div>
            </details>
          )}

          {report && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row-between">
                <span className="tiny">
                  {report.dry_run ? "写回预览（自动执行中）" : "写回结果"}：匹配{" "}
                  {report.plans.length} 个账号
                  {report.skipped.length > 0 && ` · 跳过 ${report.skipped.length} 项`}
                  {!report.dry_run && ` · 成功 ${report.outcomes.filter((o) => o.ok).length}`}
                </span>
              </div>

              {report.plans.map((p) => {
                const outcome = report.outcomes.find((o) => o.account_id === p.account_id);
                return (
                  <div className="plan" key={p.account_id}>
                    <div className="plan-head">
                      <span className="mono">#{p.account_id}</span>
                      <span className="muted">{p.email}</span>
                      <span className="spacer" />
                      {outcome &&
                        (outcome.ok ? (
                          <span className="badge ok">已写回</span>
                        ) : (
                          <span className="badge err" title={outcome.message}>
                            失败
                          </span>
                        ))}
                    </div>
                    <ul>
                      {p.preview.map((f) => (
                        <li key={f.key} className={f.hidden ? "hidden" : undefined}>
                          {f.key}: {f.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {report.skipped.length > 0 && (
                <div className="hint">跳过：{report.skipped.join("；")}</div>
              )}

              {!report.dry_run && (
                <div className="hint">
                  {report.outcomes.filter((o) => o.ok).length} 成功 /{" "}
                  {report.outcomes.filter((o) => !o.ok).length} 失败。可回列表刷新查看状态。
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
