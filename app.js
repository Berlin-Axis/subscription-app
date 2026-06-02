const STORAGE_KEY = "subscription-tracker-v1";

const defaultCurrencies = ["CNY", "USD", "EUR", "JPY", "HKD"];

const statusLabels = {
  active: "进行中",
  paused: "暂停",
  expired: "到期"
};

const cycleLabels = {
  week: "周",
  month: "月",
  year: "年",
  customDays: "自定义天"
};

const appState = {
  data: loadState(),
  filters: {
    search: "",
    time: "all",
    amount: "all",
    status: "all",
    sort: "nextCharge"
  },
  insights: {
    period: "month",
    currency: null
  }
};

init();

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function init() {
  ensureDefaults();
  applyTheme();
  bindGlobalEvents();
  render();
  window.addEventListener("hashchange", render);
}

function ensureDefaults() {
  const { data } = appState;

  data.currencies = data.currencies?.length ? data.currencies : defaultCurrencies;
  data.subscriptions = data.subscriptions?.length ? data.subscriptions : seedSubscriptions();

  data.subscriptions = data.subscriptions.map(({ icon, categoryId, paymentMethod, tags, ...sub }) => ({
    ...sub,
    status: sub.status || "active"
  }));

  data.categories = [];
  data.billingRecords = data.billingRecords ?? [];
  data.settings = data.settings ?? { theme: "light", homeCurrency: "CNY", insightsCurrency: "CNY" };

  if (!data.settings.homeCurrency) data.settings.homeCurrency = "CNY";
  if (!data.settings.insightsCurrency) data.settings.insightsCurrency = "CNY";

  appState.insights.currency = data.settings.insightsCurrency;

  saveState(data);
}

function bindGlobalEvents() {
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("exportBtn").addEventListener("click", exportCsv);
  document.getElementById("fabAdd").addEventListener("click", () => navigate("/edit"));

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => navigate(tab.dataset.route));
  });
}

function loadState() {
  const fallback = {
    subscriptions: [],
    billingRecords: [],
    categories: [],
    currencies: [],
    settings: { theme: "light", homeCurrency: "CNY", insightsCurrency: "CNY" }
  };

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function seedSubscriptions() {
  return [];
}

function navigate(path) {
  window.location.hash = `#${path}`;
}

function parseRoute() {
  const hash = window.location.hash.replace("#", "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  return { name: parts[0], id: parts[1] };
}

function render() {
  const route = parseRoute();
  updateTabs(route.name);
  const view = document.getElementById("view");

  if (route.name === "insights") {
    view.innerHTML = renderInsights();
    bindInsightsEvents();
  } else if (route.name === "detail" && route.id) {
    view.innerHTML = renderDetail(route.id);
    bindDetailEvents(route.id);
  } else if (route.name === "edit") {
    view.innerHTML = renderEdit(route.id);
    bindEditEvents(route.id);
  } else {
    view.innerHTML = renderHome();
    bindHomeEvents();
  }
}

function updateTabs(active) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route.includes(active));
  });
}

