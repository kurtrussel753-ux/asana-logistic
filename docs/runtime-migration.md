# مهاجرت به رانتایم عامل‌ها (v15.25 · سرور 1.19) — Mastra + Vercel AI SDK + MCP SDK

این سند اجرای «نقشهٔ راه مهاجرت» را توضیح می‌دهد. اصل طراحی: **سرور فعلی (`server.js`) همچنان منبع حقیقت و موتور سیاست است**؛ رانتایم جدید (`runtime/`) یک sidecar است که مدل، حلقهٔ عامل، گردش‌کار، ردیابی و MCP استاندارد را فراهم می‌کند، ولی **هر فراخوانی ابزار از راه پل به `agCall` سرور برمی‌گردد**. بنابراین فهرست مجاز ابزار هر عامل، نقش‌ها، کلیدهای داده، سقف‌های روزانه، سطح خودمختاری، کارتابل تأیید، اصل چهار چشم، کلید توقف اضطراری و زنجیرهٔ ممیزی بدون تغییر اعمال می‌شوند.

پیش‌فرض `IFA_RUNTIME_MODE=off` است: بدون تنظیم، رفتار سامانه **هیچ تغییری** نمی‌کند (آزمون‌های قبلی بدون تغییر سبزند).

```
مرورگر ──► server.js (سیاست، داده، تأیید، ممیزی) ──پل /api/runtime/* (رمز مشترک)──► runtime/ (Mastra · AI SDK · MCP SDK)
                ▲                                                                       │
                └──────── هر ابزار: /api/runtime/call → agCall (whitelist/role/budget/level/approval) ◄┘
                                                                     مدل‌ها: مستقیم یا LiteLLM ── ردیابی: Langfuse
```

## وضعیت فازها

| فاز | چه پیاده شد | کجا |
|---|---|---|
| ۰ · دروازهٔ مدل | پیکربندی LiteLLM (alias `ifa-default` با failover، `ifa-cheap`، `ifa-local`)، سرویس `litellm` در compose (profile `gateway`)، `npm run probe:llm` برای سنجش فراخوانی بومی ابزار، رفت‌وبرگشت نتیجهٔ ابزار، JSON و فارسی | `deploy/litellm/config.yaml`، `scripts/llm-probe.js` |
| ۱ · لایهٔ مدل AI SDK | کارخانهٔ ارائه‌دهنده (OpenAI-compatible/OpenRouter/vLLM/LiteLLM، Anthropic، Ollama)، فراخوانی بومی ابزار با schema، middleware حاکمیتی روی **هر** فراخوانی: پوشاندن PII (همان الگوهای سرور، روی system/user/tool-result/tool-call) و بازگرداندن آن، پیش‌بررسی بودجه، گزارش توکن و هزینه به `ag_use`/`ag_step` | `runtime/src/models.js`، `runtime/src/tools.js` |
| ۲ · ردیابی | Langfuse (ingestion API، دسته‌ای): trace برای هر پرسش/فرایند/گردش‌کار، generation برای هر فراخوانی مدل (با prompt **پوشانده‌شده**)، span برای هر ابزار؛ بدون کلید خاموش. شناسهٔ trace در گام‌های کار ذخیره می‌شود | `runtime/src/tracing.js` |
| ۳ · پایلوت تحلیل‌گر | عامل Mastra برای «تحلیل‌گر بازار» با دستورالعمل و schema ابزارها از رجیستری سرور؛ کنترل عدد‌به‌منبع در رانتایم + **بازبینی دوبارهٔ همان قاعده در سرور روی نتایجی که خود سرور برگردانده**؛ حالت `shadow` (پاسخ قدیمی به کاربر، مقایسهٔ موازی در جدول `rt_shadow`) و `primary` (با بازگشت خودکار به مسیر قدیمی) | `runtime/src/agents.js`، `dev/src/p5/r_runtime.js` |
| ۴ · انسان در حلقه | دو گردش‌کار با توقف/ادامهٔ پایدار: `procurement-rfq` (پیش‌نویس → گیرندگان → غربال تحریم → تأیید → ارسال → اعلان) و `finance-payment` (ارز/تطبیق صورتحساب → تأیید مالی با اصل چهار چشم → صف `ifa-payq`). اقدام بیرونی/مالی را فقط سرور پس از تأیید اجرا می‌کند؛ رانتایم با hook (`apDecide`) یا poll ادامه می‌دهد | `runtime/src/workflows/hitl.js`، `runtime/src/engine.js` |
| ۵ · فرایندها | تعریف‌های `ag_flow` (۹ الگو + فرایندهای کاربر: tool/agent/llm/notify/gate، `when`، `onFail`، `{{…}}`) به گردش‌کار Mastra کامپایل و اجرا می‌شوند (`IFA_RUNTIME_FLOWS=on`)؛ زبان قالب/شرط **عیناً** از `server.js` تولید می‌شود؛ گزارش گام‌به‌گام، لغو، ثبت `last_log` مثل قبل؛ اگر رانتایم در دسترس نباشد موتور قبلی اجرا می‌کند | `runtime/src/workflows/flows.js`، `runtime/src/legacy.gen.js` |
| ۶ · MCP استاندارد | نقطهٔ `/mcp` رانتایم با SDK رسمی (Streamable HTTP، stateless) با همان کلیدهای `ifa_mcp_…`: ابزارهای مجاز کلید + `ask_analyst` (پاسخ مستند) + `workflow_start`/`workflow_status`. نقطهٔ `/mcp` قدیمی سرور برای سازگاری می‌ماند | `runtime/src/mcp.js` |
| ۷ · پایداری و ارزیابی | ذخیرهٔ LibSQL برای snapshot گردش‌کارها + فهرست اجراها؛ ادامهٔ اجرا پس از راه‌اندازی دوبارهٔ رانتایم (آزموده‌شده)؛ promptfoo برای ارزیابی رگرسیون؛ CI برای رانتایم | `runtime/src/runs.js`، `runtime/evals/` |
| ۸ · وب زنده و خودکارگردان سرور | یکپارچگی کامل Tavily (search/extract/crawl/map/research/usage) با سقف اعتبار، ابزارهای عامل و پایش؛ گردش‌کارهای `deep-research` (پژوهش عمیق با poll پایدار و ثبت در حافظهٔ سازمانی) و `lane-autopilot` (اجرای خودکارگردان مسیر در سرور) | `dev/src/p5/s_tavily.js`، `dev/src/p5/t_apsrv.js`، `runtime/src/workflows/research.js`، [`docs/tavily.md`](tavily.md) |

