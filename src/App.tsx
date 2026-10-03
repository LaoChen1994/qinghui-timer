import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, MouseEvent, SyntheticEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { PhysicalSize } from "@tauri-apps/api/dpi";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import {
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Plus,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Upload,
} from "lucide-react";
import "./App.css";

type Timer = {
  id: number;
  name: string;
  minutes: number;
  startedAt: number;
  deadline: number;
  warned: boolean;
  refreshed: boolean;
};

type Alert = {
  id: string;
  timerId: number;
  name: string;
  kind: "warning" | "ready";
  deadline: number;
};

type Snapshot = {
  timers: Timer[];
  alerts: Alert[];
  now: number;
  storageError: string | null;
  notificationError: string | null;
};

type SharedFile = {
  format: "qinghui-timer";
  version: 1;
  exportedAt: number;
  timers: Pick<Timer, "name" | "minutes" | "startedAt" | "deadline">[];
};

const App = () => {
  const desktop = isTauri();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => {
    const now = Date.now();
    const timers: Timer[] = [];
    if (!desktop) {
      for (const example of [
        { id: 1, name: "禁地魔王", minutes: 60, remaining: 168 },
        { id: 2, name: "逆魔", minutes: 40, remaining: 1116 },
        { id: 3, name: "通天教主", minutes: 90, remaining: -60 },
      ]) {
        const deadline = now + example.remaining * 1000;
        timers.push({
          id: example.id,
          name: example.name,
          minutes: example.minutes,
          startedAt: deadline - example.minutes * 60_000,
          deadline,
          warned: example.remaining <= 180,
          refreshed: example.remaining <= 0,
        });
      }
    }
    return {
      timers,
      alerts: [],
      now,
      storageError: null,
      notificationError: null,
    };
  });
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("45");
  const [customMinutes, setCustomMinutes] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [actionError, setActionError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!desktop);
  const [notificationStatus, setNotificationStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [deleteTarget, setDeleteTarget] = useState<Timer | null>(null);
  const [compact, setCompact] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [windowBusy, setWindowBusy] = useState(false);
  const [importFile, setImportFile] = useState<SharedFile | null>(null);
  const [importChoices, setImportChoices] = useState<
    (number | "add" | "keep")[]
  >([]);
  const [successMessage, setSuccessMessage] = useState("");
  const fullWindowSize = useRef<PhysicalSize | null>(null);
  const fullWindowMaximized = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestSequence = useRef(0);

  const loadSnapshot = useCallback(async () => {
    if (!desktop) return;
    const sequence = ++requestSequence.current;
    try {
      const next = await invoke<Snapshot>("get_snapshot");
      if (sequence !== requestSequence.current) return;
      setSnapshot(next);
      setLoaded(true);
      setConnectionError("");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [desktop]);

  const checkNotificationPermission = useCallback(async () => {
    if (!desktop) return;
    try {
      const granted = await isPermissionGranted();
      setNotificationStatus(granted ? "granted" : "unknown");
    } catch (error) {
      setActionError(
        "无法读取系统通知权限：" +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }, [desktop]);

  useEffect(() => {
    void loadSnapshot();
    void checkNotificationPermission();
    const interval = window.setInterval(loadSnapshot, 1000);
    window.addEventListener("focus", loadSnapshot);
    document.addEventListener("visibilitychange", loadSnapshot);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", loadSnapshot);
      document.removeEventListener("visibilitychange", loadSnapshot);
      requestSequence.current += 1;
    };
  }, [loadSnapshot, checkNotificationPermission]);

  const dialogVisible =
    importFile !== null ||
    deleteTarget !== null ||
    (!compact && snapshot.alerts.length > 0);
  useEffect(() => {
    if (dialogVisible && !dialogRef.current?.open)
      dialogRef.current?.showModal();
    if (!dialogVisible && dialogRef.current?.open) dialogRef.current.close();
  }, [dialogVisible]);

  const handleTimerAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const minutes = Number(preset === "custom" ? customMinutes : preset);
    if (!trimmedName || [...trimmedName].length > 40) {
      setFieldError("请输入 1～40 个字符的怪物名称");
      nameRef.current?.focus();
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setFieldError("刷新周期须为 1～1440 的整数分钟");
      return;
    }
    if (!desktop || busy) return;
    setBusy(true);
    setFieldError("");
    setActionError("");
    requestSequence.current += 1;
    try {
      await invoke("add_timer", { name: trimmedName, minutes });
      setName("");
      await loadSnapshot();
      nameRef.current?.focus();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handlePresetSelect = (event: MouseEvent<HTMLButtonElement>) => {
    setPreset(event.currentTarget.value);
    setFieldError("");
  };

  const handleTimerReset = async (id: number) => {
    if (busy || !desktop) return;
    setBusy(true);
    setActionError("");
    requestSequence.current += 1;
    try {
      await invoke("reset_timer", { id });
      await loadSnapshot();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleTimerDeleteRequest = (timer: Timer) => setDeleteTarget(timer);
  const handleTimerDeleteCancel = () => setDeleteTarget(null);
  const handleTimerDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setActionError("");
    requestSequence.current += 1;
    try {
      await invoke("delete_timer", { id: deleteTarget.id });
      await loadSnapshot();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleAlertsAcknowledge = async () => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    const ids = snapshot.alerts.map((alert) => alert.id);
    requestSequence.current += 1;
    try {
      await invoke("acknowledge_alerts", { ids });
      await loadSnapshot();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (busy) return;
    if (importFile) handleImportCancel();
    else if (deleteTarget) handleTimerDeleteCancel();
    else void handleAlertsAcknowledge();
  };

  const handleImportPreview = async () => {
    if (busy || !desktop) return;
    setBusy(true);
    setActionError("");
    setSuccessMessage("");
    try {
      const file = await invoke<SharedFile | null>("preview_import");
      if (!file) return;
      setImportChoices(
        file.timers.map((timer) => {
          const matches = snapshot.timers.filter(
            (current) => current.name === timer.name,
          );
          return matches.length === 0
            ? "add"
            : matches.length === 1
              ? matches[0].id
              : "keep";
        }),
      );
      setImportFile(file);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleImportChoiceSelect = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const index = Number(event.currentTarget.dataset.index);
    const value = event.currentTarget.value;
    if (!importFile || !Number.isInteger(index) || !importFile.timers[index])
      return;
    let choice: number | "add" | "keep";
    if (value === "add" || value === "keep") choice = value;
    else {
      const id = Number(value);
      if (
        !snapshot.timers.some(
          (timer) =>
            timer.id === id && timer.name === importFile.timers[index].name,
        )
      )
        return;
      choice = id;
    }
    setImportChoices((current) =>
      current.map((selected, position) =>
        position === index ? choice : selected,
      ),
    );
    setActionError("");
  };

  const handleImportCancel = () => {
    setImportFile(null);
    setImportChoices([]);
    setActionError("");
  };

  const handleImportConfirm = async () => {
    if (!importFile || busy) return;
    setBusy(true);
    setActionError("");
    requestSequence.current += 1;
    try {
      const choices = importChoices.map((choice) => {
        if (typeof choice !== "number") return { action: choice };
        const target = snapshot.timers.find((timer) => timer.id === choice);
        if (!target) throw new Error("覆盖目标已不存在，请重新选择处理方式");
        return {
          action: "replace",
          targetId: choice,
          expectedDeadline: target.deadline,
        };
      });
      const summary = await invoke<{
        added: number;
        updated: number;
        kept: number;
      }>("confirm_import", { file: importFile, choices });
      setImportFile(null);
      setImportChoices([]);
      setSuccessMessage(
        `导入完成：新增 ${summary.added} 条，更新 ${summary.updated} 条，保留或跳过 ${summary.kept} 条。`,
      );
      await loadSnapshot();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleTimersExport = async () => {
    if (busy || !desktop) return;
    setBusy(true);
    setActionError("");
    setSuccessMessage("");
    try {
      const path = await invoke<string | null>("export_timers");
      if (path) setSuccessMessage("已导出分享文件：" + path);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleNotificationEnable = async () => {
    setActionError("");
    try {
      const permission = await requestPermission();
      setNotificationStatus(permission === "granted" ? "granted" : "denied");
    } catch (error) {
      setActionError(
        "开启系统通知失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const handleNameFocus = () => nameRef.current?.focus();
  const handleWindowModeToggle = async () => {
    if (windowBusy) return;
    setWindowBusy(true);
    setActionError("");
    try {
      if (desktop) {
        const appWindow = getCurrentWindow();
        if (!compact) {
          fullWindowMaximized.current = await appWindow.isMaximized();
          if (fullWindowMaximized.current) await appWindow.unmaximize();
          fullWindowSize.current = await appWindow.innerSize();
          await appWindow.setMinSize(new LogicalSize(320, 260));
          await appWindow.setSize(new LogicalSize(320, 600));
        } else {
          await appWindow.setSize(
            fullWindowSize.current ?? new LogicalSize(1160, 880),
          );
          await appWindow.setMinSize(new LogicalSize(760, 620));
          if (fullWindowMaximized.current) await appWindow.maximize();
        }
      }
      setCompact(!compact);
    } catch (error) {
      setActionError(
        "切换窗口失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setWindowBusy(false);
    }
  };

  const handleWindowPinToggle = async () => {
    if (windowBusy) return;
    setWindowBusy(true);
    setActionError("");
    try {
      if (desktop) await getCurrentWindow().setAlwaysOnTop(!alwaysOnTop);
      setAlwaysOnTop(!alwaysOnTop);
    } catch (error) {
      setActionError(
        "设置置顶失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setWindowBusy(false);
    }
  };

  const timers = [...snapshot.timers].sort(
    (left, right) => left.deadline - right.deadline || left.id - right.id,
  );
  const waitingCount = timers.filter(
    (timer) => timer.deadline > snapshot.now,
  ).length;
  const warningCount = timers.filter(
    (timer) =>
      timer.deadline > snapshot.now && timer.deadline - snapshot.now <= 180_000,
  ).length;
  const readyCount = timers.length - waitingCount;
  const currentTime = new Date(snapshot.now).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
  const errors = [
    actionError,
    connectionError,
    snapshot.storageError,
    snapshot.notificationError,
  ].filter(Boolean);
  const controlsDisabled = busy || !desktop || !loaded;
  const allAlertsReady =
    snapshot.alerts.length > 0 &&
    snapshot.alerts.every((alert) => alert.kind === "ready");
  const dialogTitle = importFile
    ? "导入预览"
    : deleteTarget
      ? "删除这只怪物？"
      : allAlertsReady
        ? "怪物已经刷新"
        : "怪物刷新提醒";
  const dialogClass = importFile
    ? "dialog import-dialog"
    : deleteTarget
      ? "dialog delete-dialog"
      : allAlertsReady
        ? "dialog ready"
        : "dialog";
  const notificationLabel =
    notificationStatus === "granted"
      ? "系统通知已开启"
      : notificationStatus === "denied"
        ? "重新检查通知权限"
        : "开启系统通知";
  const windowModeLabel = compact ? "完整界面" : "精简模式";
  const windowPinLabel = alwaysOnTop ? "取消置顶" : "窗口置顶";
  const shellClass = compact ? "app-shell compact" : "app-shell";
  const replacementIds = importChoices.filter(
    (choice) => typeof choice === "number",
  );
  const duplicateImportTargets =
    new Set(replacementIds).size !== replacementIds.length;

  return (
    <div className={shellClass}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Swords size={25} />
          </span>
          <div>
            <h1>
              青回传世<span>怪物计时器</span>
            </h1>
            <p>把时间留给战斗</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-meta">
            <span className="live-dot" />
            {waitingCount > 0 ? "计时守候中" : "等待下一场战斗"}
            <span className="header-divider" />
            <Clock3 size={15} />
            <time>{currentTime}</time>
          </div>
          <button
            className="window-pin"
            onClick={handleWindowPinToggle}
            disabled={windowBusy}
            aria-label={windowPinLabel}
            aria-pressed={alwaysOnTop}
            title={windowPinLabel}
          >
            {alwaysOnTop ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            className="mode-switch"
            onClick={handleWindowModeToggle}
            disabled={windowBusy || busy}
            aria-label={windowModeLabel}
            title={windowModeLabel}
          >
            {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
            <span>{windowModeLabel}</span>
          </button>
        </div>
      </header>
      <main>
        {!desktop && (
          <p className="preview-banner">
            这是界面设计预览，卡片为示例数据。请打开桌面应用开始实际计时。
          </p>
        )}
        <section className="page-heading">
          <div>
            <p className="eyebrow">QINGHUI · MONSTER TIMER</p>
            <h2>
              每一次刷新，都不错过<span>.</span>
            </h2>
            <p className="subtitle">击杀后重置计时，下一次出发交给我们提醒。</p>
          </div>
          <div className="local-badge">
            <Shield size={14} /> 本地保存 · 无需联网
          </div>
        </section>
        {compact && snapshot.alerts.length > 0 && (
          <section
            className="compact-alerts"
            role="alert"
            aria-label="刷新提醒"
          >
            <div className="compact-alert-list">
              {snapshot.alerts.map((alert) => {
                const seconds = Math.max(
                  0,
                  Math.ceil((alert.deadline - snapshot.now) / 1000),
                );
                const message =
                  alert.kind === "ready" || seconds === 0
                    ? "已经刷新"
                    : "即将刷新 · " +
                      String(Math.floor(seconds / 60)).padStart(2, "0") +
                      ":" +
                      String(seconds % 60).padStart(2, "0");
                return (
                  <p key={alert.id}>
                    <strong title={alert.name}>{alert.name}</strong>
                    <span>{message}</span>
                  </p>
                );
              })}
            </div>
            <button
              className="secondary"
              onClick={handleAlertsAcknowledge}
              disabled={busy}
            >
              知道了
            </button>
          </section>
        )}
        {errors.length > 0 && (
          <div className="error-banner" role="alert">
            {errors.join("；")}
          </div>
        )}
        {successMessage && (
          <p className="success-banner" role="status">
            {successMessage}
          </p>
        )}
        <section className="overview" aria-label="计时概览">
          <div>
            <span>正在守候</span>
            <strong>
              {String(waitingCount).padStart(2, "0")}
              <small>只怪物</small>
            </strong>
          </div>
          <div>
            <span>
              <i className="status-dot warning" /> 即将刷新
            </span>
            <strong className="gold-text">
              {String(warningCount).padStart(2, "0")}
              <small>3 分钟内</small>
            </strong>
          </div>
          <div>
            <span>
              <i className="status-dot ready" /> 已经刷新
            </span>
            <strong className="green-text">
              {String(readyCount).padStart(2, "0")}
              <small>可以出发</small>
            </strong>
          </div>
          <div className="overview-tip">
            <Bell size={21} />
            <p>
              提前 3 分钟提醒
              <br />
              <span>到点再提醒一次</span>
            </p>
          </div>
        </section>
        <div className="workspace">
          <aside>
            <form className="add-panel" onSubmit={handleTimerAdd} noValidate>
              <div className="panel-heading">
                <span className="small-icon">
                  <Plus size={17} />
                </span>
                <h3>添加怪物</h3>
              </div>
              <p className="panel-caption">从这一刻，开始守候。</p>
              <label htmlFor="monster-name">怪物名称</label>
              <input
                id="monster-name"
                ref={nameRef}
                placeholder="例如：禁地魔王"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                aria-describedby={fieldError ? "field-error" : undefined}
              />
              <label id="cycle-label">刷新周期</label>
              <div
                className="presets"
                role="group"
                aria-labelledby="cycle-label"
              >
                {["45", "60", "90"].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    value={minutes}
                    className={
                      preset === minutes ? "preset selected" : "preset"
                    }
                    aria-pressed={preset === minutes}
                    onClick={handlePresetSelect}
                  >
                    {minutes}
                    <span>分钟</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                value="custom"
                className={
                  preset === "custom"
                    ? "custom-choice selected"
                    : "custom-choice"
                }
                aria-expanded={preset === "custom"}
                onClick={handlePresetSelect}
              >
                自定义时间 <ChevronRight size={14} />
              </button>
              {preset === "custom" && (
                <div className="custom-input">
                  <label htmlFor="custom-minutes">时间（1～1440 分钟）</label>
                  <input
                    id="custom-minutes"
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    inputMode="numeric"
                    placeholder="输入分钟数"
                    value={customMinutes}
                    onChange={(event) =>
                      setCustomMinutes(event.currentTarget.value)
                    }
                  />
                  <p>不超过 3 分钟时，开始后立即预提醒。</p>
                </div>
              )}
              {fieldError && (
                <p className="field-error" id="field-error" role="alert">
                  {fieldError}
                </p>
              )}
              <button
                type="submit"
                className="primary add-button"
                disabled={controlsDisabled}
              >
                <Plus size={16} /> 添加并开始计时
              </button>
              <div className="form-note">
                <Check size={13} /> 添加后立即开始倒计时
              </div>
            </form>
            <section className="reminder-panel">
              <div className="panel-heading">
                <Bell size={17} />
                <h3>刷新提醒</h3>
              </div>
              <div className="reminder-line">
                <span>提前 3 分钟</span>
                <span className="enabled-label">弹框提醒</span>
              </div>
              <div className="reminder-line">
                <span>怪物已刷新</span>
                <span className="enabled-label">弹框提醒</span>
              </div>
              <button
                className="notification-button"
                disabled={!desktop || busy}
                onClick={handleNotificationEnable}
              >
                <Bell size={14} />
                {notificationLabel}
              </button>
              {notificationStatus === "denied" && (
                <p className="permission-note">
                  请在系统设置中允许本应用发送通知。
                </p>
              )}
              <p>
                切回游戏也能收到系统通知。
                <br />
                请保持应用运行，最小化后仍会计时。
                <br />
                退出或电脑休眠期间无法发送提醒。
              </p>
            </section>
          </aside>
          <section className="timer-section">
            <div className="list-heading">
              <h3>
                我的怪物 <span>{timers.length}</span>
              </h3>
              <div className="list-actions">
                <span>按刷新时间排序</span>
                <button
                  className="secondary"
                  onClick={handleImportPreview}
                  disabled={controlsDisabled}
                >
                  <Upload size={14} /> 导入
                </button>
                <button
                  className="secondary"
                  onClick={handleTimersExport}
                  disabled={controlsDisabled}
                >
                  <Download size={14} /> 导出
                </button>
              </div>
            </div>
            <div className="timer-grid">
              {timers.map((timer) => {
                const remainingSeconds = Math.max(
                  0,
                  Math.ceil((timer.deadline - snapshot.now) / 1000),
                );
                const status =
                  remainingSeconds === 0
                    ? "ready"
                    : remainingSeconds <= 180
                      ? "warning"
                      : "waiting";
                const countdown =
                  remainingSeconds === 0
                    ? "已刷新"
                    : String(Math.floor(remainingSeconds / 60)).padStart(
                        2,
                        "0",
                      ) +
                      ":" +
                      String(remainingSeconds % 60).padStart(2, "0");
                const progress = Math.max(
                  0,
                  Math.min(
                    100,
                    ((snapshot.now - timer.startedAt) /
                      (timer.minutes * 60_000)) *
                      100,
                  ),
                );
                return (
                  <article
                    className={"timer-card " + status}
                    key={timer.id}
                    aria-label={timer.name + "计时器"}
                  >
                    <h4 title={timer.name}>{timer.name}</h4>
                    <strong
                      className="countdown"
                      role="timer"
                      aria-label={timer.name + "刷新倒计时"}
                    >
                      {countdown}
                    </strong>
                    <div className="card-actions">
                      <button
                        className="reset-button"
                        aria-label={"重置" + timer.name + "计时"}
                        title="重置计时"
                        disabled={controlsDisabled}
                        onClick={() => handleTimerReset(timer.id)}
                      >
                        重置
                      </button>
                      <button
                        className="delete-button"
                        aria-label={"删除" + timer.name}
                        title="删除怪物"
                        disabled={controlsDisabled}
                        onClick={() => handleTimerDeleteRequest(timer)}
                      >
                        删除
                      </button>
                    </div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={timer.name + "刷新进度"}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress)}
                    >
                      <div style={{ width: progress + "%" }} />
                    </div>
                  </article>
                );
              })}
              {loaded && timers.length === 0 && (
                <div className="empty-state">
                  <Swords size={36} />
                  <h4>{compact ? "暂无怪物计时" : "下一场战斗，从这里开始"}</h4>
                  <p>
                    输入怪物名称，选择刷新周期。
                    <br />
                    击杀后点一次重置，就能继续守候。
                  </p>
                  <button
                    className="primary"
                    onClick={compact ? handleWindowModeToggle : handleNameFocus}
                    disabled={windowBusy}
                  >
                    <Plus size={15} />
                    {compact ? "展开并添加怪物" : "添加第一只怪物"}
                  </button>
                </div>
              )}
              {!loaded && (
                <div className="empty-state">
                  <Clock3 size={28} />
                  <p>正在读取计时记录…</p>
                </div>
              )}
            </div>
            <div className="list-note">
              <Sparkles size={14} />
              <span>计时记录自动保存，重新打开后按实际时间继续计时。</span>
            </div>
          </section>
        </div>
      </main>
      <footer>
        <span>青回传世 · 怪物计时器</span>
        <span>
          专注每一场战斗 <span className="footer-dot">·</span> v0.2.3
        </span>
      </footer>
      <dialog
        ref={dialogRef}
        className={dialogClass}
        aria-labelledby="dialog-title"
        onCancel={handleDialogCancel}
      >
        <div className="dialog-icon">
          {importFile ? (
            <Upload size={22} />
          ) : deleteTarget ? (
            <Trash2 size={22} />
          ) : allAlertsReady ? (
            <Swords size={24} />
          ) : (
            <Bell size={23} />
          )}
        </div>
        <h3 id="dialog-title">{dialogTitle}</h3>
        {importFile ? (
          <>
            <p>选择要使用的刷新时间，同名记录才会覆盖。</p>
            <div className="import-list">
              {importFile.timers.map((incoming, index) => {
                const matches = snapshot.timers.filter(
                  (timer) => timer.name === incoming.name,
                );
                const incomingDate = new Date(incoming.deadline);
                const incomingTime =
                  incomingDate.toDateString() ===
                  new Date(snapshot.now).toDateString()
                    ? incomingDate.toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })
                    : incomingDate.toLocaleString("zh-CN", { hour12: false });
                const choice = importChoices[index];
                const current = matches[0];
                const localDate = current ? new Date(current.deadline) : null;
                const localTime =
                  matches.length > 1
                    ? "保留 " + matches.length + " 条记录"
                    : localDate
                      ? localDate.toDateString() ===
                        new Date(snapshot.now).toDateString()
                        ? localDate.toLocaleTimeString("zh-CN", {
                            hour12: false,
                          })
                        : localDate.toLocaleString("zh-CN", { hour12: false })
                      : "跳过此条";
                const incomingChoice =
                  matches.length === 0
                    ? "add"
                    : typeof choice === "number"
                      ? choice
                      : current.id;
                const incomingDisabled =
                  busy || (matches.length > 1 && choice === "keep");
                const choiceLabel =
                  "第 " + (index + 1) + " 条「" + incoming.name + "」处理方式";
                const localChoiceLabel =
                  "第 " +
                  (index + 1) +
                  " 条「" +
                  incoming.name +
                  "」" +
                  (matches.length > 0 ? "使用本地时间" : "跳过导入");
                const incomingChoiceLabel =
                  "第 " +
                  (index + 1) +
                  " 条「" +
                  incoming.name +
                  "」使用导入时间";
                return (
                  <section className="import-row" key={index}>
                    <h4 title={incoming.name}>{incoming.name}</h4>
                    <div
                      className="import-options"
                      role="radiogroup"
                      aria-label={choiceLabel}
                    >
                      <label>
                        <input
                          type="radio"
                          name={"import-" + index}
                          aria-label={localChoiceLabel}
                          data-index={index}
                          value="keep"
                          checked={choice === "keep"}
                          onChange={handleImportChoiceSelect}
                          disabled={busy}
                        />
                        <span>
                          {localTime}
                          {matches.length > 0 && <small>（本地）</small>}
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={"import-" + index}
                          aria-label={incomingChoiceLabel}
                          data-index={index}
                          value={incomingChoice}
                          checked={choice !== "keep"}
                          onChange={handleImportChoiceSelect}
                          disabled={incomingDisabled}
                        />
                        <span>
                          {incomingTime}
                          <small>（导入）</small>
                        </span>
                      </label>
                    </div>
                    {matches.length > 1 && (
                      <select
                        aria-label={
                          "第 " +
                          (index + 1) +
                          " 条「" +
                          incoming.name +
                          "」覆盖目标"
                        }
                        data-index={index}
                        value={typeof choice === "number" ? choice : ""}
                        onChange={handleImportChoiceSelect}
                        disabled={busy}
                      >
                        <option value="" disabled>
                          选择要覆盖的本地记录
                        </option>
                        {matches.map((timer, position) => {
                          const targetTime = new Date(
                            timer.deadline,
                          ).toLocaleString("zh-CN", { hour12: false });
                          return (
                            <option key={timer.id} value={timer.id}>
                              本地第 {position + 1} 条 · {targetTime}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </section>
                );
              })}
              {importFile.timers.length === 0 && <p>文件没有计时记录。</p>}
            </div>
            {duplicateImportTargets && (
              <p className="field-error" role="alert">
                多条导入记录不能覆盖同一条本地记录，请调整选择。
              </p>
            )}
          </>
        ) : deleteTarget ? (
          <p>
            确定删除「{deleteTarget.name}
            」的计时记录吗？这只怪物后续的刷新提醒也会停止。
          </p>
        ) : (
          <>
            <p className="dialog-meta">
              {snapshot.alerts.length} 只怪物有新动态
            </p>
            <div className="dialog-list">
              {snapshot.alerts.map((alert) => {
                const seconds = Math.max(
                  0,
                  Math.ceil((alert.deadline - snapshot.now) / 1000),
                );
                const message =
                  alert.kind === "ready" || seconds === 0
                    ? "已经刷新，可以出发了！"
                    : "即将刷新，剩余 " +
                      Math.floor(seconds / 60) +
                      " 分 " +
                      (seconds % 60) +
                      " 秒。";
                return (
                  <p key={alert.id}>
                    <strong>{alert.name}</strong>
                    <br />
                    <span>{message}</span>
                  </p>
                );
              })}
            </div>
            <p className="dialog-help">
              击杀后，点击对应怪物的重置计时按钮开始下一轮。
            </p>
          </>
        )}
        {actionError && (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        )}
        <div className="dialog-actions">
          {importFile ? (
            <>
              <button
                className="secondary"
                onClick={handleImportCancel}
                disabled={busy}
                autoFocus
              >
                取消导入
              </button>
              <button
                className="primary"
                onClick={handleImportConfirm}
                disabled={
                  busy ||
                  duplicateImportTargets ||
                  importFile.timers.length === 0
                }
              >
                确认导入
              </button>
            </>
          ) : deleteTarget ? (
            <>
              <button
                className="secondary"
                onClick={handleTimerDeleteCancel}
                disabled={busy}
                autoFocus
              >
                取消
              </button>
              <button
                className="primary"
                onClick={handleTimerDelete}
                disabled={busy}
              >
                确认删除
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={handleAlertsAcknowledge}
              disabled={busy}
              autoFocus
            >
              知道了，继续守候
            </button>
          )}
        </div>
      </dialog>
    </div>
  );
};

export default App;
