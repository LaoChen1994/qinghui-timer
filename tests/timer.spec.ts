import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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
type Fixture = {
  now: number;
  timers: Timer[];
  alerts: Alert[];
  afterAdd?: Timer[];
  afterReset?: Timer[];
  afterDelete?: Timer[];
  addError?: string;
  windowError?: string;
  maximized?: boolean;
  sharedFile?: {
    format: string;
    version: number;
    exportedAt: number;
    timers: Pick<Timer, "name" | "minutes" | "startedAt" | "deadline">[];
  };
  previewError?: string;
  importError?: string;
  afterImport?: Timer[];
  importSummary?: { added: number; updated: number; kept: number };
  exportPath?: string;
};

// 界面测试使用固定的原生命令响应；实际计时规则由 Rust 测试和桌面验证覆盖。
const installNativeFixture = async (page: Page, fixture: Fixture) => {
  await page.addInitScript((data: Fixture) => {
    let timers = data.timers;
    let alerts = data.alerts;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    Object.defineProperty(window, "isTauri", { value: true });
    Object.defineProperty(window, "nativeCalls", { value: calls });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        metadata: { currentWindow: { label: "main" } },
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "get_snapshot")
            return {
              timers,
              alerts,
              now: data.now,
              storageError: null,
              notificationError: null,
            };
          if (command === "plugin:notification|is_permission_granted")
            return true;
          calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
          if (command === "plugin:window|is_maximized")
            return data.maximized ?? false;
          if (command === "plugin:window|inner_size")
            return { width: 2320, height: 1760 };
          if (command === "plugin:window|set_always_on_top" && data.windowError)
            throw new Error(data.windowError);
          if (command === "add_timer") {
            if (data.addError) throw new Error(data.addError);
            if (data.afterAdd) timers = data.afterAdd;
          }
          if (command === "reset_timer" && data.afterReset)
            timers = data.afterReset;
          if (command === "delete_timer" && data.afterDelete)
            timers = data.afterDelete;
          if (command === "acknowledge_alerts") alerts = [];
          if (command === "preview_import") {
            if (data.previewError) throw new Error(data.previewError);
            return data.sharedFile ?? null;
          }
          if (command === "confirm_import") {
            if (data.importError) throw new Error(data.importError);
            if (data.afterImport) timers = data.afterImport;
            return data.importSummary ?? { added: 0, updated: 0, kept: 0 };
          }
          if (command === "export_timers") return data.exportPath ?? null;
          return null;
        },
      },
    });
  }, fixture);
  await page.goto("/");
};

const now = 1_790_997_000_000;
const waiting: Timer = {
  id: 1,
  name: "逆魔",
  minutes: 40,
  startedAt: now,
  deadline: now + 2_400_000,
  warned: false,
  refreshed: false,
};
const warning: Timer = {
  id: 2,
  name: "禁地魔王",
  minutes: 60,
  startedAt: now - 3_420_000,
  deadline: now + 180_000,
  warned: true,
  refreshed: false,
};
const ready: Timer = {
  id: 3,
  name: "通天教主",
  minutes: 90,
  startedAt: now - 5_460_000,
  deadline: now - 60_000,
  warned: true,
  refreshed: true,
};