function renderHome() {
  const { data, filters } = appState;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const charges = data.subscriptions
    .filter((sub) => sub.status === "active")
    .flatMap((sub) => getChargesInRange(sub, monthStart, monthEnd));

  const totalsByCurrency = sumByCurrency(charges);
  const currencies = Object.keys(totalsByCurrency);
  const currencyOptions = currencies.length ? currencies : data.currencies;
  const homeCurrency = data.settings.homeCurrency || currencyOptions[0] || "CNY";
  const total = totalsByCurrency[homeCurrency] || 0;
  const paid = charges
    .filter((c) => c.date < now)
    .reduce((sum, c) => (c.currency === homeCurrency ? sum + c.amount : sum), 0);
  const pending = Math.max(total - paid, 0);
  const daysInMonth = monthEnd.getDate();
  const dailyAvg = daysInMonth ? total / daysInMonth : 0;

  const upcomingRenew = data.subscriptions.filter((sub) => {
    if (sub.status !== "active") return false;
    const next = getNextChargeDate(sub, now);
    if (!next) return false;
    const diff = diffDays(now, next);
    return diff >= 0 && diff <= 7;
  });

  const upcomingExpire = data.subscriptions.filter((sub) => sub.status !== "active");
  const filteredList = applyFilters(data.subscriptions, filters);

  return `
    <section class="card hero">
      <div class="hero-title">本月支出</div>
      <div class="hero-amount">${formatCurrency(total, homeCurrency)}</div>
      <div class="currency-chips">
        ${currencyOptions
          .map(
            (code) =>
              `<button class="chip ${code === homeCurrency ? "active" : ""}" data-currency="${code}">${code}</button>`
          )
          .join("")}
      </div>
    </section>

    <section class="stat-grid">
      <div class="card stat-card">
        <div class="stat-label">日均</div>
        <div class="stat-value">${formatCurrency(dailyAvg, homeCurrency)}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">已扣</div>
        <div class="stat-value">${formatCurrency(paid, homeCurrency)}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">待扣</div>
        <div class="stat-value">${formatCurrency(pending, homeCurrency)}</div>
      </div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">即将续订 / 到期</div>
        <span class="helper">7 天内续订提醒</span>
      </div>
      <div class="h-scroll">
        ${renderUpcomingCards(upcomingRenew, "续订")}
        ${renderUpcomingCards(upcomingExpire, "到期")}
      </div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">订阅列表</div>
        <span class="helper">${filteredList.length} 个订阅</span>
      </div>
      <div class="filter-bar">
        <input type="search" id="searchInput" placeholder="搜索服务/备注" value="${escapeHtml(filters.search)}" />
        <select id="filterTime">
          <option value="all" ${filters.time === "all" ? "selected" : ""}>时间</option>
          <option value="month" ${filters.time === "month" ? "selected" : ""}>本月</option>
          <option value="year" ${filters.time === "year" ? "selected" : ""}>本年</option>
        </select>
        <select id="filterAmount">
          <option value="all" ${filters.amount === "all" ? "selected" : ""}>金额</option>
          <option value="low" ${filters.amount === "low" ? "selected" : ""}>≤ 20</option>
          <option value="mid" ${filters.amount === "mid" ? "selected" : ""}>20 - 100</option>
          <option value="high" ${filters.amount === "high" ? "selected" : ""}>100 - 300</option>
          <option value="top" ${filters.amount === "top" ? "selected" : ""}>≥ 300</option>
        </select>
        <select id="filterStatus">
          <option value="all">状态</option>
          <option value="active" ${filters.status === "active" ? "selected" : ""}>进行中</option>
          <option value="paused" ${filters.status === "paused" ? "selected" : ""}>暂停</option>
          <option value="expired" ${filters.status === "expired" ? "selected" : ""}>到期</option>
        </select>
      </div>
      <div class="filter-bar" style="margin-top:10px;">
        <select id="filterSort">
          <option value="nextCharge" ${filters.sort === "nextCharge" ? "selected" : ""}>按下次扣费</option>
          <option value="amountDesc" ${filters.sort === "amountDesc" ? "selected" : ""}>金额高→低</option>
          <option value="amountAsc" ${filters.sort === "amountAsc" ? "selected" : ""}>金额低→高</option>
          <option value="name" ${filters.sort === "name" ? "selected" : ""}>名称</option>
        </select>
        <div></div><div></div><div></div>
      </div>
      <div class="list" style="margin-top:12px;">
        ${filteredList.map(renderListItem).join("") || `<div class="helper">暂无匹配订阅</div>`}
      </div>
    </section>
  `;
}

function renderUpcomingCards(list, label) {
  if (!list.length) {
    return `<div class="mini-card"><div class="mini-title">${label}</div><div class="mini-meta">暂无</div></div>`;
  }

  return list
    .map((sub) => {
      const next = getNextChargeDate(sub, new Date());
      return `
        <div class="mini-card">
          <div class="mini-title">${escapeHtml(sub.name)}</div>
          <div class="mini-meta">${label} · ${next ? formatDate(next) : "—"}</div>
          <div class="mini-meta">${formatCurrency(sub.amount, sub.currency)}</div>
        </div>
      `;
    })
    .join("");
}