### تصمیم‌های معماری (به‌روزشده در v15.25)
- **خودکارگردان (autopilot)** اکنون سمت سرور هم اجرا می‌شود (`t_apsrv.js`): مقایسهٔ مسیر، نرخ‌ها، ارز و خبرهای ثبت‌شده/زندهٔ Tavily → `ap_runs` با `mode=server`، ثبت در حافظهٔ سازمانی و رویداد `autopilot.done`؛ زمان‌بندی هر مسیر (`GET/PUT /api/ap/lanes`)، ابزار عامل `autopilot_run` و گردش‌کار `lane-autopilot`.
- **`server.js` شکسته شد:** منبع در `server/src/*.js` + ماژول‌های `dev/src/p5/` با ترتیب `server/manifest.json` است و `scripts/build-server.js` آن‌ها را بایت‌به‌بایت به `server.js` تبدیل می‌کند (`--check` در CI). `scripts/inject-module.js` قدیمی حذف شد؛ فقط مسیر build جدید استفاده می‌شود.
- **Temporal/DBOS لازم نشد:** Mastra + LibSQL پایداری snapshot و ادامه پس از راه‌اندازی دوباره را فراهم می‌کند (آزموده‌شده، از جمله poll چندساعتهٔ پژوهش). اگر هزاران اجرای چندروزه لازم شد، Temporal گام بعدی است.
- **mem0/Graphiti جایگزین شد** با حافظهٔ سازمانی سرور (`ag_mem` / `memory_search`) که اکنون از نتایج پژوهش Tavily و اجراهای خودکارگردان تغذیه می‌شود؛ بدون سرویس اضافه و زیر همان کنترل دسترسی.
- مدل‌ها و Tavily واقعی در CI عادی آزموده نمی‌شوند (مدل/Tavily جعلی)؛ کار `live` در CI با `workflow_dispatch` (ورودی `live`) و secrets (`TAVILY_API_KEY`، `LLM_*`) `probe:tavily` و `probe:llm` را اجرا می‌کند. پیش از `primary` حتماً `shadow` را اجرا کنید.

## راه‌اندازی

```bash
# ۱) رمز مشترک (در .env هر دو طرف یکسان)
echo "IFA_RUNTIME_TOKEN=$(openssl rand -hex 24)" >> .env
# ۲) سنجش مدل/دروازه (فراخوانی بومی ابزار لازم است)
npm run probe:llm
# ۳) رانتایم
cd runtime && npm ci && IFA_SERVER_URL=http://127.0.0.1:8080 npm start      # یا: docker compose --profile runtime up -d
# ۴) روشن کردن تدریجی در سرور
IFA_RUNTIME_URL=http://127.0.0.1:8090 IFA_RUNTIME_MODE=shadow npm start
```

با Docker: `docker compose --profile runtime --profile gateway --profile observability up -d --build`.

### برنامهٔ انتشار پیشنهادی
1. `shadow` با `IFA_RUNTIME_SHADOW_PCT=100` حداقل یک هفته؛ پایش `GET /api/runtime/shadow` (نرخ مستند بودن پاسخ رانتایم، توافق عددی با مسیر قدیمی، تأخیر).
2. وقتی `runtimeGrounded ≥ legacyGrounded` و `agree` بالا بود → `primary` برای `analyst`.
3. `IFA_RUNTIME_FLOWS=on` و اجرای دستی چند الگو؛ سپس زمان‌بندی‌ها.
4. گردش‌کارهای انسان‌در‌حلقه را از API/MCP آغاز کنید (`POST /api/runtime/workflows/procurement-rfq/start`).
5. افزودن عامل‌های دیگر به `IFA_RUNTIME_AGENTS` (فقط پرسش آزاد/`ask` آن‌ها از رانتایم می‌گذرد).