test("空状态、名称及自定义分钟校验", async ({ page }) => {
  await installNativeFixture(page, { now, timers: [], alerts: [] });
  await page.getByRole("button", { name: "添加第一只怪物" }).click();
  await expect(page.getByLabel("怪物名称")).toBeFocused();
  await page.getByLabel("怪物名称").fill("   ");
  await page.getByRole("button", { name: "添加并开始计时" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "请输入 1～40 个字符的怪物名称",
  );
  await page.getByLabel("怪物名称").fill("逆魔");
  await page.getByRole("button", { name: "自定义时间" }).click();
  for (const value of ["0", "1.5", "1441", ""]) {
    await page.getByLabel("时间（1～1440 分钟）").fill(value);
    await page.getByRole("button", { name: "添加并开始计时" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "刷新周期须为 1～1440 的整数分钟",
    );
  }
  await expect(page.locator("article")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([]);
});

test("预设选择、名称修剪和添加后的真实卡片", async ({ page }) => {
  const added = {
    ...waiting,
    name: "禁地魔王",
    minutes: 60,
    deadline: now + 3_600_000,
  };
  await installNativeFixture(page, {
    now,
    timers: [],
    alerts: [],
    afterAdd: [added],
  });
  await page.getByLabel("怪物名称").fill("  禁地魔王  ");
  await page.getByRole("button", { name: "60 分钟", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "60 分钟", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "添加并开始计时" }).click();
  await expect(
    page.getByRole("article", { name: "禁地魔王计时器" }),
  ).toBeVisible();
  await expect(
    page.getByRole("timer", { name: "禁地魔王刷新倒计时" }),
  ).toHaveText("60:00");
  await expect(page.getByLabel("怪物名称")).toHaveValue("");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([
      { command: "add_timer", args: { name: "禁地魔王", minutes: 60 } },
    ]);
});

test("自定义长周期保留完整分钟数", async ({ page }) => {
  const added = { ...waiting, minutes: 1440, deadline: now + 86_400_000 };
  await installNativeFixture(page, {
    now,
    timers: [],
    alerts: [],
    afterAdd: [added],
  });
  await page.getByLabel("怪物名称").fill("逆魔");
  await page.getByRole("button", { name: "自定义时间" }).click();
  await page.getByLabel("时间（1～1440 分钟）").fill("1440");
  await page.getByRole("button", { name: "添加并开始计时" }).click();
  await expect(page.getByRole("timer")).toHaveText("1440:00");
});

test("多个计时器排序、状态展示及单独重置", async ({ page }) => {
  const reset = {
    ...warning,
    startedAt: now,
    deadline: now + 3_600_000,
    warned: false,
  };
  await installNativeFixture(page, {
    now,
    timers: [waiting, warning, ready],
    alerts: [],
    afterReset: [waiting, reset, ready],
  });
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("article").first()).toContainText("通天教主");
  await expect(
    page.getByRole("timer", { name: "通天教主刷新倒计时" }),
  ).toHaveText("已刷新");
  await expect(
    page.getByRole("timer", { name: "禁地魔王刷新倒计时" }),
  ).toHaveText("03:00");
  await expect(
    page.getByRole("progressbar", { name: "禁地魔王刷新进度" }),
  ).toHaveAttribute("aria-valuenow", "95");
  await page.getByRole("button", { name: "重置禁地魔王计时" }).click();
  await expect(
    page.getByRole("timer", { name: "禁地魔王刷新倒计时" }),
  ).toHaveText("60:00");
  await expect(
    page.getByRole("progressbar", { name: "禁地魔王刷新进度" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("timer", { name: "逆魔刷新倒计时" })).toHaveText(
    "40:00",
  );
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([{ command: "reset_timer", args: { id: 2 } }]);
});

test("同批提醒全部展示，确认后不重复弹出", async ({ page }) => {
  const alerts: Alert[] = [
    {
      id: "warning-2",
      timerId: 2,
      name: "禁地魔王",
      kind: "warning",
      deadline: warning.deadline,
    },
    {
      id: "ready-3",
      timerId: 3,
      name: "通天教主",
      kind: "ready",
      deadline: ready.deadline,
    },
  ];
  await installNativeFixture(page, { now, timers: [warning, ready], alerts });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("剩余 3 分 0 秒");
  await expect(dialog).toContainText("已经刷新，可以出发了");
  await page.getByRole("button", { name: "知道了，继续守候" }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([
      {
        command: "acknowledge_alerts",
        args: { ids: ["warning-2", "ready-3"] },
      },
    ]);
  await page.waitForTimeout(1200);
  await expect(dialog).not.toBeVisible();
});

test("删除确认可取消，删除不影响其他怪物", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting, warning],
    alerts: [],
    afterDelete: [warning],
  });
  await page.getByRole("button", { name: "删除逆魔" }).click();
  await expect(page.getByRole("dialog")).toContainText("逆魔");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("button", { name: "删除逆魔" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("禁地魔王");
});

test("保存失败保留输入并提示，不显示成功卡片", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [],
    alerts: [],
    addError: "计时记录保存失败：磁盘空间不足",
  });
  await page.getByLabel("怪物名称").fill("逆魔");
  await page.getByRole("button", { name: "添加并开始计时" }).click();
  await expect(page.getByRole("alert")).toContainText("计时记录保存失败");
  await expect(page.getByLabel("怪物名称")).toHaveValue("逆魔");
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("设计预览及窄窗口没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText("这是界面设计预览", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "添加并开始计时" }),
  ).toBeDisabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("精简窗口缩小并恢复原尺寸，计时与表单输入保留", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting, warning, ready],
    alerts: [],
  });
  await page.getByLabel("怪物名称").fill("尚未添加的怪物");
  await page.getByRole("button", { name: "精简模式", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 600 });
  await expect(page.getByLabel("怪物名称")).not.toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("timer", { name: "逆魔刷新倒计时" })).toHaveText(
    "40:00",
  );
  await expect(
    page.getByRole("timer", { name: "通天教主刷新倒计时" }),
  ).toHaveText("已刷新");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  const rows = await page.getByRole("article").all();
  for (const row of rows) {
    const box = await row.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(64);
  }
  await expect(
    page.getByRole("heading", { name: "青回传世", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /我的怪物/ }),
  ).not.toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(3);
  await expect(page.getByRole("article").first()).not.toContainText("预计刷新");
  await page.getByRole("button", { name: "完整界面", exact: true }).click();
  await page.setViewportSize({ width: 1160, height: 900 });
  await expect(page.getByLabel("怪物名称")).toHaveValue("尚未添加的怪物");
  const windowCalls = await page.evaluate(() => {
    const calls: { command: string; args: Record<string, unknown> }[] =
      Reflect.get(window, "nativeCalls");
    return calls.filter((call) => call.command.startsWith("plugin:window|"));
  });
  expect(windowCalls.map((call) => call.command)).toEqual([
    "plugin:window|is_maximized",
    "plugin:window|inner_size",
    "plugin:window|set_min_size",
    "plugin:window|set_size",
    "plugin:window|set_size",
    "plugin:window|set_min_size",
  ]);
  expect(windowCalls[3].args).toMatchObject({
    label: "main",
    value: { Logical: { width: 320, height: 600 } },
  });
  expect(windowCalls[4].args).toMatchObject({
    label: "main",
    value: { Physical: { width: 2320, height: 1760 } },
  });
});