function renderListItem(sub) {
  const next = getNextChargeDate(sub, new Date());

  return `
    <div class="card list-item" data-id="${sub.id}">
      <div class="list-left">
        <div>
          <div class="list-title">${escapeHtml(sub.name)}</div>
          <div class="list-meta">
            <span class="status-dot"></span>${statusLabels[sub.status] || "未知"} · 下次扣费 ${
    next ? formatDate(next) : "—"
  }
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="amount">${formatCurrency(sub.amount, sub.currency)}</div>
        <div class="tag">${cycleLabels[sub.cycleType]}</div>
      </div>
    </div>
  `;
}

function bindHomeEvents() {
  const view = document.getElementById("view");

  view.querySelectorAll(".list-item").forEach((item) => {
    item.addEventListener("click", () => navigate(`/detail/${item.dataset.id}`));
  });

  view.querySelectorAll(".chip[data-currency]").forEach((chip) => {
    chip.addEventListener("click", () => {
      appState.data.settings.homeCurrency = chip.dataset.currency;
      saveState(appState.data);
      render();
    });
  });

  view.querySelector("#searchInput").addEventListener("input", (event) => {
    appState.filters.search = event.target.value.trim();
    render();
  });

  view.querySelector("#filterTime").addEventListener("change", (event) => {
    appState.filters.time = event.target.value;
    render();
  });

  view.querySelector("#filterAmount").addEventListener("change", (event) => {
    appState.filters.amount = event.target.value;
    render();
  });

  view.querySelector("#filterStatus").addEventListener("change", (event) => {
    appState.filters.status = event.target.value;
    render();
  });

  view.querySelector("#filterSort").addEventListener("change", (event) => {
    appState.filters.sort = event.target.value;
    render();
  });
}