## متغیرها
| متغیر | سمت | توضیح |
|---|---|---|
| `IFA_RUNTIME_TOKEN` | هر دو | رمز مشترک ≥ ۱۶ نویسه؛ بدون آن پل بسته است |
| `IFA_RUNTIME_URL` | سرور | نشانی رانتایم |
| `IFA_RUNTIME_MODE` | سرور | `off` · `shadow` · `primary` |
| `IFA_RUNTIME_AGENTS` | سرور | عامل‌هایی که پرسش آزادشان به رانتایم می‌رود (پیش‌فرض `analyst`) |
| `IFA_RUNTIME_SHADOW_PCT` | سرور | درصد نمونه‌برداری حالت سایه |
| `IFA_RUNTIME_FLOWS` | سرور | `on` = اجرای فرایندها روی رانتایم |
| `IFA_SERVER_URL` | رانتایم | نشانی سرور |
| `RT_LLM_*` / `IFA_LLM_*` / `LITELLM_URL` | رانتایم | مدل (اولویت به همین ترتیب)؛ `RT_LLM_LOCAL=1` یعنی مدل محلی (بدون پوشاندن PII) |
| `LANGFUSE_HOST`، `LANGFUSE_PUBLIC_KEY`، `LANGFUSE_SECRET_KEY` | رانتایم | ردیابی |
| `RT_DATA`، `RT_PORT`، `RT_MAX_STEPS`، `RT_POLL_SEC` | رانتایم | ذخیره‌سازی، درگاه، سقف گام‌های عامل، فاصلهٔ poll تأییدها |
| `RT_RESEARCH_POLL_SEC`، `RT_RESEARCH_MAX_POLLS` | رانتایم | فاصله و سقف poll گردش‌کار `deep-research` (پیش‌فرض ۱۵ ثانیه، ۲۴۰ بار) |
| `IFA_TAVILY_KEY` و `IFA_TAVILY_*` | سرور | کلید و سقف‌های Tavily — [`docs/tavily.md`](tavily.md) |

## API

**پل (رانتایم → سرور، سرآیند `X-IFA-Runtime-Token`):** `GET /api/runtime/agents` · `GET /api/runtime/policy?ctx=` · `POST /api/runtime/call` · `POST /api/runtime/usage` · `POST /api/runtime/step` · `POST /api/runtime/agent-run` · `POST /api/runtime/tasks/open` · `POST /api/runtime/tasks/:id/{ctx,state,close}` · `GET /api/runtime/approvals/:id` · `POST /api/runtime/mcp-auth`.
رانتایم فقط یک شناسهٔ زمینهٔ موقت (ctx) در دست دارد؛ زمینهٔ واقعی (کار، عامل، کاربر، منابع، تأییدها) در سرور می‌ماند. زمینهٔ پرسش «فقط‌خواندنی» است (ابزار write/notify/external ممنوع).

**کاربر (با ورود):** `GET /api/runtime/status` · `GET /api/runtime/shadow` (مدیر) · `GET /api/runtime/workflows` · `POST /api/runtime/workflows/:wf/start` · `GET /api/runtime/runs[/:id]`.

**رانتایم (Bearer همان رمز):** `GET /healthz` · `POST /v1/agents/:id/ask` · `POST /v1/flows/run` · `GET /v1/workflows` · `POST /v1/workflows/:id/start` · `GET /v1/runs[/:id]` · `POST /v1/hooks/approval` · `POST /mcp` (کلید `ifa_mcp_…`).

## نگهداری
- کد سرور را در `server/src/*.js` یا `dev/src/p5/*.js` ویرایش کنید (نه مستقیم `server.js`)، سپس `npm run build:server` (ساخت `server.js` از manifest، تولید `runtime/src/legacy.gen.js` از توابع نگهبان سرور، و بازجاسازی `server.js` و ماژول‌های کلاینت در `index.html` با بازنویسی فقط بخش‌های تغییرکردهٔ `bundle/`).
- `npm run check:build` در CI همگامی همهٔ این‌ها را بررسی می‌کند.

## استقرار امن
برای محیط تولید از فایل مستقل `deploy/compose.production.yml` و چک‌لیست [`production-readiness.md`](production-readiness.md) استفاده کنید. compose اصلی برای توسعه/آزمایش نگه داشته شده است؛ نمونه‌های رمز پیش‌فرض آن برای تولید مناسب نیستند.

## مجوز گردش‌کارهای MCP
شروع گردش‌کار، مجوز همهٔ ابزارهای موردنیاز آن (حتی ابزارهای اختیاری) را از نقش درخواست‌دهنده و فهرست مجاز کلید MCP بررسی می‌کند؛ داشتن ابزار `workflow_start` به‌تنهایی مجوز عمومی نیست. کلید viewer اجازهٔ شروع ندارد. ابزار `workflow_status` فقط اجراهای همان هویت MCP را برمی‌گرداند؛ نقش admin استثناست. پراکسی HTTP آغاز گردش‌کار نیز نقش کاربر آغازکننده را پیش از ساخت اجرا بررسی می‌کند.