test("精简小提示条不阻挡重置，确认后不再出现", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [warning, ready],
    alerts: [],
    afterReset: [
      warning,
      { ...ready, startedAt: now, deadline: now + 5_400_000, refreshed: false },
    ],
  });
  await page.getByRole("button", { name: "精简模式", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 600 });
  await page.evaluate((deadline) => {
    const internals = Reflect.get(window, "__TAURI_INTERNALS__");
    const original = internals.invoke;
    let acknowledged = false;
    internals.invoke = async (
      command: string,
      args: Record<string, unknown>,
    ) => {
      if (command === "acknowledge_alerts") acknowledged = true;
      const result = await original(command, args);
      if (command === "get_snapshot" && !acknowledged)
        result.alerts = [
          {
            id: "warning-2",
            timerId: 2,
            name: "禁地魔王",
            kind: "warning",
            deadline,
          },
        ];
      return result;
    };
  }, warning.deadline);
  const reminder = page.getByRole("alert", { name: "刷新提醒" });
  await expect(reminder).toContainText("即将刷新 · 03:00");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "重置通天教主计时" }).click();
  await expect(
    page.getByRole("timer", { name: "通天教主刷新倒计时" }),
  ).toHaveText("90:00");
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(reminder).not.toBeVisible();
  await page.waitForTimeout(1200);
  await expect(reminder).not.toBeVisible();
});