function renderInsights() {
  const now = new Date();
  const { data, insights } = appState;
  const period = insights.period;
  const currency = insights.currency || "CNY";
  const totals = getPeriodTotals(data.subscriptions, period, currency, now);
  const trend = getTrendData(data.subscriptions, currency);
  const calendar = getCalendarMarks(data.subscriptions, now);

  return `
    <section class="card">
      <div class="section-header">
        <div class="section-title">数据洞察</div>
        <div class="currency-chips">
          ${data.currencies
            .map(
              (code) =>
                `<button class="chip ${code === currency ? "active" : ""}" data-insight-currency="${code}">${code}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="currency-chips">
        <button class="chip ${period === "month" ? "active" : ""}" data-period="month">按月</button>
        <button class="chip ${period === "year" ? "active" : ""}" data-period="year">按年</button>
      </div>
      <div class="stat-grid" style="margin-top:12px;">
        <div class="card stat-card soft">
          <div class="stat-label">${period === "month" ? "本月支出" : "本年支出"}</div>
          <div class="stat-value">${formatCurrency(totals.amount, currency)}</div>
        </div>
        <div class="card stat-card soft">
          <div class="stat-label">订阅数</div>
          <div class="stat-value">${totals.count}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">12 个月趋势</div>
        <span class="helper">${currency} 视角</span>
      </div>
      <div class="chart-wrap">
        ${trend.map((item) => `<div class="bar" style="--h:${item.height}%"></div>`).join("")}
      </div>
      <div class="chart-wrap" style="height:auto;margin-top:6px;">
        ${trend.map((item) => `<div class="bar-label">${item.label}</div>`).join("")}
      </div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">续订 / 到期日历</div>
        <span class="helper">${now.getFullYear()} 年 ${now.getMonth() + 1} 月</span>
      </div>
      <div class="calendar calendar-weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div class="weekday">${day}</div>`).join("")}
      </div>
      <div class="calendar">
        ${calendar.map(renderCalendarCell).join("")}
      </div>
      ${renderCalendarAgenda(calendar)}
    </section>
  `;
}

function bindInsightsEvents() {
  const view = document.getElementById("view");

  view.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.insights.period = btn.dataset.period;
      render();
    });
  });

  view.querySelectorAll("[data-insight-currency]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.insights.currency = btn.dataset.insightCurrency;
      appState.data.settings.insightsCurrency = btn.dataset.insightCurrency;
      saveState(appState.data);
      render();
    });
  });
}

function renderDetail(id) {
  const sub = appState.data.subscriptions.find((item) => item.id === id);
  if (!sub) {
    return `<section class="card">未找到订阅</section>`;
  }

  const next = getNextChargeDate(sub, new Date());
  const reminderDate = next ? addDays(new Date(next), -Math.max(sub.reminderDays || 0, 0)) : null;

  return `
    <section class="card">
      <div class="section-header">
        <div class="section-title">${escapeHtml(sub.name)}</div>
        <button class="pill" id="backBtn">返回</button>
      </div>
      <div class="stat-grid">
        <div class="card stat-card soft">
          <div class="stat-label">价格</div>
          <div class="stat-value">${formatCurrency(sub.amount, sub.currency)}</div>
        </div>
        <div class="card stat-card soft">
          <div class="stat-label">周期</div>
          <div class="stat-value">${cycleLabels[sub.cycleType]}${
    sub.cycleType === "customDays" ? ` / ${sub.cycleDays} 天` : ""
  }</div>
        </div>
        <div class="card stat-card soft">
          <div class="stat-label">下次扣费</div>
          <div class="stat-value">${next ? formatDate(next) : "—"}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">提醒与备注</div>
      </div>
      <div class="stat-grid">
        <div class="card stat-card soft">
          <div class="stat-label">提醒日期</div>
          <div class="stat-value">${reminderDate ? formatDate(reminderDate) : "—"}</div>
        </div>
        <div class="card stat-card soft">
          <div class="stat-label">提醒提前量</div>
          <div class="stat-value">${sub.reminderDays || 0} 天</div>
        </div>
        <div class="card stat-card soft">
          <div class="stat-label">状态</div>
          <div class="stat-value">${statusLabels[sub.status]}</div>
        </div>
      </div>
      <div class="helper" style="margin-top:8px;">备注：${escapeHtml(sub.note || "—")}</div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">更多信息</div>
      </div>
      <div class="helper">币种：${sub.currency}</div>
    </section>

    <section class="card">
      <div class="section-header">
        <div class="section-title">状态操作</div>
      </div>
      <div class="currency-chips">
        <button class="chip" data-status="active">进行中</button>
        <button class="chip" data-status="paused">暂停</button>
        <button class="chip" data-status="expired">到期</button>
      </div>
      <div class="form-actions" style="margin-top:12px;">
        <button class="pill danger" id="deleteBtn">删除订阅</button>
        <button class="pill primary" id="editBtn">编辑订阅</button>
      </div>
    </section>
  `;
}

function bindDetailEvents(id) {
  const view = document.getElementById("view");

  view.querySelector("#backBtn").addEventListener("click", () => navigate("/home"));
  view.querySelector("#editBtn").addEventListener("click", () => navigate(`/edit/${id}`));

  view.querySelector("#deleteBtn").addEventListener("click", () => {
    if (!confirm("确定删除该订阅吗？此操作不可恢复。")) return;
    appState.data.subscriptions = appState.data.subscriptions.filter((item) => item.id !== id);
    saveState(appState.data);
    navigate("/home");
  });

  view.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = appState.data.subscriptions.find((item) => item.id === id);
      if (!sub) return;
      sub.status = btn.dataset.status;
      saveState(appState.data);
      render();
    });
  });
}

function renderEdit(id) {
  const editing = appState.data.subscriptions.find((item) => item.id === id);
  const sub = editing || {
    id: generateId(),
    name: "",
    amount: 0,
    currency: "CNY",
    cycleType: "month",
    cycleDays: 30,
    startDate: formatDateInput(new Date()),
    reminderDays: 3,
    status: "active",
    note: ""
  };

  const next = getNextChargeDate(sub, new Date());

  return `
    <section class="card">
      <div class="section-header">
        <div class="section-title">${editing ? "编辑订阅" : "新增订阅"}</div>
        <button class="pill" id="backBtn">返回</button>
      </div>
      <form class="form" id="editForm">
        <div class="form-group">
          <label>服务名</label>
          <input name="name" value="${escapeHtml(sub.name)}" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>金额</label>
            <input name="amount" type="number" min="0" step="0.01" value="${sub.amount}" />
          </div>
          <div class="form-group">
            <label>币种</label>
            <select name="currency">
              ${appState.data.currencies
                .map((code) => `<option value="${code}" ${code === sub.currency ? "selected" : ""}>${code}</option>`)
                .join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>周期</label>
            <select name="cycleType">
              <option value="week" ${sub.cycleType === "week" ? "selected" : ""}>周</option>
              <option value="month" ${sub.cycleType === "month" ? "selected" : ""}>月</option>
              <option value="year" ${sub.cycleType === "year" ? "selected" : ""}>年</option>
              <option value="customDays" ${sub.cycleType === "customDays" ? "selected" : ""}>自定义天数</option>
            </select>
          </div>
          <div class="form-group">
            <label>自定义天数</label>
            <input name="cycleDays" type="number" min="1" value="${sub.cycleDays || 30}" />
          </div>
          <div class="form-group">
            <label>开始日期</label>
            <input name="startDate" type="date" value="${sub.startDate}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>提醒提前量（天）</label>
            <input name="reminderDays" type="number" min="0" value="${sub.reminderDays || 0}" />
          </div>
          <div class="form-group">
            <label>状态</label>
            <select name="status">
              <option value="active" ${sub.status === "active" ? "selected" : ""}>进行中</option>
              <option value="paused" ${sub.status === "paused" ? "selected" : ""}>暂停</option>
              <option value="expired" ${sub.status === "expired" ? "selected" : ""}>到期</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>备注</label>
          <textarea name="note" rows="3">${escapeHtml(sub.note || "")}</textarea>
        </div>
        <div class="helper">下次扣费预览：${next ? formatDate(next) : "—"}</div>
        <div class="form-actions">
          <button type="button" class="pill" id="cancelBtn">取消</button>
          <button type="submit" class="pill primary">保存</button>
        </div>
      </form>
    </section>
  `;
}

function bindEditEvents(id) {
  const view = document.getElementById("view");

  view.querySelector("#backBtn").addEventListener("click", () => navigate("/home"));
  view.querySelector("#cancelBtn").addEventListener("click", () => navigate("/home"));

  view.querySelector("#editForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = form.get("name").trim();
    if (!name) return alert("请填写服务名");

    const amount = Number(form.get("amount")) || 0;
    const cycleType = form.get("cycleType");
    const cycleDays = Number(form.get("cycleDays")) || (cycleType === "customDays" ? 30 : 0);

    const payload = {
      id: id || generateId(),
      name,
      amount,
      currency: form.get("currency"),
      cycleType,
      cycleDays,
      startDate: form.get("startDate"),
      reminderDays: Number(form.get("reminderDays")) || 0,
      status: form.get("status"),
      note: form.get("note").trim()
    };

    if (id) {
      const index = appState.data.subscriptions.findIndex((sub) => sub.id === id);
      appState.data.subscriptions[index] = payload;
    } else {
      appState.data.subscriptions.unshift(payload);
    }

    saveState(appState.data);
    navigate(`/detail/${payload.id}`);
  });
}

function renderCalendarCell(cell) {
  if (!cell.date) {
    return `<div class="day empty"></div>`;
  }

  const visibleEvents = cell.events.slice(0, 2);
  const hiddenCount = Math.max(cell.events.length - visibleEvents.length, 0);
  const title = cell.events
    .map((event) => `${event.type === "expire" ? "到期" : "续订"}：${event.name || ""}`)
    .join(" / ");

  return `
    <div class="day ${cell.events.length ? "has-events" : ""}" title="${escapeHtml(title)}">
      <div class="day-number">${cell.date.getDate()}</div>
      <div class="day-events">
        ${visibleEvents
          .map(
            (event) => `
              <div class="day-event ${event.type === "expire" ? "expire" : "renew"}">
                <span>${escapeHtml(event.name || "")}</span>
              </div>
            `
          )
          .join("")}
        ${hiddenCount ? `<div class="event-count">+${hiddenCount}</div>` : ""}
      </div>
    </div>
  `;
}

function renderCalendarAgenda(calendar) {
  const rows = calendar
    .filter((cell) => cell.date && cell.events.length)
    .flatMap((cell) =>
      cell.events.map((event) => ({
        date: cell.date,
        event
      }))
    );

  if (!rows.length) {
    return `<div class="calendar-agenda helper">本月暂无续订或到期事项</div>`;
  }

  return `
    <div class="calendar-agenda">
      ${rows
        .map(
          ({ date, event }) => `
            <div class="agenda-item ${event.type === "expire" ? "expire" : "renew"}">
              <div>
                <strong>${formatDate(date)}</strong>
                <span>${event.type === "expire" ? "到期" : "续订"}</span>
              </div>
              <div>${escapeHtml(event.name || "")}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function applyFilters(list, filters) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);

  return list
    .filter((sub) => {
      if (filters.search) {
        const keyword = filters.search.toLowerCase();
        const text = `${sub.name} ${sub.note || ""}`.toLowerCase();
        if (!text.includes(keyword)) return false;
      }

      if (filters.status !== "all" && sub.status !== filters.status) return false;

      if (filters.amount !== "all") {
        const amount = sub.amount || 0;
        if (filters.amount === "low" && amount > 20) return false;
        if (filters.amount === "mid" && (amount < 20 || amount > 100)) return false;
        if (filters.amount === "high" && (amount < 100 || amount > 300)) return false;
        if (filters.amount === "top" && amount < 300) return false;
      }

      if (filters.time !== "all") {
        const next = getNextChargeDate(sub, now);
        if (!next) return false;
        if (filters.time === "month" && (next < monthStart || next > monthEnd)) return false;
        if (filters.time === "year" && (next < yearStart || next > yearEnd)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (filters.sort === "amountDesc") return b.amount - a.amount;
      if (filters.sort === "amountAsc") return a.amount - b.amount;
      if (filters.sort === "name") return a.name.localeCompare(b.name, "zh");
      const aNext = getNextChargeDate(a, now);
      const bNext = getNextChargeDate(b, now);
      return (aNext?.getTime() || 0) - (bNext?.getTime() || 0);
    });
}

function getChargesInRange(sub, start, end) {
  const charges = [];
  let date = parseDate(sub.startDate);
  if (!date) return charges;

  let loopGuard = 0;
  while (date <= end && loopGuard < 2000) {
    if (date >= start) {
      charges.push({ date: new Date(date), amount: sub.amount, currency: sub.currency });
    }
    date = addCycle(date, sub, 1);
    loopGuard += 1;
  }

  return charges;
}

function getNextChargeDate(sub, refDate) {
  const date = parseDate(sub.startDate);
  if (!date) return null;
  if (date >= refDate) return date;

  let next = date;
  let loopGuard = 0;
  while (next < refDate && loopGuard < 2000) {
    next = addCycle(next, sub, 1);
    loopGuard += 1;
  }

  return next;
}

function getLastChargeDate(sub, refDate) {
  const date = parseDate(sub.startDate);
  if (!date) return null;

  let current = date;
  let prev = date;
  let loopGuard = 0;
  while (current <= refDate && loopGuard < 2000) {
    prev = current;
    current = addCycle(current, sub, 1);
    loopGuard += 1;
  }

  return prev;
}

function getPeriodTotals(subs, period, currency, now) {
  const start =
    period === "year" ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end =
    period === "year" ? new Date(now.getFullYear(), 11, 31) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const charges = subs
    .filter((sub) => sub.status === "active")
    .flatMap((sub) => getChargesInRange(sub, start, end))
    .filter((charge) => charge.currency === currency);

  return {
    amount: charges.reduce((sum, item) => sum + item.amount, 0),
    count: subs.length
  };
}

function getTrendData(subs, currency) {
  const now = new Date();
  const points = [];

  for (let i = 11; i >= 0; i -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const charges = subs
      .filter((sub) => sub.status === "active")
      .flatMap((sub) => getChargesInRange(sub, start, end))
      .filter((charge) => charge.currency === currency);
    const total = charges.reduce((sum, item) => sum + item.amount, 0);

    points.push({
      label: `${monthDate.getMonth() + 1}月`,
      value: total
    });
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  return points.map((p) => ({
    label: p.label,
    height: Math.round((p.value / max) * 100)
  }));
}

function getCalendarMarks(subs, now) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const cells = [];
  const eventsByDay = new Map();

  subs.forEach((sub) => {
    if (sub.status === "active") {
      const charges = getChargesInRange(sub, firstDay, lastDay);
      charges.forEach((charge) => {
        const key = formatDateInput(charge.date);
        if (!eventsByDay.has(key)) eventsByDay.set(key, []);
        eventsByDay.get(key).push({
          type: "renew",
          name: sub.name,
          amount: sub.amount,
          currency: sub.currency
        });
      });
    }

    if (sub.status === "expired") {
      const lastCharge = getLastChargeDate(sub, now);
      if (lastCharge) {
        const key = formatDateInput(lastCharge);
        if (!eventsByDay.has(key)) eventsByDay.set(key, []);
        eventsByDay.get(key).push({
          type: "expire",
          name: sub.name
        });
      }
    }
  });

  for (let i = 0; i < totalCells; i += 1) {
    const dayIndex = i - startOffset + 1;
    if (dayIndex <= 0 || dayIndex > lastDay.getDate()) {
      cells.push({ date: null, events: [] });
    } else {
      const date = new Date(year, month, dayIndex);
      const key = formatDateInput(date);
      cells.push({ date, events: eventsByDay.get(key) || [] });
    }
  }

  return cells;
}

function exportCsv() {
  const headers = [
    "id",
    "name",
    "amount",
    "currency",
    "cycleType",
    "cycleDays",
    "startDate",
    "nextChargeDate",
    "status",
    "reminderDays",
    "note"
  ];

  const rows = appState.data.subscriptions.map((sub) => {
    const next = getNextChargeDate(sub, new Date());
    return [
      sub.id,
      sub.name,
      sub.amount,
      sub.currency,
      sub.cycleType,
      sub.cycleDays,
      sub.startDate,
      next ? formatDateInput(next) : "",
      sub.status,
      sub.reminderDays || 0,
      (sub.note || "").replace(/\n/g, " ")
    ];
  });

  const csv = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "subscriptions.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", appState.data.settings.theme || "light");
}

function toggleTheme() {
  appState.data.settings.theme = appState.data.settings.theme === "dark" ? "light" : "dark";
  saveState(appState.data);
  applyTheme();
}

function sumByCurrency(charges) {
  return charges.reduce((acc, charge) => {
    acc[charge.currency] = (acc[charge.currency] || 0) + charge.amount;
    return acc;
  }, {});
}

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount || 0);
  } catch {
    return `${currency} ${(amount || 0).toFixed(2)}`;
  }
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateInput(date) {
  return formatDate(date);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  return next;
}

function addYears(date, years) {
  return addMonths(date, years * 12);
}

function addCycle(date, sub, step) {
  if (sub.cycleType === "week") return addDays(date, 7 * step);
  if (sub.cycleType === "month") return addMonths(date, step);
  if (sub.cycleType === "year") return addYears(date, step);
  return addDays(date, (sub.cycleDays || 1) * step);
}

function diffDays(from, to) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker 注册失败", error);
    });
  });
}