test("置顶按钮可以开启与取消置顶", async ({ page }) => {
  await installNativeFixture(page, { now, timers: [waiting], alerts: [] });
  await page.getByRole("button", { name: "精简模式", exact: true }).click();
  await page.getByRole("button", { name: "窗口置顶", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消置顶", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "取消置顶", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "窗口置顶", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("置顶失败提示不误报状态", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    windowError: "置顶权限不足",
  });
  await page.getByRole("button", { name: "窗口置顶", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "设置置顶失败：置顶权限不足",
  );
  await expect(
    page.getByRole("button", { name: "窗口置顶", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("精简空列表可展开添加，最大化窗口可恢复", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [],
    alerts: [],
    maximized: true,
  });
  await page.getByRole("button", { name: "精简模式", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 600 });
  await page
    .getByRole("button", { name: "展开并添加怪物", exact: true })
    .click();
  await expect(page.getByLabel("怪物名称")).toBeVisible();
  const commands = await page.evaluate(() => {
    const calls: { command: string; args: Record<string, unknown> }[] =
      Reflect.get(window, "nativeCalls");
    return calls.map((call) => call.command);
  });
  expect(commands).toContain("plugin:window|unmaximize");
  expect(commands.at(-1)).toBe("plugin:window|maximize");
});

test("导入预览逐条覆盖、保留与新增，采用原始刷新时间", async ({ page }) => {
  const incoming = {
    name: "逆魔",
    minutes: 60,
    startedAt: now - 600_000,
    deadline: now + 3_000_000,
  };
  const newTimer = {
    ...waiting,
    id: 4,
    name: "新怪物",
    minutes: 90,
    startedAt: now - 600_000,
    deadline: now + 4_800_000,
  };
  const sharedFile = {
    format: "qinghui-timer",
    version: 1,
    exportedAt: now - 300_000,
    timers: [
      incoming,
      {
        name: warning.name,
        minutes: 40,
        startedAt: now,
        deadline: now + 2_400_000,
      },
      {
        name: newTimer.name,
        minutes: newTimer.minutes,
        startedAt: newTimer.startedAt,
        deadline: newTimer.deadline,
      },
    ],
  };
  await installNativeFixture(page, {
    now,
    timers: [waiting, warning],
    alerts: [],
    sharedFile,
    afterImport: [{ ...waiting, ...incoming }, warning, newTimer],
    importSummary: { added: 1, updated: 1, kept: 1 },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog.getByRole("radio")).toHaveCount(6);
  for (const radio of await dialog.getByRole("radio").all()) {
    expect((await radio.boundingBox())?.width).toBeLessThanOrEqual(18);
  }
  for (const row of await dialog.locator(".import-row").all()) {
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(60);
  }
  await expect(
    page.getByRole("radio", { name: "第 1 条「逆魔」使用导入时间" }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "第 2 条「禁地魔王」使用本地时间" })
    .check();
  await dialog.screenshot({ path: "docs/import-preview.png" });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("timer", { name: "逆魔刷新倒计时" })).toHaveText(
    "50:00",
  );
  await expect(
    page.getByRole("timer", { name: "禁地魔王刷新倒计时" }),
  ).toHaveText("03:00");
  await expect(
    page.getByRole("timer", { name: "新怪物刷新倒计时" }),
  ).toHaveText("80:00");
  await expect(page.getByRole("status")).toContainText(
    "新增 1 条，更新 1 条，保留或跳过 1 条",
  );
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([
      { command: "preview_import", args: {} },
      {
        command: "confirm_import",
        args: {
          file: sharedFile,
          choices: [
            {
              action: "replace",
              targetId: 1,
              expectedDeadline: waiting.deadline,
            },
            { action: "keep" },
            { action: "add" },
          ],
        },
      },
    ]);
});

test("导入预览取消后原记录不变", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    sharedFile: {
      format: "qinghui-timer",
      version: 1,
      exportedAt: now,
      timers: [
        {
          name: "逆魔",
          minutes: 60,
          startedAt: now,
          deadline: now + 3_600_000,
        },
      ],
    },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("40:00");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toEqual([{ command: "preview_import", args: {} }]);
});

test("取消文件选择不会导入或报错", async ({ page }) => {
  await installNativeFixture(page, { now, timers: [waiting], alerts: [] });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("40:00");
});

test("损坏分享文件提示错误并保留计时器", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    previewError: "分享文件格式错误：无法解析 JSON",
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("分享文件格式错误");
  await expect(page.getByRole("timer")).toHaveText("40:00");
});

test("导入保存失败保留预览，原记录不变", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    importError: "计时记录保存失败：磁盘空间不足",
    sharedFile: {
      format: "qinghui-timer",
      version: 1,
      exportedAt: now,
      timers: [
        {
          name: "逆魔",
          minutes: 60,
          startedAt: now,
          deadline: now + 3_600_000,
        },
      ],
    },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "计时记录保存失败",
  );
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("40:00");
});

test("同名多条默认保留，手动选择覆盖目标", async ({ page }) => {
  const twin = { ...waiting, id: 2, minutes: 60, deadline: now + 3_600_000 };
  const incoming = {
    name: "逆魔",
    minutes: 90,
    startedAt: now - 120_000,
    deadline: now + 5_280_000,
  };
  await installNativeFixture(page, {
    now,
    timers: [waiting, twin],
    alerts: [],
    sharedFile: {
      format: "qinghui-timer",
      version: 1,
      exportedAt: now,
      timers: [incoming],
    },
    afterImport: [waiting, { ...twin, ...incoming }],
    importSummary: { added: 0, updated: 1, kept: 0 },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const selection = page.getByLabel("第 1 条「逆魔」覆盖目标");
  await expect(
    page.getByRole("radio", { name: "第 1 条「逆魔」使用本地时间" }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "第 1 条「逆魔」使用导入时间" }),
  ).toBeDisabled();
  await expect(selection).toHaveValue("");
  await selection.selectOption("2");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText(["40:00", "88:00"]);
});

test("重复覆盖目标需要调整选择后才能导入", async ({ page }) => {
  const incoming = {
    name: "逆魔",
    minutes: 60,
    startedAt: now,
    deadline: now + 3_600_000,
  };
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    sharedFile: {
      format: "qinghui-timer",
      version: 1,
      exportedAt: now,
      timers: [incoming, incoming],
    },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "不能覆盖同一条本地记录",
  );
  await expect(
    page.getByRole("button", { name: "确认导入", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("radio", { name: "第 2 条「逆魔」使用本地时间" })
    .check();
  await expect(
    page.getByRole("button", { name: "确认导入", exact: true }),
  ).toBeEnabled();
});

test("导出选择保存位置后报告成功，计时不变", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    exportPath: "/tmp/青回传世怪物计时记录.json",
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "已导出分享文件：/tmp/青回传世怪物计时记录.json",
  );
  await expect(page.getByRole("timer")).toHaveText("40:00");
});

test("主界面卡片紧凑，保留进度与小操作，长名称不撑高卡片", async ({ page }) => {
  const longName = "跨地图线路的长名称怪物".repeat(3);
  await installNativeFixture(page, {
    now,
    timers: [waiting, warning, ready],
    alerts: [],
    afterAdd: [waiting, warning, ready, { ...waiting, id: 4, name: longName }],
  });
  for (const card of await page.getByRole("article").all()) {
    expect((await card.boundingBox())?.height).toBeLessThanOrEqual(84);
    await expect(card).not.toContainText(
      /预计刷新|上次重置|分钟刷新|距离下次刷新|计时中|击杀后/,
    );
    await expect(card.getByRole("progressbar")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(2);
    await expect(card.getByRole("button").first()).toHaveText("重置");
    await expect(card.getByRole("button").last()).toHaveText("删除");
  }
  await expect(page.getByText("还有谁值得守候？")).toHaveCount(0);
  await expect(
    page.getByRole("progressbar", { name: "通天教主刷新进度" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await page
    .locator(".timer-section")
    .screenshot({ path: "docs/cards-preview.png" });
  await page.getByLabel("怪物名称").fill(longName);
  await page.getByRole("button", { name: "添加并开始计时" }).click();
  await page.setViewportSize({ width: 760, height: 900 });
  const card = page.getByRole("article", { name: longName + "计时器" });
  expect((await card.boundingBox())?.height).toBeLessThanOrEqual(84);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("新名称可用 radio 跳过，跨日期导入显示完整日期", async ({ page }) => {
  await installNativeFixture(page, {
    now,
    timers: [waiting],
    alerts: [],
    sharedFile: {
      format: "qinghui-timer",
      version: 1,
      exportedAt: now,
      timers: [
        {
          name: "新怪物",
          minutes: 60,
          startedAt: now + 86_400_000,
          deadline: now + 90_000_000,
        },
      ],
    },
    importSummary: { added: 0, updated: 0, kept: 1 },
  });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "第 1 条「新怪物」使用导入时间" }),
  ).toBeChecked();
  await expect(page.getByRole("dialog")).toContainText(/2026/);
  await page.getByRole("radio", { name: "第 1 条「新怪物」跳过导入" }).check();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "nativeCalls")))
    .toContainEqual({
      command: "confirm_import",
      args: {
        file: {
          format: "qinghui-timer",
          version: 1,
          exportedAt: now,
          timers: [
            {
              name: "新怪物",
              minutes: 60,
              startedAt: now + 86_400_000,
              deadline: now + 90_000_000,
            },
          ],
        },
        choices: [{ action: "keep" }],
      },
    });
});
